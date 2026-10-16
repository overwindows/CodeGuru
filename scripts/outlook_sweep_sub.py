import sys, json, time, os, re
sys.path.insert(0, r"Q:/CodeGuru/scripts")
from outlook_graph_lib import *

FOLDERS = [
    "Inbox/[EXTERNAL]", "Inbox/Nan Li", "Inbox/Liangjie Zhang", "Inbox/Yongdong Wang",
    "Inbox/Yulan Yan", "Inbox/Qi Zhang", "Inbox/MSN Business Update",
    "Inbox/Content Service Experiment And Metrics Analysis", "Inbox/SageProbe",
    "Inbox/APRD Learning Community", "Inbox/The Garage Beijing - GCR",
    "Inbox/MAI Employee Experiences", "Inbox/ToMe", "Inbox/Mustafa Suleyman",
    "Inbox/STCA Communications", "Inbox/Microsoft AI Asia GIVE", "Archive",
]

def main():
    token = get_token()
    folders = json.load(open(os.path.join(OUT, "_graph_folder_tree.json"), encoding="utf-8"))
    by_path = {info["path"]: fid for fid, info in folders.items()}
    select = "id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,importance"
    for path in FOLDERS:
        fid = by_path.get(path)
        if not fid:
            print("MISSING:", path); continue
        safe = re.sub(r'[^A-Za-z0-9]+','_', path).strip('_')
        outfile = f"_graph_{safe}.json"
        if os.path.exists(os.path.join(OUT, outfile)):
            print("SKIP (exists):", path); continue
        try:
            vals = api(token, f"/me/mailFolders/{enc(fid)}/messages",
                       params={"$top":200, "$select":select}, max_pages=100000)
            with open(os.path.join(OUT, outfile), "w", encoding="utf-8") as f:
                json.dump(vals, f, ensure_ascii=False, indent=2, default=str)
            print(f"[{path}] {len(vals)}; {dict(sorted(year_hist(vals).items()))}")
        except RuntimeError as e:
            print(f"[{path}] ERR {e}")

if __name__ == "__main__":
    main()
