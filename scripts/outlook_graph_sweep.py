#!/usr/bin/env python3
"""outlook_graph_sweep.py — enumerate the full folder tree with item counts.

Writes `_graph_folder_tree.json` (id -> {name, path, total, parent}), which
downstream sweeps (`outlook_sweep_run.py` / `outlook_sweep_sub.py`) read to
resolve folder ids by path. Also prints the top 40 folders by item count.

Run:
    python outlook_graph_sweep.py
"""
import sys, os, json
sys.path.insert(0, r"Q:/CodeGuru/scripts")
from outlook_graph_lib import OUT, all_folders, get_token


def main():
    token = get_token()
    folders = all_folders(token)
    print(f">>> Total folders: {len(folders)}")
    by_total = sorted(folders.items(), key=lambda x: -(x[1]['total'] or 0))
    print("\nFolders by item count (top 40):")
    for fid, info in by_total[:40]:
        print(f"  {info['total']:>6}  {info['path']}")
    with open(os.path.join(OUT, "_graph_folder_tree.json"), "w") as f:
        json.dump(folders, f, indent=2)
    grand = sum((i['total'] or 0) for i in folders.values())
    print(f"\n>>> Grand total items across all folders: {grand}")


if __name__ == "__main__":
    main()
