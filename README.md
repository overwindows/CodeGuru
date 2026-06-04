# Claude Code (dev tree)

This directory is the **project root** for local development. **Application source** lives in **`src/`** (upstream-style layout).

| Location | Purpose |
|----------|---------|
| **`package.json`**, **`bunfig.toml`**, **`tsconfig.json`** | Install and editor/tooling from **this** folder |
| **`src/`** | TypeScript source (CLI, REPL, services, tools) — see [`src/README.md`](./src/README.md) |
| **[`SETUP.md`](./SETUP.md)** | Run the official app vs develop this source, env vars, prerequisites |

## Quick start (development)

### Prerequisites

- **Node.js 18+** — install via [fnm](https://github.com/Schniz/fnm) (recommended on Windows):
  ```powershell
  winget install Schniz.fnm
  fnm install 22
  fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
  ```
- **Bun** — install via winget or npm:
  ```powershell
  winget install Oven-sh.Bun
  # or: npm install -g bun
  ```

### Install & run

1. From **this** directory (`Claude Code/`, not only `src/`), install dependencies with **npm** (recommended on Windows/OneDrive — Bun's isolated linker can break with synced folders):

   ```bash
   npm install --legacy-peer-deps
   ```

2. Fix React version compatibility (the source uses React 19 APIs):

   ```bash
   npm install react@^19.0.0 react-reconciler@0.34.0-canary-ed69815c-20260323 --legacy-peer-deps
   ```

3. Optional: set your API key:

   ```powershell
   $env:ANTHROPIC_API_KEY = "sk-ant-..."
   ```

4. Run the dev entrypoint:

   ```bash
   bun run dev
   ```

5. Check prerequisites (Windows):

   ```powershell
   bun run check-env
   ```

> **Note (Windows):** Each new PowerShell session needs PATH setup for fnm/bun:
> ```powershell
> $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")
> fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
> ```

## Internal / private packages

Some files import packages that are **not** on the public npm registry, for example:

- `@ant/*` (computer use, Chrome MCP, …)
- `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sandbox-runtime`, `@anthropic-ai/mcpb`, …

Those paths are gated or stripped in **shipping** builds. A raw `src/` checkout plus this `package.json` is enough to explore and typecheck **much** of the code, but **not** guaranteed to match Anthropic’s full production bundle. For a **supported** install, use the [official Claude Code setup](https://code.claude.com/docs/en/setup).

## Run the product (no build)

To **use** Claude Code without compiling this repo, install via the official installer or `winget` — see **SETUP.md §A**.
