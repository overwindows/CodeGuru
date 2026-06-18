# CodeGuru (dev tree)

This directory is the **project root** for local development. **Application source** lives in **`src/`**.

| Location | Purpose |
|----------|---------|
| **`package.json`**, **`bunfig.toml`**, **`tsconfig.json`** | Install and editor/tooling from **this** folder |
| **`src/`** | TypeScript source (CLI, services, tools) |
| **`scripts/install-linux.sh`** | One-step install on **macOS / Linux** |

## Quick start (development)

### Install (macOS / Linux)

```bash
./scripts/install-linux.sh
```

On **Windows**, run `.\scripts\install.ps1` in PowerShell.

### Prerequisites (manual install)

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

1. From **this** directory, install dependencies with **Bun**:
   ```bash
   bun install
   ```

2. Configure your model provider via `~/.config/codeguru/settings.json`:

   **SambaNova (OpenAI-compatible) example:**

   ```json
   {
     "env": {
       "CODEGURU_BASE_URL": "https://api.sambanova.ai/v1",
       "CODEGURU_AUTH_TOKEN": "<your-sambanova-api-key>",
       "CODEGURU_MODEL": "MiniMax-M2.7",
       "CODEGURU_DEFAULT_HAIKU_MODEL": "MiniMax-M2.7",
       "CODEGURU_CODE_AUTO_COMPACT_WINDOW": "200000",
       "CODEGURU_AUTOCOMPACT_PCT_OVERRIDE": "60"
     },
     "theme": "auto"
   }
   ```

   All `CODEGURU_*` keys are bridged to their `ANTHROPIC_*` / `CLAUDE_*` equivalents at runtime — you never need to set `ANTHROPIC_*` variables directly. Any OpenAI-compatible provider works: just point `CODEGURU_BASE_URL` at the provider's `/v1` endpoint, set `CODEGURU_AUTH_TOKEN` to your key, and set `CODEGURU_MODEL` to the model name.

   > **Note:** include `/v1` in `CODEGURU_BASE_URL` — CodeGuru strips it before handing the URL to the SDK, which adds its own `/v1/…` paths.

   **Optional: Anthropic API key instead:**

   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. Run the dev entrypoint:

   ```bash
   bun run dev
   ```

4. Check prerequisites:

   ```bash
   bun run check-env
   ```

> **Note (Windows):** Each new PowerShell session needs PATH setup for fnm/bun:
> ```powershell
> $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")
> fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
> ```

## Internal / private packages

Some files import packages that are **not** on the public npm registry, for example:

- `@ant/*` (Chrome MCP, …)
- `@anthropic-ai/sandbox-runtime`, `@anthropic-ai/sdk`, …

Those paths are gated or stripped in **shipping** builds. A raw `src/` checkout plus `node_modules` from Anthropic's internal registry is enough to build **most** of the code, but **not** guaranteed to match the full production bundle. For a **supported** install, use the official installer.