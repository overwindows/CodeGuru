import json, subprocess
from cli_env import subprocess_env

env = subprocess_env()
env["NODE_ENV"] = "test"

# Turn 1
cmd1 = ["/opt/homebrew/bin/bun", "run", "/Users/chenw/CodeGuru/src/entrypoints/cli.tsx",
        "-p", "say hello", "--verbose", "--output-format", "stream-json",
        "--permission-mode", "acceptEdits", "--add-dir", "/Users/chenw/CodeGuru"]
p1 = subprocess.run(cmd1, cwd="/Users/chenw/CodeGuru", env=env, capture_output=True, text=True, timeout=60)
sid = None
for line in p1.stdout.splitlines():
    try:
        o = json.loads(line)
        if o.get("type")=="system" and o.get("subtype")=="init":
            sid = o.get("session_id")
        if o.get("type")=="result":
            print("turn1 result", o.get("subtype"), o.get("is_error"))
    except: pass
print("session_id", sid)

# Turn 2 with --continue
cmd2 = cmd1[:]
cmd2[4] = "what did I just say?"
cmd2 = [c for c in cmd2 if c != "--add-dir" and c != "/Users/chenw/CodeGuru"]
cmd2.extend(["--continue", "--add-dir", "/Users/chenw/CodeGuru"])
p2 = subprocess.run(cmd2, cwd="/Users/chenw/CodeGuru", env=env, capture_output=True, text=True, timeout=60)
for line in p2.stdout.splitlines():
    try:
        o = json.loads(line)
        if o.get("type")=="result":
            print("turn2 result", o.get("subtype"), o.get("is_error"), "sid", o.get("session_id"))
        if o.get("type")=="assistant":
            text = "".join(b.get("text","") for b in o.get("message",{}).get("content",[]) if b.get("type")=="text")
            if text: print("assistant:", text[:120])
    except: pass
print("exit", p2.returncode)