#!/usr/bin/env python3
"""ask_chen.py — the Ask-Chen answer worker + KB retrieval.

Colleagues' agents POST questions to the agentbus `/ask` endpoint. This module
answers each question with an LLM call that routes retrieval against Chen's
knowledge base (`Q:\\CodeGuru\\knowledgebase`), and returns a grounded answer.

The LLM call goes directly to the shared unified LLM router (OpenAI-compatible
`/v1/chat/completions`) that serves this CodeGuru install's model — no
subprocess, no separate `claude` CLI required. The prompt instructs the model
to ground everything in the KB and flag `needs_human` where it's silent.

Usage (normally driven by server.py's worker thread, not run directly):
    python ask_chen.py --question "What is the MSN ranking funnel?" --caller foo
"""
from __future__ import annotations

import argparse, json, os, re, sys, urllib.request
from pathlib import Path

# KB root is relocatable so the same worker can run locally (default) or from
# an Azure Functions package (AGENTBUS_KB points at the bundled copy).
KB_ROOT = os.environ.get("AGENTBUS_KB", r"Q:\CodeGuru\knowledgebase")

ROUTER_BASE = os.environ.get(
    "AGENTBUS_ROUTER", "https://llmrouter-axc7eaf4adc3f0g2.eastus-01.azurewebsites.net")
# Router token: from env, or the gitignored agentbus-secrets.json ({"ROUTER_TOKEN":
# "..."}), or empty (fail-closed). Never a committed literal.
def _router_token() -> str:
    tok = os.environ.get("AGENTBUS_ROUTER_TOKEN", "").strip()
    if tok:
        return tok
    secrets = Path(__file__).resolve().parent / "agentbus-secrets.json"
    try:
        tok = str(json.loads(secrets.read_text(encoding="utf-8"))
                  .get("ROUTER_TOKEN", "")).strip()
    except Exception:  # noqa: BLE001
        tok = ""
    return tok


ROUTER_TOKEN = _router_token()
MODEL = os.environ.get("AGENTBUS_MODEL", "deepseek-v4-flash")

# The answer recipe the model is asked to follow. Retrieval already happened in
# code (grep for the question's keywords across the KB docs + segments/), and
# the matching lines are injected as the EVIDENCE block. The model's only job
# is to compose a faithful, grounded answer from that evidence — never from its
# own memory — and to flag needs_human where the evidence is thin.
ROUTING = f"""You are answering a question on behalf of Chen Wu. Below is an EVIDENCE
block produced by grepping his knowledge base (`{KB_ROOT}`) for the question's
keywords. Ground your answer ONLY in that evidence — do not invent facts and do
not fall back on general knowledge.

Answer constraints:
- Answer ONLY what the evidence supports. Cite the source file names from the
  evidence as `sources` (use the paths shown in the `--- file ---` markers).
- Where the evidence is silent or only weakly covers the question, SAY SO
  explicitly and set `needs_human` to true — do not pad with generalities.
- If the question requires Chen's own judgment or current undocumented status,
  set `needs_human: true` and keep the answer short about known vs unknown.

Respond with a single JSON object (no markdown fences, no prose around it):
{{"answer": "<your answer>", "sources": ["<path>", ...], "confidence": <0..1>,
  "needs_human": <true|false>}}"""


def _call_llm(user_prompt: str, system: str) -> str:
    """Call the OpenAI-compatible router and return the assistant message text."""
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt},
        ],
        # The model's reasoning traces are stripped by the router; ask for
        # cheap structured output and keep cost/time bounded.
        "temperature": 0,
        "max_tokens": 1200,
    }
    req = urllib.request.Request(
        ROUTER_BASE + "/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + ROUTER_TOKEN,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("router returned no choices")
    return (choices[0].get("message") or {}).get("content") or ""


_STOP = {"the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "is",
         "what", "how", "why", "when", "which", "does", "do", "did", "msn",
         "ranking", "chen", "team", "model", "kbs"}


def _keywords(question: str) -> list[str]:
    """Strip case/punct, drop stopwords, return distinct keyword tokens."""
    toks = re.findall(r"[A-Za-z0-9_\-]+", question.lower())
    out = []
    for t in toks:
        if len(t) < 3:
            continue
        if t.rstrip("-_") in _STOP:
            continue
        if t not in out:
            out.append(t)
    return out[:8]


def _retrieve(question: str) -> str:
    """Grep the KB for question keywords and return a compact evidence block
    (which files matched + their matching lines). This is the retrieval step:
    the real facts come from here, not from the LLM's memory."""
    root = Path(KB_ROOT)
    if not root.is_dir():
        return "(knowledge base missing)"
    kws = _keywords(question)
    if not kws:
        return "(no searchable keywords in question)"

    # Priority: index, then numbered docs, then segments/.
    docs = []
    idx = root / "00_INDEX.md"
    if idx.exists():
        docs.append(idx)
    docs += sorted(p for p in root.glob("0*.md") if p.exists())
    segs = sorted((root / "segments").glob("*.md")) if (root / "segments").is_dir() else []
    docs += segs

    # Score candidate docs by how many distinct keywords they contain overall,
    # then show the specific matching lines for the top few.
    scored = []
    for p in docs:
        try:
            txt = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        hits = [k for k in kws if k in txt.lower()]
        if hits:
            scored.append((len(hits), p, txt))
    scored.sort(key=lambda x: -x[0])

    block = []
    for _, p, txt in scored[:6]:
        lines = []
        for n, line in enumerate(txt.splitlines(), 1):
            low = line.lower()
            if any(k in low for k in kws):
                lines.append(line.strip()[:240])
        block.append(f"--- {p.relative_to(root)} ({len(lines)} matches) ---")
        block.extend(lines[:40])
    return "\n".join(block)[:9000] if block else "(no KB matches found)"


def _prompt(question: str, caller: str, evidence: str) -> str:
    return f"""{ROUTING}

=== KNOWLEDGE BASE EVIDENCE (grep results for this question) ===
{evidence}
=== END EVIDENCE ===

Using ONLY the evidence block above (do not invent facts not in it), answer:
Question from {caller}:
{question}"""


def answer(question: str, caller: str = "unknown") -> dict:
    """Answer the question grounded in the KB; returns a dict for the answer table."""
    try:
        evidence = _retrieve(question)
        raw = _call_llm(_prompt(question, caller, evidence),
                        "You answer strictly from the provided evidence and "
                        "return JSON only.")
    except Exception as e:  # noqa: BLE001
        return _fallback(str(e)[:200], question)

    text = (raw or "").strip()
    # The model may wrap the object in markdown fences or stray prose.
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return _fallback("non-JSON model output", question)
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return _fallback("unparseable model output", question)

    answer_text = data.get("answer") or data.get("text") or ""
    if not answer_text or not answer_text.strip():
        return _fallback("empty answer", question)
    return {
        "answer": answer_text,
        "sources": data.get("sources") or [],
        "confidence": float(data.get("confidence") or 0.0),
        "needs_human": bool(data.get("needs_human") or data.get("needsHuman")),
    }


def _fallback(reason: str, question: str) -> dict:
    return {
        "answer": (
            f"Could not produce a KB-grounded answer ({reason}). The question "
            "needs Chen's own attention."
        ),
        "sources": [],
        "confidence": 0.0,
        "needs_human": True,
        "error": reason,
    }


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="ask_chen")
    ap.add_argument("--question", required=True)
    ap.add_argument("--caller", default="unknown")
    args = ap.parse_args(argv)
    print(json.dumps(answer(args.question, args.caller), ensure_ascii=False))


if __name__ == "__main__":
    main()
