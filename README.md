# CodeGuru

CodeGuru is an AI-powered coding assistant that provides intelligent code completion, refactoring suggestions, and development workflow automation.

This repository contains the **development tree** for local development. The application source code resides in the **`src/`** directory.

## Directory Structure

| Path | Description |
|------|-------------|
| `package.json`, `bunfig.toml`, `tsconfig.json` | Project configuration and tooling dependencies |
| `src/` | TypeScript source code (CLI, services, tools) |
| `scripts/install-linux.sh` | Automated installation script for macOS and Linux |

## Prerequisites

- **Node.js 18+** — recommended installation via [fnm](https://github.com/Schniz/fnm):
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

## Quick Start

### Automated Installation

**macOS / Linux:**
```bash
./scripts/install-linux.sh
```

**Windows:**
```powershell
.\scripts\install.ps1
```

### Manual Installation

1. Navigate to the project root and install dependencies:
   ```bash
   bun install
   ```

2. Configure your model provider in `~/.config/codeguru/settings.json`. The following example uses SambaNova (OpenAI-compatible API):

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

   CodeGuru bridges all `CODEGURU_*` environment variables to their `ANTHROPIC_*` / `CLAUDE_*` equivalents at runtime. Any OpenAI-compatible API provider is supported—configure `CODEGURU_BASE_URL` to point to the provider's `/v1` endpoint, set `CODEGURU_AUTH_TOKEN` to your API key, and specify `CODEGURU_MODEL` with your desired model name.

   > **Note:** Ensure `CODEGURU_BASE_URL` includes the `/v1` suffix. CodeGuru handles the path construction internally.

   **Anthropic API (alternative):**
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. Start the development server:
   ```bash
   bun run dev
   ```

4. Verify environment setup:
   ```bash
   bun run check-env
   ```

> **Windows Note:** New PowerShell sessions require PATH configuration for fnm and bun:
> ```powershell
> $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")
> fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
> ```

## Internal Packages

Some modules depend on packages from Anthropic's internal npm registry that are not publicly available, including:

- `@ant/*` (Chrome MCP, etc.)
- `@anthropic-ai/sandbox-runtime`, `@anthropic-ai/sdk`

These dependencies are gated or stripped in production builds. A standard `src/` checkout with `node_modules` from Anthropic's internal registry is sufficient for most development tasks but may not replicate the complete production bundle. For a fully supported installation, use the official installer.