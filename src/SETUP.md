# Setup (moved)

Environment and install instructions live at the **project root**:

**[`../SETUP.md`](../SETUP.md)**

## Quick install

| Platform | CLI install |
|----------|-------------|
| macOS / Linux | `./scripts/install.sh` |
| Windows | `.\scripts\install.ps1` |

## Check prerequisites (all platforms)

```bash
python3 scripts/check-dev-environment.py
```

From repo root you can also run:

```bash
bun run check-env
```

## Run the CLI

```bash
bun run dev
```

Configure `~/.codeguru/settings.json` — see `../scripts/settings.example.json`.
