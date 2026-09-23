"""outlook_graph_lib.py — shared helpers for sweeping Outlook via Microsoft Graph.

Single home for every Graph helper used by the scripts/outlook_* family (the
deep 2022-2026 corpus in knowledgebase/segments/outlook_graph_*.md). Kept
separate from the rest of the family here so the API/token code lives once.

Depends on the Brain Teams token manager for Graph auth:
    sys.path needs C:/Users/wuc/.brain/BrainCore/.claude/skills/teams
    (where teams_token_manager.py lives), plus `requests` and `jwt`.

Usage:
    from outlook_graph_lib import get_token, api, enc, sweep_folder,
                                   all_folders, year_hist, OUT, BASE
"""
import sys, json, time, os, collections, urllib.parse

sys.path.insert(0, r"C:/Users/wuc/.brain/BrainCore/.claude/skills/teams")
import requests
from teams_token_manager import get_token_manager

BASE = "https://graph.microsoft.com/v1.0"
OUT = r"Q:/CodeGuru/knowledgebase/segments"


def get_token():
    m = get_token_manager(use_cache=True)
    return m.get_graph_token(force_refresh=False)[0]


def api(token, url, params=None, max_pages=100000, throttle=0.3):
    """Paginated GET helper with 429 backoff and 401 token refresh.

    `url` is a Graph path ("/me/messages") or absolute. Handles @odata.nextLink
    pagination and returns the full list of `value` items.
    """
    values, pages = [], 0
    headers = {"Authorization": f"Bearer {token}"}
    full = BASE + url if url.startswith("/") else url
    while full and pages < max_pages:
        r = requests.get(full, headers=headers, params=params, timeout=90)
        if r.status_code == 429:
            retry = float(r.headers.get('Retry-After', 10))
            time.sleep(retry + 1)
            continue
        if r.status_code == 401:
            token, _ = get_token_manager(use_cache=True).get_graph_token(force_refresh=True)
            headers = {"Authorization": f"Bearer {token}"}
            continue
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        data = r.json()
        values.extend(data.get("value", []))
        full = data.get("@odata.nextLink")
        params = None
        pages += 1
        time.sleep(throttle)
    return values


def year_hist(values):
    """Tally `values` by 4-digit year using received/sent dates."""
    h = collections.Counter()
    for m in values:
        d = m.get("receivedDateTime") or m.get("sentDateTime") or ""
        if d:
            h[d[:4]] += 1
    return h


def enc(seg):
    """URL-encode path segments (folder ids can contain non-safe chars)."""
    return urllib.parse.quote(str(seg), safe="")


def sweep_folder(token, fid, label, outfile, select, max_pages=100000):
    """Query every message in folder `fid`, print a year histogram, save JSON.

    Writes to OUT/<outfile> and returns the raw `value` list.
    """
    url = f"/me/mailFolders/{enc(fid)}/messages"
    vals = api(token, url, params={"$top": 200, "$select": select},
               max_pages=max_pages)
    print(f"  [{label}] swept {len(vals)}; by year: {dict(sorted(year_hist(vals).items()))}")
    with open(os.path.join(OUT, outfile), "w", encoding="utf-8") as f:
        json.dump(vals, f, ensure_ascii=False, indent=2, default=str)
    return vals


def all_folders(token):
    """Recursively enumerate every mail folder -> {id: {name, path, total, parent}}."""
    folders = {}

    def walk(fid, path):
        url = f"/me/mailFolders/{fid}/childFolders?$top=999&$select=id,displayName,childFolderCount,totalItemCount,parentFolderId"
        try:
            children = api(token, url, max_pages=10)
        except RuntimeError:
            return
        for c in children:
            folders[c["id"]] = {
                "name": c.get("displayName"),
                "path": path + "/" + str(c.get("displayName")),
                "total": c.get("totalItemCount", 0),
                "parent": c.get("parentFolderId"),
            }
            walk(c["id"], folders[c["id"]]["path"])

    roots = api(token, "/me/mailFolders?$top=999&$select=id,displayName,childFolderCount,totalItemCount,parentFolderId")
    for r in roots:
        folders[r["id"]] = {
            "name": r.get("displayName"),
            "path": str(r.get("displayName")),
            "total": r.get("totalItemCount", 0),
            "parent": r.get("parentFolderId"),
        }
        walk(r["id"], folders[r["id"]]["path"])
    return folders
