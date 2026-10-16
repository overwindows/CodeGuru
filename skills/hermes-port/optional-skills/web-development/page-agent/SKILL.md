# page-agent

**Description:** Ship AI copilots inside SaaS/admin panels/legacy apps using alibaba/page-agent — a pure-JavaScript in-page AI copilot that drives web UIs with natural language.
**Platforms:** linux, macos, windows | **Category:** web-development

## Overview

page-agent reads DOM as text—no screenshots—and runs client-side via a single `<script>` tag or npm package. Works with any OpenAI-compatible LLM (Qwen, OpenAI, Ollama, OpenRouter).

## Core Capabilities

- **Ship AI copilots** inside SaaS/admin panels/legacy apps
- **Modernize old UIs** without rewriting frontend code
- Works with any OpenAI-compatible LLM

## Three Implementation Paths

**Path 1 — 30-second CDN demo:**
```html
<script src="https://cdn.jsdelivr.net/npm/page-agent@1.8.0/dist/iife/page-agent.demo.js"></script>
```
For evaluation only. Rate-limited and not for production.

**Path 2 — npm install (production):**
```bash
npm install page-agent
```
Wire up your own LLM endpoint via `new PageAgent({model, baseURL, apiKey})`. Never expose API keys client-side—proxy through your backend.

**Path 3 — Clone repo (development):**
```bash
git clone https://github.com/alibaba/page-agent.git
npm ci
```
Configure `.env` with LLM credentials, then `npm run dev:demo`.

## Critical Pitfalls

- **Demo CDN in production** — prohibited; self-host instead
- **API key exposure** — keys in `new PageAgent({apiKey})` ship in the JS bundle
- **Node 22.13+ required** — Node 20 will fail
- **Restart dev server** after editing `.env` (Vite only reads at startup)

## Reference Links

- Repo: https://github.com/alibaba/page-agent
- Docs: https://alibaba.github.io/page-agent/