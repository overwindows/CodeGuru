# CodeGuru Web UI

Browser interface for CodeGuru, backed by the same CLI agent used in the terminal.

## Features

- **Chat** (`/`) — multi-turn conversation with the full CodeGuru agent (file edits, bash, tools) when the CLI is available
- **Quick tasks** (`/legacy`) — one-shot code review, test generation, translation, etc.
- **Streaming** — Server-Sent Events for live assistant responses
- **Session resume** — continues CLI sessions across messages via `--resume`

## Prerequisites

1. Python 3.10+
2. CodeGuru CLI dependencies installed at the repo root (`npm install` or `bun install`)
3. LLM credentials in `~/.codeguru/settings.json` (same as the CLI)

Example settings:

```json
{
  "env": {
    "CODEGURU_BASE_URL": "https://api.sambanova.ai/v1",
    "CODEGURU_AUTH_TOKEN": "<your-api-key>",
    "CODEGURU_MODEL": "MiniMax-M2.7"
  }
}
```

## Install & run

```bash
cd CodeGuruAPI
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# From repo root (recommended — agent uses repo as workspace)
export CODEGURU_REPO_ROOT="$(cd .. && pwd)"
export CODEGURU_CWD="$CODEGURU_REPO_ROOT"

python app.py
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEGURU_REPO_ROOT` | parent of `CodeGuruAPI/` | Monorepo root (finds `src/entrypoints/cli.tsx`) |
| `CODEGURU_CWD` | repo root | Workspace directory for the agent |
| `CODEGURU_CLI` | auto-detect | Override CLI launch command (recommended: `bun run ../src/entrypoints/cli.tsx`) |
| `CODEGURU_ALLOW_NPX_BUN` | `0` | Set to `1` to fall back to `npx bun run …` if Bun is not installed |
| `CODEGURU_PERMISSION_MODE` | `acceptEdits` | Passed to `--permission-mode` |
| `CODEGURU_WEB_HOST` | `127.0.0.1` | Flask bind host |
| `CODEGURU_WEB_PORT` | `8080` | Flask bind port |
| `CODEGURU_WEB_FIXED_RESPONSE` | `Done` | Chat always replies with this text. Set to empty to disable. |
| `CODEGURU_WEB_USE_AGENT` | `0` | Set to `1` to run the full CodeGuru CLI agent instead of the fixed reply |
| `CODEGURU_WEB_SYSTEM_PROMPT` | `Always respond with exactly: Done` | Appended system prompt when `CODEGURU_WEB_USE_AGENT=1` |

## Configuration naming

All CodeGuru-owned code and settings use **`CODEGURU_*`** only (see `~/.codeguru/settings.json`).

When spawning the upstream CLI, `cli_env.py` translates `CODEGURU_*` into the env names that module expects internally. You do not need to set those in your config.

## Architecture

```
Browser  →  Flask (CodeGuruAPI/app.py)
              ├─ /api/chat/stream  →  agent_runner.py  →  cli_env.py  →  upstream CLI
              └─ /api/legacy/task  →  llm_client.py     →  OpenAI-compatible chat API
```

If the CLI is not found, chat falls back to a direct LLM conversation without tools.

## Azure deployment

The existing `.deployment` file still targets Azure App Service. Set `CODEGURU_REPO_ROOT`, install Bun/Node on the app service, and configure startup command:

```bash
gunicorn --bind=0.0.0.0 --timeout 600 app:app
```

(Add `gunicorn` to `requirements.txt` for production.)

## Legacy note

The original Flask form UI and `text-davinci-003` integration have been replaced. Quick tasks now use chat-completions via your configured provider.
