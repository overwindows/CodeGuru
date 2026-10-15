import sys, json, time, os
sys.path.insert(0, r"Q:/CodeGuru/scripts")
from outlook_graph_lib import *

def main():
    token = get_token()
    folders = json.load(open(os.path.join(OUT, "_graph_folder_tree.json"), encoding="utf-8"))
    by_path = {info["path"]: fid for fid, info in folders.items()}
    select = "id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,importance"

    which = sys.argv[1]
    if which == "sent":
        fid = by_path.get("Sent Items")
        sweep_folder(token, fid, "Sent Items", "_graph_sent_items.json", select)
    elif which == "inbox":
        fid = by_path.get("Inbox")
        sweep_folder(token, fid, "Inbox-root", "_graph_inbox_root.json", select)
    elif which == "deleted":
        fid = by_path.get("Deleted Items")
        sweep_folder(token, fid, "Deleted", "_graph_deleted_items.json", select)
    elif which == "full":
        # sweep entire /me/messages (108k) - the whole mailbox
        vals = api(token, "/me/messages", params={"$top":200,"$select":select}, max_pages=100000)
        print(f"[FULL] swept {len(vals)}; by year: {dict(sorted(year_hist(vals).items()))}")
        with open(os.path.join(OUT, "_graph_all_messages.json"), "w", encoding="utf-8") as f:
            json.dump(vals, f, ensure_ascii=False, indent=2, default=str)
    else:
        # arbitrary folder path
        fid = by_path.get(which)
        if not fid:
            print("no folder", which); return
        import re
        safe = re.sub(r'[^A-Za-z0-9]+','_', which)
        sweep_folder(token, fid, which, f"_graph_{safe}.json", select)

if __name__ == "__main__":
    main()
