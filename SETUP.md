# CodeGuru setup

This repo has two install paths:

| Path | What you get |
|------|----------------|
| **A. CLI (recommended)** | Interactive coding agent — run from source with Bun/Node |
| **B. Python doc tool** | Convert a design `.docx` into a project directory layout |

---

## A. CodeGuru CLI (develop from source)

You do **not** need to build anything to try the CLI locally — install dependencies and run the dev entrypoint.

### Quick install (scripted)

| Platform | Command |
|----------|---------|
| **macOS / Linux** | `./scripts/install.sh` |
| **Windows (PowerShell)** | `.\scripts\install.ps1` |

The scripts will:

1. Check for **Node.js 18+** and **Bun**
2. Run `npm install --legacy-peer-deps` and pin compatible React packages
3. Create `~/.codeguru/settings.json` from a template (if missing)

### Manual install

#### Prerequisites

**macOS**

```bash
# Node.js (fnm recommended)
brew install fnm
fnm install 22
eval "$(fnm env --use-on-cd)"

# Bun
curl -fsSL https://bun.sh/install | bash
```

**Linux**

```bash
# Node.js via fnm
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 22
eval "$(fnm env --use-on-cd)"

# Bun
curl -fsSL https://bun.sh/install | bash
```

**Windows**

```powershell
winget install Schniz.fnm
fnm install 22
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression

winget install Oven-sh.Bun
# or: npm install -g bun
```

#### Install dependencies

From the **project root** (this folder — not only `src/`):

```bash
npm install --legacy-peer-deps
npm install react@^19.0.0 react-reconciler@0.34.0-canary-ed69815c-20260323 --legacy-peer-deps
```

On macOS/Linux you can use `bun install` instead of npm if you prefer.

#### Configure your model provider

Create settings at:

- **macOS / Linux:** `~/.codeguru/settings.json`
- **Windows:** `%USERPROFILE%\.codeguru\settings.json`

Copy from `scripts/settings.example.json` or use:

```json
{
  "env": {
    "CODEGURU_BASE_URL": "https://api.sambanova.ai/v1",
    "CODEGURU_AUTH_TOKEN": "<your-api-key>",
    "CODEGURU_MODEL": "MiniMax-M2.7",
    "CODEGURU_DEFAULT_HAIKU_MODEL": "MiniMax-M2.7",
    "CODEGURU_CODE_AUTO_COMPACT_WINDOW": "200000",
    "CODEGURU_AUTOCOMPACT_PCT_OVERRIDE": "60"
  },
  "theme": "auto"
}
```

All `CODEGURU_*` keys are bridged to `ANTHROPIC_*` / `CLAUDE_*` at runtime. Any OpenAI-compatible provider works: set `CODEGURU_BASE_URL` (include `/v1`), `CODEGURU_AUTH_TOKEN`, and `CODEGURU_MODEL`.

**Anthropic API key (alternative):**

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # macOS / Linux
```

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."   # Windows
```

#### Run

```bash
bun run dev
# or
bun run codeguru
```

#### Check prerequisites

```bash
python3 scripts/check-dev-environment.py
# or
bun run check-env
```

### Official installer (no build)

To **use** Claude Code without compiling this repo:

- **Windows:** `irm https://claude.ai/install.ps1 | iex` or `winget install Anthropic.ClaudeCode`
- **macOS / Linux:** [Claude Code setup](https://code.claude.com/docs/en/setup)

Then run `claude` in your project.

---

## B. Python design-doc tool

Converts a Word design document into markdown and a generated project layout.

### Prerequisites

- **Python 3.10+**
- **pandoc** (for docx → markdown): `brew install pandoc` on macOS

### Install

From the project root:

```bash
python3 -m venv .venv
source .venv/bin/activate          # macOS / Linux
# .venv\Scripts\Activate.ps1       # Windows

pip install -r requirements.txt
pip install -e .
```

Or use the helper script (macOS / Linux):

```bash
./scripts/install-python.sh
```

### Run

```bash
guru path/to/design.docx
```

Options: `-m` markdown output dir, `-o` code output dir (see `python -m src.main --help`).

Set Azure OpenAI credentials in your environment before running (see `src/azure_openai.py`).

---

## Environment variables (CLI)

| Variable | Purpose |
|----------|---------|
| `CODEGURU_BASE_URL` | Custom API base URL (include `/v1`) |
| `CODEGURU_AUTH_TOKEN` | API token for OpenAI-compatible providers |
| `CODEGURU_MODEL` | Default model override |
| `ANTHROPIC_API_KEY` | Anthropic API key (alternative auth) |
| `ANTHROPIC_MODEL` | Default model override |
| `ANTHROPIC_BASE_URL` | Custom API base URL |

See `.env.example` for more optional overrides.

---

## Layout

```
CodeGuru/                 ← run install scripts HERE
  README.md
  SETUP.md
  package.json
  setup.py
  requirements.txt
  scripts/
    install.sh            ← macOS / Linux CLI install
    install.ps1           ← Windows CLI install
    install-python.sh     ← Python doc tool install
    check-dev-environment.py
    settings.example.json
  src/                    ← application source (see src/README.md)
```

---

## Internal / private packages

Some CLI source imports packages not on the public npm registry (`@ant/*`, `@anthropic-ai/claude-agent-sdk`, …). A raw checkout is enough to explore and typecheck much of the code, but `bun run dev` may fail on internal-only imports. For a supported production install, use the [official Claude Code setup](https://code.claude.com/docs/en/setup).
