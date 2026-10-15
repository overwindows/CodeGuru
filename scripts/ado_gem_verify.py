#!/usr/bin/env python3
"""Verify the published AgenticGem showcase: fetch the page, parse every href
built by the render logic (promptBase/schemaBase/.cs), and check each resolves
200 on the live blob endpoint."""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

BASE = "https://privacypshowcase12114.z19.web.core.windows.net"
PAGE = f"{BASE}/AgenticGem.PromptCatalog.html"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "codeguru-verify"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


def main():
    catalog_json = r"Q:\CodeGuru\knowledgebase\raw\docs\agenticgem_catalog_storyline_angle.json"
    data = json.load(open(catalog_json, encoding='utf-8'))
    entries = list(data.get("entries", [])) + list(data.get("dlisEntries", []))

    # Build the set of URLs the page will link to (mirror render logic)
    targets = []
    targets.append(PAGE)  # the page itself
    for e in entries:
        p = e.get("path", "")
        sch = e.get("schema", "")
        if p.endswith(".cs"):
            parts = [x for x in p.split('/') if x != '..']
            targets.append(f"{BASE}/{'/'.join(parts)}")
        elif p:
            targets.append(f"{BASE}/Prompts/{p}")
        if sch.endswith(".json"):
            targets.append(f"{BASE}/JsonSchema/{sch}")

    # Also check all CSS/JS assets referenced by <link>/<script src>
    html = get(PAGE)[1].decode('utf-8', 'replace')
    for m in re.finditer(r'''(?:href|src)="([^"#]+)"''', html):
        u = m.group(1)
        if u.startswith('${'):  # JS template literal in render code, not a real href
            continue
        if u and not u.startswith('http'):
            targets.append(urllib.parse.urljoin(BASE + "/", u))

    seen = set()
    print(f"verifying {len(targets)} URLs...")
    fail = []
    for t in targets:
        if t in seen:
            continue
        seen.add(t)
        try:
            code, _ = get(t)
            if code != 200:
                fail.append((t, code))
            else:
                print(f"  {code} {t}")
        except Exception as ex:
            fail.append((t, str(ex)))
    print(f"\nURLs checked: {len(seen)}, failures: {len(fail)}")
    if fail:
        for u, c in fail:
            print("  FAIL", c, u)
        sys.exit(1)
    print("ALL LINKS RESOLVE (HTTP 200)")


if __name__ == "__main__":
    main()
