#!/usr/bin/env python3
"""Cross-platform prerequisite check for CodeGuru development."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PATH = Path.home() / ".codeguru" / "settings.json"


def run_version(cmd: list[str]) -> str | None:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        output = (result.stdout or result.stderr or "").strip()
        return output.splitlines()[0] if output else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def check_tool(label: str, command: str, version_args: list[str] | None = None) -> bool:
    path = shutil.which(command)
    if not path:
        print(f"[miss] {label} — not found in PATH")
        return False
    version = run_version([command, *(version_args or ["--version"])])
    detail = version or f"found at {path}"
    print(f"[ok]   {label} — {detail}")
    return True


def parse_node_major(version_line: str | None) -> int | None:
    if not version_line:
        return None
    token = version_line.removeprefix("v").split(".", 1)[0]
    return int(token) if token.isdigit() else None


def main() -> int:
    print("CodeGuru — dev environment check")
    print(f"Platform: {platform.system()} {platform.release()}")
    print()

    has_pkg = (REPO_ROOT / "package.json").is_file()
    if has_pkg:
        print("[ok]   package.json present at repo root")
    else:
        print("[info] No package.json — src-only checkout; see SETUP.md")

    check_tool("Git", "git")
    node_ok = check_tool("Node.js", "node")
    node_version = run_version(["node", "--version"])
    node_major = parse_node_major(node_version)
    if node_ok and node_major is not None and node_major < 18:
        print(f"[warn] Node.js {node_major} detected; Node 18+ is required")
    check_tool("Bun", "bun")
    check_tool("npm", "npm")

    node_modules = REPO_ROOT / "node_modules"
    if node_modules.is_dir():
        print("[ok]   node_modules present (dependencies installed)")
    else:
        print("[miss] node_modules — run ./scripts/install.sh or npm install")

    if SETTINGS_PATH.is_file():
        print(f"[ok]   settings file — {SETTINGS_PATH}")
    else:
        print(f"[info] No settings file at {SETTINGS_PATH}")
        print("       Run install script or copy scripts/settings.example.json")

    print()
    print("Next steps:")
    if not has_pkg:
        print("  - Obtain full repo with package.json, then run ./scripts/install.sh")
    elif not node_modules.is_dir():
        print("  - From repo root: ./scripts/install.sh  (macOS/Linux)")
        print("  - Or: .\\scripts\\install.ps1  (Windows)")
    else:
        print("  - bun run dev")
        if not SETTINGS_PATH.is_file():
            print("  - Configure ~/.codeguru/settings.json (see SETUP.md)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
