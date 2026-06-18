# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **CodeGuru CLI** repository — the development tree for the Claude Code interactive coding agent. It contains both the TypeScript CLI application (`src/`) and a Python design-doc tool (`src/azure_openai.py`, `src/layout_generation.py`, etc.).

## Common Commands

```bash
# Install dependencies (from CodeGuru/ directory, not src/)
npm install --legacy-peer-deps
npm install react@^19.0.0 react-reconciler@0.34.0-canary-ed69815c-20260323 --legacy-peer-deps

# Run the CLI locally (development)
bun run dev

# Type check
bun run typecheck

# Check dev environment prerequisites
bun run check-env
python3 scripts/check-dev-environment.py

# Build native binary
bun run build

# Python doc tool (design .docx → project layout)
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && pip install -e .
guru path/to/design.docx
```

## Architecture

**Entry points:**
- `src/entrypoints/cli.tsx` — Process bootstrap, then the full CLI
- `src/entrypoints/init.ts` — Shared startup: config, env, OAuth, telemetry, shutdown

**Core agent loop (`src/query.ts`):**
- Drives a `while(true)` loop until the model stops requesting tools or a limit is reached
- Each iteration: pre-process messages → call model → execute tools → loop back
- Exit reasons: `completed`, `aborted_streaming`, `aborted_tools`, `prompt_too_long`, `max_turns`, `model_error`, `stop_hook_prevented`, `hook_stopped`, `blocking_limit`

**Key directories:**
| Directory | Purpose |
|-----------|---------|
| `commands/` | CLI subcommands (doctor, mcp, login, install, …) |
| `services/` | API client, MCP, LSP, compaction, analytics, OAuth |
| `screens/` | REPL and major UI screens |
| `components/` | Terminal UI building blocks |
| `tools/` | Built-in agent tools (read, edit, bash, agents, …) |
| `constants/` | System prompt assembly |

**Stack:** TypeScript + Bun runtime + React + Ink (in-tree terminal renderer)

## Model / LLM Backend

CodeGuru always sends requests using the **Anthropic Messages API wire format** (`POST /v1/messages`). The actual LLM can be anything through a translation proxy (LiteLLM, Brain Core Proxy, etc.).

Configure via `~/.codeguru/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.sambanova.ai/v1",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>",
    "ANTHROPIC_MODEL": "MiniMax-M2.7"
  }
}
```

Or use multi-cloud deployments directly:
- `CLAUDE_CODE_USE_BEDROCK=1` — AWS Bedrock
- `CLAUDE_CODE_USE_VERTEX=1` — Google Cloud Vertex AI
- `CLAUDE_CODE_USE_FOUNDRY=1` — Microsoft Azure Foundry

## Internal Packages

Some imports (`@ant/*`, `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sandbox-runtime`, `@anthropic-ai/mcpb`) are **not on the public npm registry**. Raw checkout is enough to explore and typecheck much of the code, but `bun run dev` may fail on internal-only imports.