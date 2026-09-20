import sys, json, time, os, datetime
sys.path.insert(0, r"C:/Users/wuc/.brain/BrainCore/.claude/skills/teams")
import requests, jwt
from teams_token_manager import get_token_manager

BASE = "https://graph.microsoft.com/v1.0"
OUT = r"Q:/CodeGuru/knowledgebase/segments"

def get_token():
    m = get_token_manager(use_cache=True)
    token, upn = m.get_graph_token(force_refresh=False)
    return token

def api(token, url, params=None, max_pages=1000, throttle=0.4):
    """Paginated GET helper. Returns full list of values."""
    values = []
    headers = {"Authorization": f"Bearer {token}"}
    url = BASE + url
    pages = 0
    while url and pages < max_pages:
        r = requests.get(url, headers=headers, params=params, timeout=60)
        if r.status_code == 429:
            retry = float(r.headers.get('Retry-After', 5))
            print(f"  [429] throttled, sleeping {retry}s", file=sys.stderr)
            time.sleep(retry + 0.5)
            continue
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:500]}")
        data = r.json()
        values.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
        params = None
        pages += 1
        time.sleep(throttle)
    return values

def main():
    token = get_token()
    out = {}

    # 1. Probe: list mail folders
    print(">>> Probing /me/mailFolders")
    try:
        folds = api(token, "/me/mailFolders?$top=999&$select=id,displayName,parentFolderId,childFolderCount,totalItemCount&$expand=childFolders", max_pages=50)
        print(f"    got {len(folds)} top-level folders")
        out["folders"] = folds
    except RuntimeError as e:
        print("    FAILED folders:", e)
        with open(os.path.join(OUT, "_outlook_graph_probe.md"), "w") as f:
            f.write("# Outlook Graph Probe (Mail.Read availability)\n- source: outlook-graph\n- state: MAIL ACCESS FAILED\n\n- message: " + str(e) + "\n")
        return

    # 2. Try a small message test
    print(">>> Probing /me/messages?$top=5")
    try:
        msgs = api(token, "/me/messages?$top=5&$select=subject,from,receivedDateTime", max_pages=1, throttle=0)
        counts_by_year = {}
        print(f"    got {len(msgs)} messages; sample dates:")
        for m in msgs[:5]:
            d = m.get("receivedDateTime","?")
            print("      ", d, "|", (m.get('from') or {}).get('emailAddress',{}).get('address','?'), "|", m.get("subject","")[:60])
            y = d[:4] if d else "?"
            counts_by_year[y] = counts_by_year.get(y,0)+1
        out["probe_messages"] = msgs
    except RuntimeError as e:
        print("    message probe FAILED:", e)
        with open(os.path.join(OUT, "_outlook_graph_probe.md"), "w") as f:
            f.write("# Outlook Graph Probe\n- source: outlook-graph\n- state: FOLDERS OK, MESSAGES FAILED\n\n- msg_error: " + str(e) + "\n")
        return

    # Save probe json for the sweep step
    with open(os.path.join(OUT, "_graph_probe_state.json"), "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(">>> Saved probe state to _graph_probe_state.json")

if __name__ == "__main__":
    main()
