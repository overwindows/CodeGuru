---
name: inference-sh-cli
description: "Run 150+ AI apps via inference.sh CLI including image generation, video creation, LLMs, search, and 3D generation."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
---

# inference-sh-cli

Run 150+ AI applications via the `infsh` CLI tool including image generation, video creation, LLMs, search, and 3D generation. Uses the **terminal tool** to execute commands.

## Triggers

inference.sh, infsh, AI apps, flux, veo, image generation, video generation, seedream, seedance, tavily

## Core Workflow

1. **Search First** — Never guess app IDs:
\`\`\`bash
infsh app list --search <term>
\`\`\`

2. **Run App** — Use exact app ID with `--json`:
\`\`\`bash
infsh app run <app-id> --input '{"prompt": "your prompt"}' --json
\`\`\`

3. **Present Results** — Use `MEDIA:<url>` for inline display.

## Key Commands

**Image Generation**:
\`\`\`bash
infsh app run falai/flux-dev-lora --input '{"prompt": "sunset", "num_images": 1}' --json
\`\`\`

**Video Generation**:
\`\`\`bash
infsh app run google/veo-3-1-fast --input '{"prompt": "drone shot"}' --json
\`\`\`

**Search**:
\`\`\`bash
infsh app run tavily/tavily-search --input '{"query": "AI news"}' --json
\`\`\`

## Pitfalls

1. Always search first — app IDs change
2. Always use `--json` for structured output
3. Video generation takes 30-120 seconds

## Auth Check

\`\`\`bash
infsh me
\`\`\`

## Install

\`\`\`bash
curl -fsSL https://cli.inference.sh | sh
\`\`\`