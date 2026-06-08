# Code Guru — `src`

This directory contains the **TypeScript source** for Code Guru, a terminal-based agentic coding assistant.

**Install and tooling** live in the **parent folder** (`CodeGuru/`, next to `src/`): `package.json`, `bunfig.toml`, and `tsconfig.json`. Run `bun install` and `bun run dev` from the parent, not from `src/` alone.

## Run and develop

- **[`../SETUP.md`](../SETUP.md)** — official installer vs `bun install` at project root, env vars.
- **[`../.env.example`](../.env.example)** — optional API-related variables (the app may use `~/.codeguru` or OAuth instead).
- **`scripts/Check-DevEnvironment.ps1`** — Git, Node, Bun, and whether `package.json` exists next to `src/`.
- **`../tsconfig.json`** — editor / `bun run typecheck` (`paths` maps `src/*` → `./src/*`).

## Stack

- **TypeScript** with path aliases such as `src/…`
- **Bun** as the runtime/bundler (see `bun:bundle` feature gates in entry code)
- **React** + an in-tree **Ink**-style terminal renderer (`ink/`, `ink.ts`) for the TUI
- **Anthropic Messages API wire format** for streaming completions and tool use — but the backend LLM is not necessarily Claude. See [Model / LLM backend](#model--llm-backend) below.

## Entry points

| Path | Role |
|------|------|
| `entrypoints/cli.tsx` | Process bootstrap: fast argv paths (version, MCP sidecars, daemon, bridge, …), then the full CLI |
| `entrypoints/init.ts` | Shared startup: config, env, OAuth, policy, telemetry hooks, shutdown |
| `main.js` (imported from `cli.tsx`) | Full Commander-style CLI, subcommands, and interactive session |

## Layout (high level)

| Directory | Purpose |
|-----------|---------|
| `commands/` | CLI subcommands (`doctor`, `mcp`, `login`, `install`, …) |
| `services/` | API client, MCP, LSP, compaction, analytics, OAuth, tools orchestration, … |
| `screens/` | REPL and major UI screens |
| `components/` | Terminal UI building blocks |
| `tools/` | Built-in agent tools (read, edit, bash, agents, …) |
| `constants/` | System prompt assembly (`prompts.ts`, `systemPromptSections.ts`, …) |
| `query.ts` | **Core agent loop**: model stream → tool execution → append results → next request |
| `query/` | Loop sub-modules: `config.ts`, `deps.ts`, `tokenBudget.ts`, `stopHooks.ts`, `transitions.ts` |
| `bootstrap/`, `state/` | Session/global state (kept intentionally small) |
| `remote/`, `bridge/` | Remote control / bridge flows |
| `plugins/`, `skills/` | Extensibility |

## Model / LLM backend

Code Guru always sends requests using the **Anthropic Messages API wire format** (`POST /v1/messages`). However, the actual LLM that responds can be **anything** — as long as a proxy translates the Anthropic format into whatever the backend model expects.

### Current setup — Brain Core Proxy

The API endpoint is fully overridable via `~/.codeguru/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:28082",
    "ANTHROPIC_AUTH_TOKEN": "Brain Core Proxy",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6"
  }
}
```

`ANTHROPIC_BASE_URL` points to **Brain Core Proxy** instead of `https://api.anthropic.com`. The proxy accepts Anthropic-format requests and routes them to any backend model. The `ANTHROPIC_MODEL` string is passed through to the proxy, which decides what model actually runs.

### Can it use an OpenAI-compatible interface?

**Not directly** — but yes through a translation proxy. Code Guru always sends Anthropic wire format; OpenAI-compatible servers (Ollama, LM Studio, vLLM, OpenAI itself) all speak a different format:

| | Code Guru sends (Anthropic) | OpenAI-compatible expects |
|---|---|---|
| **Endpoint** | `POST /v1/messages` | `POST /v1/chat/completions` |
| **Tools** | `input_schema` | `function.parameters` |
| **System prompt** | top-level `system: [...]` array | message with `role: "system"` |
| **Streaming** | `content_block_delta`, `message_start`… | `choices[0].delta.content` |
| **Auth** | `X-Api-Key` header | `Authorization: Bearer` header |

A proxy like **LiteLLM** bridges this gap — it accepts Anthropic format from Code Guru and translates to OpenAI format for the backend:

```
Code Guru → POST /v1/messages (Anthropic) → LiteLLM / Brain Core Proxy → POST /v1/chat/completions → any LLM
```

When pointing at a LiteLLM-style proxy, also set `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` to strip Anthropic-specific beta fields (`defer_loading`, `context_management`, `speed`, etc.) that cause `"Extra inputs are not permitted"` 400 errors from most proxies.

### Multi-cloud Claude deployments (no proxy needed)

| Environment variable | Backend |
|---|---|
| *(default)* | Anthropic API directly |
| `CLAUDE_CODE_USE_BEDROCK=1` | AWS Bedrock |
| `CLAUDE_CODE_USE_VERTEX=1` | Google Cloud Vertex AI |
| `CLAUDE_CODE_USE_FOUNDRY=1` | Microsoft Azure Foundry |

### Key model env vars

| Variable | Purpose |
|---|---|
| `ANTHROPIC_BASE_URL` | Override API endpoint (proxy, local server, etc.) |
| `ANTHROPIC_MODEL` | Override the main loop model string |
| `ANTHROPIC_SMALL_FAST_MODEL` | Override the small/fast model (used for summaries, etc.) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Override which model acts as "Haiku" |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | Strip beta fields incompatible with most proxies |

All of these can be set in `~/.codeguru/settings.json` under the `env` key so they apply automatically without touching your shell environment.

## Agent loop (`query.ts`)

`query.ts` is the heart of Code Guru. It exports a single `query()` entry point that drives a `while (true)` loop (`queryLoop`) until the model stops requesting tools or a limit is reached.

**Each iteration:**
1. Pre-process messages — applies snip, microcompact, context-collapse, and autocompact to keep the context window in budget.
2. Call the model (`deps.callModel`) — streams **text** and **`tool_use`** blocks from the API.
3. If no tool calls → check stop hooks, token budget, and exit with `{ reason: 'completed' }`.
4. Execute tools (`runTools` / `StreamingToolExecutor`) — runs all requested tools, yielding results.
5. Drain queued notifications and memory attachments, then **loop back** with the updated message history.

**Exit reasons:** `completed` · `aborted_streaming` · `aborted_tools` · `prompt_too_long` · `max_turns` · `model_error` · `stop_hook_prevented` · `hook_stopped` · `blocking_limit`

## Installation (`codeguru install`)

`codeguru install` is a CLI-only subcommand (not a REPL slash command) that:
- Downloads the **native binary** for the current platform/arch
- Sets up the launcher at `~/.local/bin/codeguru` and configures shell PATH
- Cleans up any legacy npm-based installations and shell aliases
- Marks `installMethod = 'native'` in global config, disabling the old npm auto-updater

Accepts an optional target: `stable`, `latest`, or a specific version (e.g. `1.0.34`). Pass `--force` to reinstall even if already up to date.

## Documentation

Product and user-facing docs live on the **Anthropic documentation** site, not in this tree. This README is only a map for contributors reading `src`.

## License / contribution

Licensing and contribution guidelines are defined at the **repository root** in a complete checkout.
