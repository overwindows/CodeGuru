#!/usr/bin/env python3
"""azure_client.py — remote ask-chen client over Azure Storage queues.

Lets a remote agent (on ANY machine with internet + the storage connection
string) send a question to Chen's local agentbus and read back the KB-grounded
answer. Uses the shared `azure_queue` stdlib client.

Protocol (mirrors the agentbus `_azure_worker` relay):
    client -> enqueue   askchen-inbox : {"id":"<corr>","question":"...","caller":"..."}
    agentbus answers it locally (ask_chen + KB)
    agentbus -> enqueue askchen-replies : {"id":"<same corr>","result":{answer,sources,...}}

The client polls `askchen-replies` until it sees its own <corr> id.

Usage:
    AGENTBUS_AZURE_CONN="<StorageConnectionString>" python azure_client.py \
        --question "What is the MSN ranking funnel?" [--caller bob] [--timeout 180]

    # least-privilege: use a scoped queue SAS instead of the full connection string
    # (one SAS with add permission for inbox, one with process permission for replies)
    python azure_client.py --question "..." \
        --inbox-sas "sv=...&sp=a&..." --replies-sas "sv=...&sp=p&..." \
        --endpoint "https://askchenagentstor.queue.core.windows.net"

    # or via env: AGENTBUS_QUEUE_ENDPOINT + AGENTBUS_QUEUE_SAS_INBOX + AGENTBUS_QUEUE_SAS_REPLIES
"""
from __future__ import annotations

import argparse, json, os, sys, time, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from azure_queue import QueueClient  # noqa: E402



def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="azure_client")
    ap.add_argument("--question", required=True)
    ap.add_argument("--caller", default="remote")
    ap.add_argument("--timeout", type=float, default=180.0)
    ap.add_argument("--endpoint",
                    default=os.environ.get("AGENTBUS_QUEUE_ENDPOINT",
                                           "https://askchenagentstor.queue.core.windows.net"))
    # SAS-based (least-privilege) creds — mutually exclusive with the connection
    # string. --inbox-sas only needs add ('a'); --replies-sas needs process ('p').
    ap.add_argument("--inbox-sas", default=os.environ.get("AGENTBUS_QUEUE_SAS_INBOX", ""))
    ap.add_argument("--replies-sas", default=os.environ.get("AGENTBUS_QUEUE_SAS_REPLIES", ""))
    args = ap.parse_args(argv)

    # Two auth modes: full connection string (simplest, has the whole account
    # key) OR a pair of scoped queue SAS tokens (least privilege for colleagues —
    # inbox: add-only, replies: read+delete, never the account key).
    if args.inbox_sas or args.replies_sas:
        if not (args.inbox_sas and args.replies_sas):
            print("ERROR: provide BOTH --inbox-sas and --replies-sas (or neither)",
                  flush=True)
            return 2
        sender = QueueClient.from_sas(args.endpoint, args.inbox_sas)
        receiver = QueueClient.from_sas(args.endpoint, args.replies_sas)
    else:
        conn = os.environ.get("AGENTBUS_AZURE_CONN")
        if not conn:
            print("ERROR: set AGENTBUS_AZURE_CONN or provide --inbox-sas/--replies-sas",
                  flush=True)
            return 2
        sender = QueueClient.from_connection_string(conn)
        receiver = sender

    corr = uuid.uuid4().hex
    sender.put("askchen-inbox",
               json.dumps({"id": corr, "question": args.question,
                           "caller": args.caller}, ensure_ascii=False))
    print(f"[sent] {args.caller}: {args.question[:80]}", flush=True)

    deadline = time.time() + args.timeout
    while time.time() < deadline:
        m = receiver.recv("askchen-replies", visibility_timeout=120)
        if m:
            try:
                d = json.loads(m["text"])
            except Exception:
                d = {}
            if d.get("id") == corr:
                receiver.delete("askchen-replies", m["id"], m["receipt"])
                return _show(d.get("result", {}))
        time.sleep(2)
    print("ERROR: timed out waiting for answer", flush=True)
    return 1


def _show(result: dict) -> int:
    print("STATUS: ", "needs-human" if result.get("needs_human") else "answered",
          flush=True)
    print("ANSWER: " + (result.get("answer") or "(none)"), flush=True)
    for k in ("sources", "confidence", "needs_human"):
        if k in result:
            print(f"{k.upper()}: {result[k]}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
