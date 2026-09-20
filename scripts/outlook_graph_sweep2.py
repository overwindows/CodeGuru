import sys, json, time, os, datetime, collections
sys.path.insert(0, r"C:/Users/wuc/.brain/BrainCore/.claude/skills/teams")
import requests, jwt
from teams_token_manager import get_token_manager

BASE = "https://graph.microsoft.com/v1.0"
OUT = r"Q:/CodeGuru/knowledgebase/segments"

def get_token():
    m = get_token_manager(use_cache=True)
    return m.get_graph_token(force_refresh=False)[0]

def api(token, url, params=None, max_pages=100000, throttle=0.3, want_token=None):
    values, pages = [], 0
    headers = {"Authorization": f"Bearer {token}"}
    while url and pages < max_pages:
        r = requests.get(url, headers=headers, params=params, timeout=90)
        if r.status_code == 429:
            retry = float(r.headers.get('Retry-After', 10)); time.sleep(retry+1); continue
        if r.status_code == 401:
            m = get_token_manager(use_cache=True); token,_ = m.get_graph_token(force_refresh=True)
            headers = {"Authorization": f"Bearer {token}"}; continue
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        data = r.json(); values.extend(data.get("value", []))
        url = data.get("@odata.nextLink"); params = None; pages += 1
        time.sleep(throttle)
    return values

def year_hist(values):
    h = collections.Counter()
    for m in values:
        d = m.get("receivedDateTime") or m.get("sentDateTime") or ""
        if d: h[d[:4]] += 1
    return h

def sweep_folder(token, fid, label, outfile, select, max_pages=2000):
    url = f"/me/mailFolders/{fid}/messages?$top=200&$select={select}"
    vals = api(token, url, max_pages=max_pages)
    print(f"  [{label}] swept {len(vals)} items; by year: {dict(sorted(year_hist(vals).items()))}")
    with open(os.path.join(OUT, outfile), "w", encoding="utf-8") as f:
        json.dump(vals, f, ensure_ascii=False, indent=2, default=str)
    return vals

def main():
    token = get_token()
    folders = json.load(open(os.path.join(OUT, "_graph_folder_tree.json"), encoding="utf-8"))

    # 1. Full-mailbox date histogram: sweep /me/messages with minimal select, but that is 108k.
    #    Instead do per-folder for substantive ones. Start with key career-relevant folders.

    # Find ids by path
    by_path = {info["path"]: fid for fid, info in folders.items()}
    inbox_id = by_path.get("Inbox")
    sent_id = by_path.get("Sent Items")
    del_id = by_path.get("Deleted Items")

    select = "id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,importance"

    if sent_id:
        sent = sweep_folder(token, sent_id, "Sent Items", "_graph_sent_items.json", select)
    if del_id:
        sweep_folder(token, del_id, "Deleted Items", "_graph_deleted_items.json", select)
    if inbox_id:
        # Inbox proper (excluding subfolders) - query messages in just the inbox folder
        sweep_folder(token, inbox_id, "Inbox (root)", "_graph_inbox_root.json", select, max_pages=5000)

if __name__ == "__main__":
    main()
