#!/usr/bin/env python3
"""outlook_graph_probe.py — probe whether the Graph token can read mail.

Probes /me/mailFolders and a sample of /me/messages. On success writes
`_graph_probe_state.json` for downstream sweeps; on failure writes
`_outlook_graph_probe.md` with the error so the corpus records what's missing.

Run:
    python outlook_graph_probe.py
"""
import sys, json, os
sys.path.insert(0, r"Q:/CodeGuru/scripts")
from outlook_graph_lib import OUT, api, get_token


def main():
    token = get_token()
    out = {}

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

    print(">>> Probing /me/messages?$top=5")
    try:
        msgs = api(token, "/me/messages?$top=5&$select=subject,from,receivedDateTime", max_pages=1, throttle=0)
        counts_by_year = {}
        print(f"    got {len(msgs)} messages; sample dates:")
        for m in msgs[:5]:
            d = m.get("receivedDateTime", "?")
            print("      ", d, "|", (m.get('from') or {}).get('emailAddress', {}).get('address', '?'), "|", m.get("subject", "")[:60])
            y = d[:4] if d else "?"
            counts_by_year[y] = counts_by_year.get(y, 0) + 1
        out["probe_messages"] = msgs
    except RuntimeError as e:
        print("    message probe FAILED:", e)
        with open(os.path.join(OUT, "_outlook_graph_probe.md"), "w") as f:
            f.write("# Outlook Graph Probe\n- source: outlook-graph\n- state: FOLDERS OK, MESSAGES FAILED\n\n- msg_error: " + str(e) + "\n")
        return

    with open(os.path.join(OUT, "_graph_probe_state.json"), "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(">>> Saved probe state to _graph_probe_state.json")


if __name__ == "__main__":
    main()
