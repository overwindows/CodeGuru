# Pinggy Tunnel Skill

Expose a local service (dev server, webhook receiver, MCP endpoint, demo) to the public internet using a Pinggy SSH reverse tunnel. No daemon to install — the user's stock SSH client connects to `a.pinggy.io:443` and Pinggy hands back a public HTTP/HTTPS URL.

Free tier: 60-minute tunnels, random subdomain, no signup. Pro tier ($3/mo) is an opt-in with a token.

## When to Use

- User asks to "expose this locally", "share my dev server", "make this URL public", "tunnel port N", "get a public URL for a webhook"
- Need to receive a webhook callback during a local task (Stripe, GitHub, Discord, AgentMail)
- Sharing a one-off HTTP demo (MCP server, Ollama/vLLM endpoint, dashboard) with a remote party
- The host has SSH but no `cloudflared` / `ngrok` binary, and installing one would be overkill

If the host already has `cloudflared` configured, prefer the `cloudflared-quick-tunnel` skill — Cloudflare quick tunnels don't expire after 60 minutes.

## Prerequisites

- `ssh` on PATH (`ssh -V`). Default on Linux, macOS, and Windows 10+. No other install.
- A local service listening on `127.0.0.1:<port>` before the tunnel starts. Pinggy will return URLs but they'll 502 until the local origin is up.

Optional:

- `PINGGY_TOKEN` env var for paid Pro features (persistent subdomain, custom domain, multiple tunnels, no 60-minute cap). Free tier needs no credentials.

## Quick Reference

```bash
# Plain HTTP/HTTPS tunnel for port 8000 (free tier)
ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
    -R0:localhost:8000 free@a.pinggy.io

# TCP tunnel (databases, raw SSH, etc.)
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:5432 tcp@a.pinggy.io

# TLS tunnel (Pinggy can't decrypt — bring your own certs at origin)
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:443 tls@a.pinggy.io

# Basic auth gate (b:user:pass)
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:8000 \
    "b:admin:secret+free@a.pinggy.io"

# Bearer token gate (k:token)
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:8000 \
    "k:mysecrettoken+free@a.pinggy.io"

# IP whitelist (w:CIDR)
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:8000 \
    "w:203.0.113.0/24+free@a.pinggy.io"

# Enable CORS + force HTTPS redirect
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:8000 \
    "co+x:https+free@a.pinggy.io"

# Pro tier (persistent URL, no 60-min cap)
ssh -p 443 -o StrictHostKeyChecking=no -R0:localhost:8000 "$PINGGY_TOKEN+a.pinggy.io"
```

## Procedure — Start a Tunnel and Get the URL

The model SHOULD use the `terminal` tool. The tunnel must stay alive for the duration of the share, so run it as a background process and parse the public URL from stdout.

### 1. Confirm a local origin is up

```bash
curl -sI http://127.0.0.1:8000/ | head -1
# expect HTTP/1.x 200 (or any non-connection-refused response)
```

If nothing is listening yet, start it first (e.g. `python3 -m http.server 8000 --bind 127.0.0.1`). Pinggy will happily return a URL pointed at nothing — the user will see 502 until the origin comes up.

### 2. Launch the tunnel as a background process

Use `terminal(background=True)` and capture output to a logfile (Pinggy prints the URLs on stdout, then keeps the connection open):

```bash
LOG=/tmp/pinggy-8000.log
nohup ssh -p 443 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -R0:localhost:8000 free@a.pinggy.io \
    > "$LOG" 2>&1 &
echo $! > /tmp/pinggy-8000.pid
```

`StrictHostKeyChecking=no` + `UserKnownHostsFile=/dev/null` skips the first-run host-key prompt. `ServerAliveInterval=30` keeps the SSH session from getting torn down by an idle NAT.

### 3. Parse the URL out of the log

```bash
sleep 4
grep -oE 'https://[a-z0-9-]+\.[a-z]+\.pinggy\.link' /tmp/pinggy-8000.log | head -1
```

Expected output looks like:

```
You are not authenticated.
Your tunnel will expire in 60 minutes.
http://yqycl-98-162-69-48.a.free.pinggy.link
https://yqycl-98-162-69-48.a.free.pinggy.link
```

Hand the `https://...pinggy.link` URL to the user.

### 4. Verify

```bash
curl -sI https://<the-url>/ | head -3
# expect 200/302/whatever the local origin actually returns
```

If you get `502 Bad Gateway`, the SSH session is up but the local origin isn't listening — fix step 1 first.

### 5. Teardown

```bash
kill "$(cat /tmp/pinggy-8000.pid)"
# or, if the pid file got lost:
pkill -f 'ssh -p 443 .* free@a\.pinggy\.io'
```

## Access Control via Username Keywords

Pinggy stacks control flags into the SSH username separated by `+`. Always quote the whole `user@host` argument when it contains a `+`:

| Keyword | Effect |
|---------|--------|
| `b:user:pass` | HTTP Basic auth gate |
| `k:token` | Bearer-token header gate (`Authorization: Bearer <token>`) |
| `w:CIDR` | IP whitelist (single IP or CIDR, repeatable) |
| `co` | Add `Access-Control-Allow-Origin: *` (CORS) |
| `x:https` | Force HTTPS — auto-redirect HTTP to HTTPS |
| `a:Name:Value` | Add request header |
| `u:Name:Value` | Update request header |
| `r:Name` | Remove request header |
| `qr` | Print a QR code of the URL to stdout |

Combine freely: `"b:admin:secret+co+x:https+free@a.pinggy.io"`.

## Pitfalls

- **60-minute hard cap on the free tier.** The SSH session terminates at the 60-minute mark; the URL goes dead. For longer shares, either use `PINGGY_TOKEN` (Pro) or auto-restart with a shell loop.
- **Free-tier URL is random and changes on restart.** Don't bookmark it, don't paste it into a config file. Re-parse from the log each time.
- **Concurrent free tunnels are limited to one per source IP.** Starting a second tunnel from the same machine usually kills the first. Pro tier lifts this.
- **`+` in usernames must be quoted.** Bare `ssh ... b:admin:secret+free@a.pinggy.io` works in bash but breaks under shells that treat `+` specially. Always wrap in double quotes.
- **Don't tunnel anything sensitive without an access-control flag.** A bare HTTP tunnel is reachable by anyone with the URL. Use `b:`, `k:`, or `w:` for non-public services.
- **Host-key prompt on first run.** Always pass `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` for unattended runs.
- **Pro mode requires the token as the username, not a flag.** Use `"$PINGGY_TOKEN+a.pinggy.io"` (no `free@`).

## Verification

```bash
# End-to-end: spin up a trivial origin, tunnel it, hit it, tear down
python3 -m http.server 18000 --bind 127.0.0.1 >/tmp/origin.log 2>&1 &
ORIGIN_PID=$!

nohup ssh -p 443 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -R0:localhost:18000 free@a.pinggy.io >/tmp/pinggy-verify.log 2>&1 &
SSH_PID=$!

sleep 5
URL=$(grep -oE 'https://[a-z0-9-]+\.[a-z]+\.pinggy\.link' /tmp/pinggy-verify.log | head -1)
echo "URL: $URL"
curl -sI "$URL/" | head -1

kill "$SSH_PID" "$ORIGIN_PID"
```

Expected: a `pinggy.link` URL and `HTTP/2 200` on the curl head.