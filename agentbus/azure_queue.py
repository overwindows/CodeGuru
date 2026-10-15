#!/usr/bin/env python3
"""azure_queue.py — minimal Azure Storage Queue client (stdlib only, urllib).

The remote ask-chen relay: colleagues' agents POST questions to an Azure Storage
queue, and the local agentbus worker polls it, answers via ask_chen, and posts
the reply to a results queue. Storage Queues satisfy A2A-style async messaging
without running any compute in Azure (Azure blocked the Function-app deployment
via the MAI-FunctionApps-v010 public-no-auth deny policy), so all compute stays
local in the agentbus worker.

Implements the Queue REST API with SharedKey auth (HMAC-SHA256) using only the
stdlib — consistent with agentbus's "no pip install" design. Uses the JSON
message format (api-version 2017-11-09+) which is far simpler than the legacy
XML payloads.

Auth: pass the storage account connection string (QueueEndpoint + AccountKey), a
full endpoint + key pair, or a scoped Queue SAS (endpoint + SAS token — least
privilege, no account key). SAS auth signs nothing and sends no account key.
"""
from __future__ import annotations

import base64, datetime, hashlib, hmac, json, os, re, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

# A recent, well-supported api-version that accepts JSON queue message bodies.
API_VERSION = "2019-12-12"
_MS_VERSION = "x-ms-version"
_MS_DATE = "x-ms-date"


class AzureQueueError(RuntimeError):
    pass


def parse_connection_string(conn: str) -> dict:
    """Parse a storage connection string into {endpoint, key}."""
    parts = {}
    for kv in conn.split(";"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            parts[k.strip()] = v.strip()
    if "QueueEndpoint" not in parts or "AccountKey" not in parts:
        raise AzureQueueError("connection string must have QueueEndpoint + AccountKey")
    return {"endpoint": parts["QueueEndpoint"].rstrip("/"),
            "key": parts["AccountKey"],
            "account": parts.get("AccountName", "")}


def _xml_escape(text: str) -> str:
    """Escape a string for use as XML element text (MessageText).

    Queue message bodies can contain arbitrary characters (including '<', '&'
    etc. in questions), so escape the five XML special entities before
    embedding them in the XML payload."""
    return (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;")
                .replace("'", "&apos;"))


def _sign_string(verb: str, url_path: str, headers: dict) -> str:
    """Build the canonicalized string to sign for the Queue REST API."""
    canonicalized_headers = []
    for k in sorted(headers):
        lk = k.lower()
        if lk.startswith("x-ms-"):
            canonicalized_headers.append(f"{lk}:{headers[k].strip()}\n")
    canonicalized_headers = "".join(canonicalized_headers)

    cf = ""
    m = re.match(r"/[^?]+", url_path)
    if m:
        query = url_path[m.end():].lstrip("?")
        if query:
            pairs = []
            for kv in query.split("&"):
                k, _, v = kv.partition("=")
                pairs.append((k.lower(), urllib.parse.unquote(v)))
            pairs.sort()
            cf = "\n".join(f"{k}:{v}" for k, v in pairs)

    canonicalized_resource = f"/{headers['account']}"
    if m:
        canonicalized_resource += m.group(0)
    if cf:
        canonicalized_resource += f"\n{cf}"

    # 12 standard request-header fields, then canonicalized headers (each with
    # its own trailing newline, including the last), then the canonicalized
    # resource appended directly so it sits on the line after the last header.
    parts = [
        verb,
        headers.get("Content-Encoding", ""),
        headers.get("Content-Language", ""),
        headers.get("Content-Length", ""),
        headers.get("Content-MD5", ""),
        headers.get("Content-Type", ""),
        headers.get("Date", ""),
        headers.get("If-Modified-Since", ""),
        headers.get("If-Match", ""),
        headers.get("If-None-Match", ""),
        headers.get("If-Unmodified-Since", ""),
        headers.get("Range", ""),
    ]
    return "\n".join(parts) + "\n" + canonicalized_headers + canonicalized_resource


class QueueClient:
    """Called with text messages. Usage:

        c = QueueClient.from_connection_string(CONN)
        c.put("askchen-inbox", "hello")
        msg = c.recv("askchen-inbox")   # {id, receipt, text} or None
        c.delete("askchen-inbox", msg.id, msg.receipt)
    """

    @classmethod
    def from_connection_string(cls, conn: str) -> "QueueClient":
        p = parse_connection_string(conn)
        return cls(p["endpoint"], p["key"], p["account"])

    @classmethod
    def from_sas(cls, endpoint: str, sas: str) -> "QueueClient":
        """Build a client that authenticates with a scoped queue SAS instead of
        an account key. `endpoint` is the queue endpoint (no query);
        `sas` is the SAS token query (without a leading '?'). No account key is
        used or sent — least-privilege credentials for remote callers."""
        return cls(endpoint.rstrip("/"), key=None, account="", sas=sas.lstrip("?"))

    def __init__(self, endpoint: str, key: str | None, account: str,
                 sas: str | None = None):
        self.endpoint = endpoint.rstrip("/")
        self.key = base64.b64decode(key) if key else None
        self.account = account
        self.sas = sas

    def _auth_query(self, params: dict | None) -> str:
        """Attach the extra SAS query to the caller's params, if in SAS mode."""
        qs = urllib.parse.urlencode(params or {})
        if self.sas:
            sep = "&" if qs else ""
            qs += f"{sep}{self.sas}"
        return qs

    def _request(self, method: str, path: str, body: bytes | None = None,
                 content_type: str | None = None, params: dict | None = None) -> bytes:
        # Queue responses are XML (Peek/GetMessages); request the same format
        # on the wire. Some api-versions honor JSON responses when the request
        # declares application/json, but XML is the reliable default.
        if method in ("GET",) and content_type is None:
            content_type = "application/xml"
        qs = self._auth_query(params)
        url = f"{self.endpoint}{path}"
        if qs:
            url += f"?{qs}"
        parsed = urllib.parse.urlparse(url)
        query = parsed.query

        # SAS auth requires no signing and sends no Authorization header / key.
        if self.sas:
            headers = {
                _MS_VERSION: API_VERSION,
                _MS_DATE: datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT"),
                "Content-Type": content_type or "",
                "Content-Length": str(len(body)) if body is not None else "0",
            }
        else:
            hdr = {
                _MS_VERSION: API_VERSION,
                _MS_DATE: datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT"),
                "account": self.account,
                "Content-Type": content_type or "",
                # Storage signs an EMPTY Content-Length for GET/HEAD/no-body
                # requests; only set an actual value when a body is present.
                "Content-Length": str(len(body)) if body is not None else "",
            }
            # Sign over path + query with a stripped, lowercased query for the
            # canonicalized resource.
            sign_path = parsed.path
            if query:
                sign_path += f"?{query}"
            string_to_sign = _sign_string(method, sign_path, hdr)
            signature = base64.b64encode(
                hmac.new(self.key, string_to_sign.encode("utf-8"), hashlib.sha256).digest()
            ).decode("utf-8")
            headers = {
                _MS_VERSION: API_VERSION,
                _MS_DATE: hdr[_MS_DATE],
                "Content-Type": content_type or "",
                "x-ms-version": API_VERSION,
                "Authorization": f"SharedKey {self.account}:{signature}",
            }
        if body is not None:
            headers["Content-Length"] = str(len(body))

        req = urllib.request.Request(url, data=body if body is not None else None,
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise AzureQueueError(f"{method} {path} -> HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:500]}")

    # ---- operations -----------------------------------------------------
    def put(self, queue: str, text: str) -> None:
        """Enqueue a message. The request body and MessageText are always XML
        (Queue REST API)."""
        payload = ("<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                   f"<QueueMessage><MessageText>{_xml_escape(text)}</MessageText>"
                   "</QueueMessage>").encode("utf-8")
        self._request("POST", f"/{queue}/messages", body=payload,
                      content_type="application/xml")

    def recv(self, queue: str, visibility_timeout: int = 60):
        """Dequeue one message (makes it invisible for `visibility_timeout` s).
        Returns dict(id, receipt, text) or None. Caller must delete() with the
        receipt once processed."""
        data = self._request("GET", f"/{queue}/messages",
                             params={"numofmessages": 1,
                                     "visibilitytimeout": str(visibility_timeout)})
        return self._parse_message_xml(data)

    def delete(self, queue: str, msg_id: str, receipt: str) -> None:
        path = f"/{queue}/messages/{urllib.parse.quote(msg_id, safe='')}"
        self._request("DELETE", path, params={"popreceipt": receipt})

    def peek(self, queue: str):
        """Read the front message without deleting it (visibility unchanged)."""
        data = self._request("GET", f"/{queue}/messages",
                             params={"numofmessages": 1, "peekonly": "true"})
        return self._parse_message_xml(data)

    @staticmethod
    def _parse_message_xml(data: bytes):
        """Extract the first QueueMessage from an XML GetMessages/Peek response,
        or None if the list is empty."""
        if not data.strip():
            return None
        root = ET.fromstring(data)
        qm = root.find("QueueMessage")
        if qm is None:
            return None
        text_el = qm.find("MessageText")
        return {
            "id": (qm.findtext("MessageId") or "").strip(),
            "receipt": (qm.findtext("PopReceipt") or "").strip(),
            "text": (text_el.text or "") if text_el is not None else "",
        }


# Convenience global client built from env AGENTBUS_AZURE_CONN (if set).
def client_from_env() -> QueueClient | None:
    conn = os.environ.get("AGENTBUS_AZURE_CONN")
    return QueueClient.from_connection_string(conn) if conn else None
