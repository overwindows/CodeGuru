#!/usr/bin/env python3
"""Restyle the Chrona Showcase Hub pages to Microsoft Fluent 2 (light) design.

Strategy:
  1. Every page is CSS-variable-driven. We replace its `:root` block wholesale
     with a Fluent light palette that maps every variable name the page already
     uses (--bg, --card, --line, --ok, ...) to a Fluent value -- so ALL of the
     page's downstream CSS + JS keeps working while the whole page goes light.
  2. We inject the shared Fluent base CSS (typography, links, tables, cards,
     badges, footer, and the shared hub masthead `.fl-hub` + site nav) into each
     page's own <style> block, right after the <head...> <style> opener.
  3. We inject the hub masthead <header class="fl-hub"> right after <body>.
  4. Content/JS are never touched -- only <style> and <head><body> regions.

The FLUENT base block below is the shared design system. It intentionally does
NOT redefine :root (each page already gets one via the per-page root override),
so we inject only the base rules.

Run from Q:/CodeGuru. Idempotent.
"""
import io, os, re, hashlib

STAGING = r"Q:\CodeGuru\scratch\site_index\staging_web"
DIST = r"Q:\AgenticGem_showcase\dist"

# ---------------------------------------------------------------------------
# Shared Fluent 2 (light) design-system base CSS (injected into every page).
# NOTE: no `:root` here -- the per-page root override supplies tokens.
# ---------------------------------------------------------------------------
FLUENT = r"""
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font, "Segoe UI Variable","Segoe UI",system-ui,sans-serif);line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent-hover,var(--accent));text-decoration:underline}
h1,h2,h3{font-weight:600;letter-spacing:-0.01em}
/* Normalize any residual serif headings (e.g. AgenticGem catalog) to Segoe. */
h1,h2,h3,.stat strong,.section-head h2,.entry h3,blockquote{font-family:var(--font,"Segoe UI Variable","Segoe UI",system-ui,sans-serif)}
code{font-family:var(--mono,"Cascadia Code",Consolas,monospace)}
::selection{background:#d4e8fb}

/* ---- Shared hub masthead + site nav ---- */
.fl-hub{background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:100;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.fl-hub-inner{max-width:1280px;margin:0 auto;padding:9px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.fl-hub-brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:13.5px;color:var(--ink);white-space:nowrap}
.fl-hub-logo{width:18px;height:18px;border-radius:4px;background:var(--accent);flex:0 0 auto;display:inline-block}
.fl-hub-nav{display:flex;gap:2px;flex-wrap:wrap;margin-left:auto}
.fl-hub-nav a{color:var(--mut);font-size:12.5px;padding:5px 10px;border-radius:5px;text-decoration:none;font-weight:500}
.fl-hub-nav a:hover{background:var(--nav-hover,var(--bg2));color:var(--ink);text-decoration:none}
.fl-hub-nav a.active{color:var(--accent);background:var(--accent-soft);font-weight:600}
@media(max-width:760px){.fl-hub-nav{margin-left:0;width:100%}}

/* ---- Shared page footer ---- */
.fl-foot{max-width:1280px;margin:0 auto;padding:20px;color:var(--mut2);font-size:11.5px;border-top:1px solid var(--line)}
"""

# Page -> (filename, home-flag). Order defines the nav.
NAV_ITEMS = [
    ("index.html", "Home"),
    ("AgenticGem.PromptCatalog.html", "AgenticGem Catalog"),
    ("ask-chen.html", "Ask-Chen"),
    ("openjev-ft.html", "OpenJev"),
    ("one_unified.html", "One Unified"),
    ("vllm-gemma4.html", "vLLM Gemma4"),
    ("newsrank.html", "NewsRank"),
    ("bench_models.html", "Benchmarks"),
    ("speculators.html", "Speculators"),
    ("reproduce_s2_best.html", "Reproduce S2"),
]


def hub_html(page):
    links = []
    for f, label in NAV_ITEMS:
        cls = ' class="active"' if f == page else ""
        links.append(f'      <a href="{f}"{cls}>{label}</a>')
    nav = "\n".join(links)
    return (
        '<header class="fl-hub">\n  <div class="fl-hub-inner">\n'
        '    <div class="fl-hub-brand"><span class="fl-hub-logo"></span>Chrona Showcase Hub</div>\n'
        f'    <nav class="fl-hub-nav">\n{nav}\n    </nav>\n'
        '  </div>\n</header>\n'
    )


def inject_after_body(html, page):
    m = re.search(r"<body[^>]*>", html, re.I)
    if not m:
        return html, False
    return html[:m.end()] + "\n" + hub_html(page) + html[m.end():], True


def dedupe(html, block):
    """Remove every occurrence of block after the first."""
    if not block:
        return html
    first = html.find(block)
    if first == -1:
        return html
    rest = html[first + len(block):]
    return html[:first + len(block)] + rest.replace(block, "")


BASE_START = "*{box-sizing:border-box}\nhtml{scroll-behavior:smooth}"
BASE_END = "/* ---- Shared page footer ---- */"


# One injected base CSS block, anchored NON-GREEDILY so it consumes exactly
# one unit:
#   * leading line unique to FLUENT: `*{box-sizing:border-box}\nhtml{...}`
#     (the pages' own CSS uses `* { box-sizing:border-box; }` with spaces, so
#     it never matches here) and
#   * terminating `.fl-foot{...}` rule, which exists only in FLUENT.
# Because the mid-section is lazy, stacked copies from a prior unguarded run
# each match separately and are all removed, but the page's own CSS -- which
# has neither the FLUENT preamble nor a .fl-foot rule -- is never touched.
FLUENT_UNIT = re.compile(
    r"\n*\*\{box-sizing:border-box\}\nhtml\{scroll-behavior:smooth\}[\s\S]*?"
    r"/\* ---- Shared page footer ---- \*/\s*\.fl-foot\{[^{}]*\}\n*")


def _replace_injected_base(html, new_block):
    """Replace every previously-injected FLUENT base CSS block (including any
    stacked duplicates) with the current block, or inject it fresh if absent.
    Never touches the page's own CSS."""
    html, n = FLUENT_UNIT.subn("", html)
    block = new_block.strip("\n")
    # Inject (or re-inject) right before the closing </style> so the base
    # rules come LAST and win the cascade over the page's own declarations
    # (e.g. the catalog's residual `Georgia` headings).
    se = re.search(r"</style\s*>", html, re.I)
    if se:
        head, rest = html[:se.start()], html[se.end():]
        if head and not head.endswith("\n"):
            head += "\n"
        return head + block + "\n" + se.group(0) + rest
    m = re.search(r"<head[^>]*>", html, re.I)
    if m:
        return html[:m.end()] + "\n<style>" + block + "\n</style>\n" + html[m.end():]
    return block + html


def dedupe_hub(html):
    """Keep only the first complete hub masthead block."""
    pat = re.compile(r'<header class="fl-hub">.*?</header>', re.S)
    return _keep_first(html, pat)


def _keep_first(html, pat):
    first = pat.search(html)
    if not first:
        return html
    kept = first.group(0)
    rest = html[first.end():]
    rest = pat.sub("", rest)
    return html[:first.start()] + kept + rest


# ---------------------------------------------------------------------------
# Fluent :root remap -- map each page's OWN variable names to Fluent values.
# ---------------------------------------------------------------------------
LIGHT = {
    "bg": "#faf9f8", "bg2": "#f3f2f1", "paper": "#ffffff", "surface": "#ffffff",
    "card": "#ffffff", "card2": "#f3f2f1", "panel": "#ffffff", "panel2": "#f7f6f5",
    "line": "#e1dfdd", "line2": "#c8c6c4",
    "ink": "#1b1a19", "txt": "#1b1a19", "text": "#1b1a19", "tx": "#1b1a19", "body": "#1b1a19",
    "mut": "#605e5c", "muted": "#605e5c", "mut2": "#8a8886", "dim": "#8a8886",
    "accent": "#0f6cbd", "accent2": "#2760ae", "accent3": "#0f6cbd", "brand": "#0f6cbd",
    "highlight": "#e3f0fa", "chip": "#e3f0fa", "chipb": "#0f6cbd",
    "ok": "#0f7b0f", "green": "#0f7b0f", "success": "#0f7b0f",
    "warn": "#9d5d00", "bad": "#c42b1c", "red": "#c42b1c", "error": "#c42b1c",
    "run": "#0f6cbd", "blue": "#0f6cbd", "cyan": "#0f6cbd", "info": "#0f6cbd",
    "gold": "#9d5d00", "amber": "#9d5d00", "ax": "#9d5d00", "sb": "#0f6cbd",
    "head": "#f3f2f1", "thead": "#f8f8f8", "code": "#f3f2f1", "code2": "#f3f2f1",
    "green-soft": "#e3f0fa", "coral": "#0f6cbd", "coral-soft": "#e3f0fa", "gold-soft": "#fdf4dc",
    "shadow": "0 1.6px 3.6px rgba(0,0,0,.13),0 .3px .9px rgba(0,0,0,.11)",
    "radius": "8px", "round": "8px",
    "font": '"Segoe UI Variable","Segoe UI",system-ui,sans-serif',
    "mono": '"Cascadia Code",Consolas,monospace',
    "nav-hover": "#edebe9", "accent-hover": "#115ea3", "accent-soft": "#e3f0fa",
}
# Extra names that may appear on some pages but mapped to Fluent-neutral.
for _k in ("banner", "cardbg", "soft", "subtle", "edge"):
    LIGHT.setdefault(_k, "#f3f2f1")


ROOT_RE = re.compile(r"\s*:root\s*\{.*?\}", re.S)


def fluent_root(existing_names):
    """Build a :root block defining Fluent values for the union of the page's
    existing custom var names plus our standard token set."""
    parts = ["  :root {"]
    for name in sorted(set(LIGHT) | set(existing_names)):
        parts.append(f"    --{name}:{LIGHT.get(name, '#1b1a19')};")
    parts.append("  }")
    return "\n".join(parts)


def rewrite_root(html):
    m = ROOT_RE.search(html)
    if not m:
        return html, False
    names = set(re.findall(r"--([a-zA-Z0-9_-]+)\s*:", m.group(0)))
    return html[:m.start()] + "\n" + fluent_root(names) + html[m.end():], True


# ---------------------------------------------------------------------------
# Light-theme fixes for hard-coded dark leftovers (gradients/chips).
# ---------------------------------------------------------------------------
def patch_css(css):
    repl = [
        # dark hero/card gradients -> light surfaces
        ("background:linear-gradient(135deg,#1e293b,#0f172a)", "background:var(--surface)"),
        ("background:linear-gradient(135deg,#16233d,#1a2233)", "background:var(--card)"),
        ("body{background:radial-gradient(1200px 600px at 80% -10%,#1e293b55,transparent),var(--bg)",
         "body{background:var(--bg)"),
        ("body { background:radial-gradient(1200px 600px at 70% -10%, #16324d 0%, var(--bg) 55%)",
         "body { background:var(--bg)"),
        ("header { position:sticky; top:0; z-index:50; background:rgba(11,18,32,.82)",
         "header { position:sticky; top:0; z-index:50; background:rgba(255,255,255,.9)"),
        # translucent chips -> legible light chips
        ("background:rgba(56,189,248,.1)", "background:#e3f0fa"),
        ("background:rgba(52,211,153,.1)", "background:#e9f5e9"),
        ("background:rgba(251,113,133,.1)", "background:#fbeae8"),
        ("background:rgba(251,191,36,.1)", "background:#fdf4dc"),
        ("background:rgba(79,157,255,.15)", "background:#e3f0fa"),
        ("background:rgba(61,214,140,.15)", "background:#e9f5e9"),
        ("background:rgba(255,93,115,.15)", "background:#fbeae8"),
        ("background:rgba(245,185,66,.15)", "background:#fdf4dc"),
        ("background:rgba(154,167,189,.12)", "background:#f3f2f1"),
        # pre/code blocks that were dark -> keep dark-ish for contrast is fine,
        # but unify code chip bg to light grey
    ]
    for a, b in repl:
        css = css.replace(a, b)
    # Ensure body bg is light even if a gradient remains
    return css


# ---------------------------------------------------------------------------
# Portal enhancement (richer hero + refined cards).
# ---------------------------------------------------------------------------
PORTAL_PATCH = r"""
  header{padding:64px 0 34px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#f0f7fd 0%,var(--bg) 100%)}
  .eyebrow{color:var(--accent);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.14em}
  h1{font-family:var(--font);font-size:clamp(32px,5vw,52px);font-weight:600;letter-spacing:-0.025em;line-height:1.05;margin:10px 0 14px}
  .lede{max-width:820px;color:var(--mut);font-size:16.5px;line-height:1.6}
  main{padding:34px 0 70px}
  h2{font-family:var(--font);font-weight:600;font-size:22px;margin:42px 0 14px;letter-spacing:-0.01em}
  h2:first-child{margin-top:24px}
  h3{font-size:16px;margin:28px 0 10px}
  ul.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:14px}
  ul.cards li{border:1px solid var(--line);background:var(--surface);border-radius:10px;box-shadow:var(--shadow);transition:box-shadow .16s ease,transform .16s ease;overflow:hidden}
  ul.cards li:hover{box-shadow:0 6px 18px rgba(0,0,0,.14);transform:translateY(-2px)}
  ul.cards a{display:block;padding:20px 20px;text-decoration:none;color:var(--ink)}
  ul.cards a:hover{background:var(--accent-soft);text-decoration:none}
  ul.cards strong{display:block;font-size:15.5px;color:var(--accent);margin-bottom:6px;font-weight:600}
  ul.cards span{color:var(--mut);font-size:13px;line-height:1.5}
  ol.steps{padding-left:22px}
  ol.steps li{margin:12px 0}
  code{font-family:var(--mono);font-size:.92em;background:var(--bg2);padding:2px 6px;border-radius:5px;border:1px solid var(--line)}
  pre{background:#201f1e;color:#f3f2f1;padding:18px;border-radius:8px;overflow:auto;font:13px/1.6 var(--mono);border:1px solid var(--line)}
  .note{padding:15px 18px;border-left:3px solid var(--gold);background:var(--gold-soft);border-radius:0 8px 8px 0;line-height:1.55;border:1px solid var(--line);border-left-width:3px}
  footer{padding:26px 0 48px;color:var(--mut);border-top:1px solid var(--line);font-size:12.5px}
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def transform_file(path, page, is_portal=False):
    html = io.open(path, encoding="utf-8").read()
    orig = html

    # 0) Collapse any repeated injected artifacts (from prior unguarded runs).
    html = dedupe(html, FLUENT)
    html = dedupe(html, PORTAL_PATCH)
    html = dedupe_hub(html)

    # 1) Replace :root with the Fluent token map.
    html, _ = rewrite_root(html)

    # 2) Light-theme patches to the page's own CSS (fix dark leftovers).
    html = patch_css(html)

    # 3) Portal: append portal-specific overrides (idempotent marker check).
    if is_portal:
        if "translateY(-2px)" not in html:
            html = html.replace("</style>", "\n" + PORTAL_PATCH + "\n</style>", 1)

    # 4) Inject the shared base CSS fresh (replace any older injected block).
    html = _replace_injected_base(html, FLUENT)

    # 5) Inject hub masthead after <body> (skip if already present).
    if 'class="fl-hub"' not in html:
        html, _ = inject_after_body(html, page)

    md5 = hashlib.md5(html.encode("utf-8")).hexdigest()
    changed = html != orig
    io.open(path, "w", encoding="utf-8").write(html)
    return changed, md5, len(html)


def main():
    files = {
        "index.html": ("index.html", True),
        "AgenticGem.PromptCatalog.html": ("AgenticGem.PromptCatalog.html", False),
        "bench_models.html": ("bench_models.html", False),
        "newsrank.html": ("newsrank.html", False),
        "ask-chen.html": ("ask-chen.html", False),
        "one_unified.html": ("one_unified.html", False),
        "openjev-ft.html": ("openjev-ft.html", False),
        "reproduce_s2_best.html": ("reproduce_s2_best.html", False),
        "speculators.html": ("speculators.html", False),
        "vllm-gemma4.html": ("vllm-gemma4.html", False),
    }
    for f, (page, portal) in files.items():
        for base in (STAGING, DIST):
            p = os.path.join(base, f)
            if os.path.exists(p):
                ch, md5, n = transform_file(p, page, portal)
                print(f"{'CHG ' if ch else 'same'} {base}\\{f}  md5={md5}  {n}B")


if __name__ == "__main__":
    main()
