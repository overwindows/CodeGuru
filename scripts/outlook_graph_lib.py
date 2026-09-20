import sys, json, time, os, collections, urllib.parse
sys.path.insert(0, r"C:/Users/wuc/.brain/BrainCore/.claude/skills/teams")
import requests, jwt
from teams_token_manager import get_token_manager

BASE = "https://graph.microsoft.com/v1.0"
OUT = r"Q:/CodeGuru/knowledgebase/segments"

def get_token():
    m = get_token_manager(use_cache=True)
    return m.get_graph_token(force_refresh=False)[0]

def api(token, url, params=None, max_pages=100000, throttle=0.3):
    """url is relative path (may include $top in params). Handles 429/401."""
    values, pages = [], 0
    headers = {"Authorization": f"Bearer {token}"}
    full = BASE + url if url.startswith("/") else url
    while full and pages < max_pages:
        r = requests.get(full, headers=headers, params=params, timeout=90)
        if r.status_code == 429:
            retry = float(r.headers.get('Retry-After', 10)); time.sleep(retry+1); continue
        if r.status_code == 401:
            m = get_token_manager(use_cache=True); token,_ = m.get_graph_token(force_refresh=True)
            headers = {"Authorization": f"Bearer {token}"}; continue
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        data = r.json(); values.extend(data.get("value", []))
        full = data.get("@odata.nextLink"); params = None; pages += 1
        time.sleep(throttle)
    return values

def year_hist(values):
    h = collections.Counter()
    for m in values:
        d = m.get("receivedDateTime") or m.get("sentDateTime") or ""
        if d: h[d[:4]] += 1
    return h

def enc(seg):
    return urllib.parse.quote(str(seg), safe="")

def sweep_folder(token, fid, label, outfile, select, max_pages=100000):
    url = f"/me/mailFolders/{enc(fid)}/messages"
    vals = api(token, url, params={"$top":200, "$select": select}, max_pages=max_pages)
    print(f"  [{label}] swept {len(vals)}; by year: {dict(sorted(year_hist(vals).items()))}")
    with open(os.path.join(OUT, outfile), "w", encoding="utf-8") as f:
        json.dump(vals, f, ensure_ascii=False, indent=2, default=str)
    return vals
