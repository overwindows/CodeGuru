#!/usr/bin/env python3
"""Fetch AgenticGem catalog + all referenced files from ADO into a local mirror
that mirrors the $web blob URL layout for the showcase page.

Page served at web root /AgenticGem.PromptCatalog.html, so:
  - promptBase="../Prompts/"      -> /Prompts/<scenario>/<file>.md
  - schemaBase="../JsonSchema/"   -> /JsonSchema/<scenario>/<file>.json
  - .cs entry: "../"+path         -> browser normalizes ../ ../../../ away
                                     to the clean root-relative path

Output mirror root is --out (default Q:/AgenticGem_showcase/dist).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

from pathlib import Path
_LIVE_TOKEN = Path(r"C:\Users\wuc\.brain\BrainCore\.claude\skills\email-tools\script\auth\get_token.ps1")
_BACKUP_TOKEN = Path(r"C:\Users\wuc\Brain-backup\brain-skills\email-tools\script\auth\get_token.ps1")
TOKEN_PS1 = str(_LIVE_TOKEN if _LIVE_TOKEN.exists() else _BACKUP_TOKEN)
ORG = "ContentServices"
REPO = "CoreRanker"
BRANCH = "user/xiaoying/storyline_angle"
GEM = "src/GenerationAIServicePlatform/Agents/Kunlun/Kunlun.App/AgenticConfig/AgenticGem"

# Explicit ADO paths for the 3 model-call source files (located via tree scans)
SOURCE_FILES = [
    ("Services/InterestReranker.cs",
     f"{GEM}/Services/InterestReranker.cs"),
    ("Kunlun.Function/BertEmbeddingServices/BertEmbeddingService.cs",
     "src/GenerationAIServicePlatform/Agents/Kunlun/Kunlun.Function/BertEmbeddingServices/BertEmbeddingService.cs"),
    ("Clients/GemGrounding/GemReferDocRerankUtils.cs",
     "src/GenerationAIServicePlatform/Clients/GemGrounding/GemReferDocRerankUtils.cs"),
]


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
        start = text.find("{")
        end = text.rfind("}")
        return json.loads(text[start:end + 1])["token"]


_token = None


def token():
    global _token
    if _token is None:
        _token = get_token()
    return _token


def fetch_blob(path):
    path_enc = urllib.parse.quote(path, safe="/")
    url = (
        f"https://msasg.visualstudio.com/{ORG}/_apis/git/repositories/{REPO}/items"
        f"?path={path_enc}"
        f"&versionDescriptor[version]={urllib.parse.quote(BRANCH)}"
        f"&versionDescriptor[versionType]=branch"
        f"&api-version=5.0&download=true"
    )
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token()}",
        "Accept": "application/octet-stream, text/plain",
    })
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def build_filelist(catalog_json):
    data = json.load(open(catalog_json, encoding='utf-8'))
    entries = list(data.get("entries", [])) + list(data.get("dlisEntries", []))
    filelist = []
    for e in entries:
        p = e.get("path", "")
        sch = e.get("schema", "")
        if p and not p.endswith(".cs"):
            filelist.append({
                "web_path": "Prompts/" + p,
                "ado_path": f"{GEM}/Prompts/{p}",
                "kind": "prompt",
            })
        if sch.endswith(".json"):
            filelist.append({
                "web_path": "JsonSchema/" + sch,
                "ado_path": f"{GEM}/JsonSchema/{sch}",
                "kind": "schema",
            })
    for web_path, ado_path in SOURCE_FILES:
        filelist.append({"web_path": web_path, "ado_path": ado_path, "kind": "source"})
    # dedupe
    seen = {}
    for f in filelist:
        seen.setdefault(f["web_path"], f)
    return list(seen.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog-json", required=True,
                    default=r"Q:\CodeGuru\knowledgebase\raw\docs\agenticgem_catalog_storyline_angle.json")
    ap.add_argument("--out", default=r"Q:\AgenticGem_showcase\dist")
    ap.add_argument("--html", default=r"Q:\AgenticGem.PromptCatalog.html")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    filelist = build_filelist(args.catalog_json)
    print(f"file list: {len(filelist)} files")

    # include catalog html itself at web root
    files = [{"web_path": "AgenticGem.PromptCatalog.html",
              "ado_path": args.html, "kind": "html_local"}]
    files += filelist

    os.makedirs(args.out, exist_ok=True)
    ok, fail = [], []
    for f in files:
        dest = os.path.join(args.out, f["web_path"].replace("/", os.sep))
        os.makedirs(os.path.dirname(dest) or args.out, exist_ok=True)
        if args.dry_run:
            print("  [dry] " + f["web_path"])
            continue
        try:
            content = fetch_blob(f["ado_path"]) if f["kind"] != "html_local" else open(f["ado_path"], "rb").read()
            with open(dest, "wb") as fh:
                fh.write(content)
            ok.append(f["web_path"])
            print(f"  ok {f['web_path']} ({len(content)}B)")
        except urllib.error.HTTPError as e:
            fail.append((f["web_path"], e.code))
            print(f"  FAIL {f['web_path']} -> HTTP {e.code}")

    print(f"\nOK={len(ok)} FAIL={len(fail)}")
    if fail:
        for w, c in fail:
            print("   failed:", w, c)
        sys.exit(1)


if __name__ == "__main__":
    main()
