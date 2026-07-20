# Cloudflare Temporary Deploy Skill

Deploy a Cloudflare Worker to a live `workers.dev` URL with zero account setup, using `wrangler deploy --temporary`. Cloudflare provisions a throwaway account, deploys, and prints a claim URL valid for 60 minutes; unclaimed accounts auto-delete.

## When to Use

- **Ship agent-written code to a live URL** without first creating a Cloudflare account
- **Iterate in a background/autonomous session** where a browser OAuth step would be a hard stop
- **Prototype or evaluate Workers** quickly with a throwaway, claimable target
- **Build a self-verifying deploy loop** — deploy, `curl` the live URL, confirm output matches the code, redeploy

## When NOT to Use

- **Production or CI/CD** → use a permanent account (`wrangler login`)
- **Wrangler is already authenticated** → `--temporary` returns an error by design
- **Long-lived hosting** → temporary deployments are deleted after 60 minutes unless claimed

## Prerequisites

- **Wrangler 4.102.0 or later.** Verify with `npx wrangler@latest --version`.
- **Node 18+ / npm**
- **No Cloudflare credentials present.** `--temporary` only works when Wrangler is unauthenticated.
- Network egress to `cloudflare.com` and `workers.dev`.

## How to Run

1. **Scaffold a minimal Worker** (or skip if project exists):

   `wrangler.jsonc`:
   ```jsonc
   {
     "name": "hello-agent",
     "main": "src/index.ts",
     "compatibility_date": "2025-01-01"
   }
   ```

   `src/index.ts`:
   ```typescript
   export default {
     async fetch(): Promise<Response> {
       return new Response("hello cloudflare");
     },
   };
   ```

2. **Deploy with `--temporary`**:
   ```
   npx wrangler@latest deploy --temporary
   ```

3. **Parse the URLs** from output:
   ```
   npx wrangler@latest deploy --temporary 2>&1 | python3 scripts/parse_deploy_output.py
   ```

4. **Verify the deploy is live**:
   ```
   curl -sS <live_url>
   ```

5. **Iterate.** Edit code, redeploy. Within 60 minutes Wrangler reuses the cached temp account.

6. **Hand the claim URL to the user.** Tell them to open it within 60 minutes to keep the deployment.

## Quick Reference

| Step | Command |
|---|---|
| Check version | `npx wrangler@latest --version` |
| Deploy | `npx wrangler@latest deploy --temporary` |
| Verify live | `curl -sS <live_url>` |

## Pitfalls

- **`--temporary` is not in `wrangler deploy --help`** — it's shown dynamically when unauthenticated deploy fails
- **Old global wrangler** — always invoke `npx wrangler@latest`
- **Auth present → hard error** — unset vars or use `wrangler logout` first
- **60-minute hard expiry** — not extendable; user must claim to keep deployment

## Verification

- `npx wrangler@latest --version` returns `>= 4.102.0`
- `npx wrangler@latest deploy --temporary` prints a `workers.dev` URL and claim URL
- `curl -sS <live_url>` returns the expected Worker body