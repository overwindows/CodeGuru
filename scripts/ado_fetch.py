#!/usr/bin/env python3
"""Fetch an ADO file blob via Items API using a fresh ADO-audience token from Brain's get_token.ps1."""
import json
import subprocess
import sys
import urllib.parse
import urllib.request

TOKEN_PS1 = r"C:\Users\wuc\.brain\BrainCore\.claude\skills\email-tools\script\auth\get_token.ps1"


def get_token():
    ps = (
        f"import-module '{TOKEN_PS1}' -Force; "
        "Get-UserToken-Text -ServiceUri 'https://msasg.visualstudio.com'"
    )
    out = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"PowerShell token failed: {out.stderr}")
    text = out.stdout.strip()
    try:
        return json.loads(text)["token"]
    except (json.JSONDecodeError, TypeError):
        # Find the JSON object in the output (PowerShell may prepend noise)
        start = text.find("{")
        end = text.rfind("}")
        obj = json.loads(text[start:end + 1])
        return obj["token"]


def fetch(org, repo, path, branch):
    token = get_token()
    path_enc = urllib.parse.quote(path, safe="/")
    url = (
        f"https://msasg.visualstudio.com/{org}/_apis/git/repositories/{repo}/items"
        f"?path={path_enc}"
        f"&versionDescriptor[version]={urllib.parse.quote(branch)}"
        f"&versionDescriptor[versionType]=branch"
        f"&api-version=5.0&download=true"
    )
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/octet-stream, text/plain",
    })
    with urllib.request.urlopen(req) as resp:
        return resp.read()


if __name__ == "__main__":
    org = "ContentServices"
    repo = "CoreRanker"
    path = "/src/GenerationAIServicePlatform/Agents/Kunlun/Kunlun.App/AgenticConfig/AgenticGem/Doc/AgenticGem.PromptCatalog.html"
    branch = "user/xiaoying/storyline_angle"
    outfile = r"Q:\CoreRanker\AgenticGem.PromptCatalog.html"

    data = fetch(org, repo, path, branch)
    with open(outfile, "wb") as f:
        f.write(data)
    print(f"OK wrote {len(data)} bytes -> {outfile}")
