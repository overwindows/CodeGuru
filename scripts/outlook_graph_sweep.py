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

def api(token, url, params=None, max_pages=100000, throttle=0.35):
    values = []
    headers = {"Authorization": f"Bearer {token}"}
    url = BASE + url
    pages = 0
    while url and pages < max_pages:
        r = requests.get(url, headers=headers, params=params, timeout=90)
        if r.status_code == 429:
            retry = float(r.headers.get('Retry-After', 10))
            print(f"  [429] throttle {retry}s", file=sys.stderr)
            time.sleep(retry + 1); continue
        if r.status_code == 401:
            # token expired - refresh
            m = get_token_manager(use_cache=True)
            token, _ = m.get_graph_token(force_refresh=True)
            headers = {"Authorization": f"Bearer {token}"}
            continue
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        data = r.json()
        values.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
        params = None
        pages += 1
        time.sleep(throttle)
    return values

def all_folders(token):
    """Recursively enumerate all mail folders."""
    folders = {}
    def walk(fid, path):
        url = f"/me/mailFolders/{fid}/childFolders?$top=999&$select=id,displayName,childFolderCount,totalItemCount,parentFolderId"
        try:
            children = api(token, url, max_pages=10)
        except RuntimeError:
            return
        for c in children:
            folders[c["id"]] = {"name": c.get("displayName"), "path": path + "/" + str(c.get("displayName")),
                                "total": c.get("totalItemCount", 0), "parent": c.get("parentFolderId")}
            walk(c["id"], folders[c["id"]]["path"])
    # root folders
    roots = api(token, "/me/mailFolders?$top=999&$select=id,displayName,childFolderCount,totalItemCount,parentFolderId")
    for r in roots:
        folders[r["id"]] = {"name": r.get("displayName"), "path": str(r.get("displayName")),
                            "total": r.get("totalItemCount", 0), "parent": r.get("parentFolderId")}
        walk(r["id"], folders[r["id"]]["path"])
    return folders

def main():
    token = get_token()
    # Enumerate all folders
    folders = all_folders(token)
    print(f">>> Total folders: {len(folders)}")
    # Print folder tree with counts
    by_total = sorted(folders.items(), key=lambda x: -(x[1]['total'] or 0))
    print("\nFolders by item count (top 40):")
    for fid, info in by_total[:40]:
        print(f"  {info['total']:>6}  {info['path']}")
    with open(os.path.join(OUT, "_graph_folder_tree.json"), "w") as f:
        json.dump(folders, f, indent=2)

    # Summary of counts
    grand = sum((i['total'] or 0) for i in folders.values())
    print(f"\n>>> Grand total items across all folders: {grand}")

if __name__ == "__main__":
    main()
