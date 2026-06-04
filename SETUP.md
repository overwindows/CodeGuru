# Environment setup (project root)

This **`Claude Code/`** folder is the **development root**. **`src/`** holds the application source only.

---

## A. Run Claude Code (recommended — no build)

You do **not** need `bun install` here to **use** the product.

- **Windows:** `irm https://claude.ai/install.ps1 | iex` or `winget install Anthropic.ClaudeCode`
- **Other platforms:** [Claude Code setup](https://code.claude.com/docs/en/setup)

Then run `claude` in your project. Auth: Console / API key per official docs.

---

## B. Develop this source tree

1. Install **[Bun](https://bun.sh/docs/installation)** (the entry code imports `bun:bundle`).
2. Install **Node.js 18+** if you use tools that expect it.
3. From **`Claude Code/`** (parent of `src/`):

   ```bash
   bun install
   ```

4. Optional: `cp .env.example .env` and set variables (many flows use `~/.claude` instead).

5. Commands:

   | Script | Purpose |
   |--------|---------|
   | `bun run check-env` | Git / Node / Bun / `package.json` presence |
   | `bun run dev` | Run `src/entrypoints/cli.tsx` (may fail on **internal-only** `@ant/*` imports — see root `README.md`) |
   | `bun run typecheck` | `tsc --noEmit` with root `tsconfig.json` |

6. **Windows:** if native addons fail to build, use **WSL2** or trim problematic dependencies.

---

## C. API-related environment variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | API key (see `src/utils/auth.ts` for OAuth and other modes) |
| `ANTHROPIC_AUTH_TOKEN` | Alternate token when applicable |
| `ANTHROPIC_MODEL` | Default model override |
| `ANTHROPIC_BASE_URL` | Custom API base URL |

---

## Layout reminder

```
Claude Code/          ← run bun install HERE
  README.md
  package.json
  bunfig.toml
  tsconfig.json
  SETUP.md
  .env.example
  src/                  ← application source (see src/README.md)
```
