# Claude Code — `src`

This directory contains the **TypeScript source** for [Claude Code](https://code.claude.com/docs), Anthropic’s terminal-based agentic coding assistant.

**Install and tooling** live in the **parent folder** (`Claude Code/`, next to `src/`): `package.json`, `bunfig.toml`, and `tsconfig.json`. Run `bun install` and `bun run dev` from the parent, not from `src/` alone.

## Run and develop

- **[`../SETUP.md`](../SETUP.md)** — official installer vs `bun install` at project root, env vars.
- **[`../.env.example`](../.env.example)** — optional API-related variables (the app may use `~/.claude` or OAuth instead).
- **`scripts/Check-DevEnvironment.ps1`** — Git, Node, Bun, and whether `package.json` exists next to `src/`.
- **`../tsconfig.json`** — editor / `bun run typecheck` (`paths` maps `src/*` → `./src/*`).

## Stack

- **TypeScript** with path aliases such as `src/…`
- **Bun** as the runtime/bundler (see `bun:bundle` feature gates in entry code)
- **React** + an in-tree **Ink**-style terminal renderer (`ink/`, `ink.ts`) for the TUI
- **Anthropic Messages API** for streaming completions and tool use

## Entry points

| Path | Role |
|------|------|
| `entrypoints/cli.tsx` | Process bootstrap: fast argv paths (version, MCP sidecars, daemon, bridge, …), then the full CLI |
| `entrypoints/init.ts` | Shared startup: config, env, OAuth, policy, telemetry hooks, shutdown |
| `main.js` (imported from `cli.tsx`) | Full Commander-style CLI, subcommands, and interactive session |

## Layout (high level)

| Directory | Purpose |
|-----------|---------|
| `commands/` | CLI subcommands (`doctor`, `mcp`, `login`, …) |
| `services/` | API client, MCP, LSP, compaction, analytics, OAuth, tools orchestration, … |
| `screens/` | REPL and major UI screens |
| `components/` | Terminal UI building blocks |
| `tools/` | Built-in agent tools (read, edit, bash, agents, …) |
| `constants/` | System prompt assembly (`prompts.ts`, `systemPromptSections.ts`, …) |
| `query.ts` | Core agent loop: model stream → tool execution → append results → next request |
| `bootstrap/`, `state/` | Session/global state (kept intentionally small) |
| `remote/`, `bridge/` | Remote control / bridge flows |
| `plugins/`, `skills/` | Extensibility |

## Agent loop (mental model)

1. User input and history are combined with a **system prompt** from `constants/prompts.ts`.
2. The model streams **text** and **`tool_use`** blocks.
3. The client runs tools (with permissions), appends **`tool_result`** messages, and **calls the model again** until the turn completes or limits apply (`query.ts`, `services/tools/`).

## Documentation

Product and user-facing docs live on the **Claude Code documentation** site, not in this tree. This README is only a map for contributors reading `src`.

## License / contribution

Licensing and contribution guidelines are defined at the **repository root** in a complete checkout.
