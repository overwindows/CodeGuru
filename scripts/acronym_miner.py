#!/usr/bin/env python3
"""
acronym_miner.py — scan the MSN/career knowledge base for all-caps acronyms and extract
in-corpus expansions via "(ACRONYM)" and "ACRONYM (" patterns.

Outputs a markdown glossary and a JSON table of counts/expansions. Reusable via the
career-kb skill so internal-acronym questions can be answered from the corpus directly.

Usage:
    python acronym_miner.py --kb Q:/CodeGuru/knowledgebase --out Q:/CodeGuru/knowledgebase
                            [--min-count N] [--top N]
"""
import argparse, json, re, sys, os
from pathlib import Path
import collections, unicodedata

# All-caps acronym: 2-8 uppercase letters (allow optional digits, but prefer pure alpha
# for good expansions). Exclude common false positives (single letters, units, HTML, etc).
ACRO = re.compile(r'\b([A-Z][A-Z][A-Z0-9]{0,6})\b')
# Expansion patterns: "(ACRO)" or "ACRO (" with capitalized words following
EXPAND1 = re.compile(r'\(([A-Z][A-Z0-9]{1,7})\)', re.I)          # (DoCA)
EXPAND2 = re.compile(r'\b([A-Z][A-Z0-9]{1,7})\s+\(([A-Za-z][A-Za-z &%\-]{3,80})\)', re.I)  # ABC (full text)
EXPAND3 = re.compile(r'\b([A-Za-z][\w &/\-%]{3,80}?)\s+\(([A-Z][A-Z0-9]{1,7})\)', re.I)   # full text (ABC)

STOP = set("""THE AND FOR YOU ARE THE OR WITH FROM YOUR THIS THAT HAVE NOT ONE ALL CAN
WILL HAD HAS OUR OFF ALL-MAIL TO CC BCC RE FW FWD SENT FROM HTTP HTTPS HTML CSS JSON XML FTP
URL DLL SMB API IAM OK AM PM MIN MAX WWW COM ORG NET GOV MIL INT USA US UK EU PRC CN WEB
GET POST PUT SEV SEA SQL KQL DLL EXE MSI BUILD TIA APAC EMBED VS VSC V1 V2 V3 P1 P2 P3 P0
FY26 FY27 FY25 FY24 FY23 FY22 NOV SEP AUG JUL JUN MAY APR MAR FEB JAN DEC OCT MON TUE WED
THU FRI SAT SUN GMT UTC EST EDT PST CST""".split())

# Really high-frequency noise that pollutes (add as discovered)
NOISE = {
    "RE","FW","FWD","PM","AM","OK","OKAY","WIP","TBD","N/A","FYI","ASAP","BTW","IMO","IL","IR",
    "SEV","SLA","KPI","OKR","WRI","WRK","PRQ","SDO","CQ","DO","VS","ET","AL","CDO","EQ","AB","IQ",
    "CC","BCC","RE","REF","ID","UID","GID","PID","IP","IM","SV","AP","DN","Mtn","MTP","EL","ML",
}


def normalize_text(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def iter_texts(seg_dir: Path, notes_dir: Path):
    """Yield (source_label, text) from all graph JSON dumps and all segment markdown notes."""
    json_files = sorted(seg_dir.glob("_graph_*.json")) + sorted(seg_dir.glob("*_graph_*.json"))
    for jf in json_files:
        try:
            data = json.load(open(jf, encoding="utf-8"))
        except Exception as e:
            print(f"[warn] can't load {jf}: {e}", file=sys.stderr)
            continue
        msgs = data if isinstance(data, list) else data.get("messages", data.get("value", []))
        if not isinstance(msgs, list):
            continue
        texts = []
        for m in msgs:
            if not isinstance(m, dict):
                continue
            parts = [str(m.get(k, "")) for k in ("subject", "bodyPreview")]
            texts.append(" ||| ".join(parts))
        yield jf.name, "\n".join(texts)
    for md in sorted(notes_dir.glob("*.md")):
        try:
            yield md.name, open(md, encoding="utf-8").read()
        except Exception as e:
            print(f"[warn] can't load {md}: {e}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kb", default="Q:/CodeGuru/knowledgebase")
    ap.add_argument("--out", default="Q:/CodeGuru/knowledgebase")
    ap.add_argument("--min-count", type=int, default=3)
    ap.add_argument("--top", type=int, default=300)
    args = ap.parse_args()
    seg = Path(args.kb) / "segments"
    notes = Path(args.kb)

    counts = collections.Counter()
    expansions = collections.defaultdict(collections.Counter)   # acro -> expansion phrase -> count
    per_source = collections.defaultdict(collections.Counter)

    for label, text in iter_texts(seg, notes):
        text = normalize_text(text)
        for m in ACRO.finditer(text):
            a = m.group(1)
            # filter
            if a in STOP or a in NOISE or a.isdigit():
                continue
            # require at least one vowel-containing possibility is skipped; keep all and rank
            counts[a] += 1
            per_source[a][label] += 1
        # expansion patterns
        for m in EXPAND2.finditer(text):
            acro, phrase = m.group(1).upper(), m.group(2).strip()
            if phrase and not phrase[0].islower() and len(phrase) > 3:
                expansions[acro][phrase] += 1
        for m in EXPAND3.finditer(text):
            phrase, acro = m.group(1).strip(), m.group(2).upper()
            if phrase and not phrase[0].islower() and len(phrase) > 3:
                expansions[acro][phrase] += 1
        for m in EXPAND1.finditer(text):
            pass  # "(Abc)" style gives the word but not before; handled by EXPAND2/3

    # Also detect "(Acronym)" alone and match to known maybe—we rely on 2/3.

    # Build rows
    rows = []
    for acro, c in counts.most_common():
        if c < args.min_count:
            continue
        best = expansions[acro].most_common(3)
        rows.append((acro, c, best))

    # Write JSON
    table = [{"acronym": a, "count": c, "top_expansions": [p for p,_ in ex]} for a,c,ex in rows[:args.top]]
    json_path = os.path.join(args.out, "glossary_scan_table.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(table, f, ensure_ascii=False, indent=2)

    # Write markdown glossary
    md = ["# Internal Glossary — auto-scanned from corpus", "",
          f"Scanned {len(list(iter_texts(seg, notes)))} sources. Ranked by frequency. "
          "Expansions are the most common in-corpus phrases paired with the acronym.",
          "",
          "| Acronym | Count | Top in-corpus expansion(s) |", "|---|---|---|"]
    for a, c, ex in rows[:args.top]:
        exs = " ; ".join(f"{p} ({n})" for p, n in ex) if ex else "—"
        md.append(f"| {a} | {c} | {exs} |")
    out_md = os.path.join(args.out, "glossary_auto.md")
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(md))
    print(f"wrote {json_path} and {out_md}")
    print(f"acronyms (count>={args.min_count}): {sum(1 for _,c,_ in rows if c>=args.min_count)}")
    print("top 40:")
    for a, c, ex in rows[:40]:
        print(f"  {a:12s} {c:6d} {(' | '.join(p for p,_ in ex[:1]))[:70]}")


if __name__ == "__main__":
    main()
