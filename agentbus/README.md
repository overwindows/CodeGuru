# agentbus — a real service for coordinating multiple CodeGuru sessions

A **long-running service** that CodeGuru windows connect to, so they can exchange
messages, share a task queue, and read shared state — the "service layer" that a
passive shared folder can't give you.

```
[CodeGuru window A] ─┐   HTTP / long-poll   ┌→ routing / inboxes / claims
[CodeGuru window B] ─┼─────────────────────→│  agentbus (server.py)
[CodeGuru window C] ─┘                      └→ shared state / log / persistence
```

This is the **Option 1 (HTTP daemon)** design: a thin, structured, real-time
broker. One long-lived process holds the team together — centralizing routing,
pushing updates, and tracking who's online — instead of every agent polling a
shared folder.

## Why a service (vs. a shared folder)

| | File bus | This service |
|---|---|---|
| Delivery | every agent polls a folder on a timer | **server pushes** via long-poll (near-real-time) |
| Routing | agents must know file paths | post `send("worker-b", …)` to one endpoint |
| Presence | "is worker-b alive?" unanswerable | server tracks live/polling agents (`GET /agents`) |
| Failure | no central view | one broker you can health-check (`GET /health`) |

## Architecture

**Stdlib only** — no pip install, runs on Python 3.9+. Real-time uses **long-poll**
(`GET /poll?name=X&timeout=N`), not websockets: the server holds the request until
new mail arrives or the timeout ends. State is **file-backed JSON** (optional
`--state-dir`), so it survives restarts — point it at a OneDrive folder to sync
across machines.

```
agentbus/
  server.py        # the service (HTTP + long-poll daemon)
  client.py        # session-side client library + CLI (stdlib urllib)
  launcher.py      # one-liner to bring the service up/down
  demo_worker.py   # runnable example of a session joining the team
  research_loop.py # long-poll monitor: receive messages + drive work
  mcp-server.cjs   # expose the service to CodeGuru as MCP tools
```

## Join the team — for each CodeGuru session/window

Every CodeGuru window you open is its own isolated agent. To make windows cooperate,
each registers on the shared bus under a **unique name**, then sends/receives
messages, shares a task queue, and reads/writes shared state.

### 1. Pick a unique name

This name is your identity — every other agent addresses you by it. Use something
distinct per window (e.g. `worker-a`, `research-b`, `chen-session`). **Do not reuse
another window's name.**

### 2. Register

Run from a terminal inside `Q:\CodeGuru\agentbus` (or use the MCP tools if this
session has the `agentbus` MCP server wired). Registration is **implicit** — any
`client.py` invocation registers your name first:

```bash
python client.py --name worker-a --agents   # registers + lists who's online
```

Attach a role/description so others know what you do:

```bash
python -c "from client import AgentClient; \
AgentClient('worker-a', port=8765).register({'role': 'researcher', 'contacts': 'alice@x'})"
```

### 3. Verify you're on the bus

```bash
python client.py --name worker-a --agents
```

### What you can do once registered

| Want to… | Do this |
|---|---|
| Send another agent a message | `python client.py --name worker-a --send research-b "need your notes"` |
| Check your inbox | `python client.py --name worker-a --recv` |
| Block for new mail (real-time) | `python client.py --name worker-a --wait 30` |
| Post a task to the shared queue | `python client.py --name worker-a --post-task "summarize the notes"` |
| Claim a task to work on | `python -c "from client import AgentClient; print(AgentClient('worker-a').claim())"` |
| Read shared state | `python client.py --name worker-a --state-get phase` |
| Write shared state | `python client.py --name worker-a --state-set phase working` |
| Append to the team log | `python client.py --name worker-a --log "started analysis"` |
| Run as a long-poll monitor | `python research_loop.py --name worker-a` (see below) |

Or in Python inside a session:

```python
from client import AgentClient
c = AgentClient("worker-a", port=8765)   # replace with YOUR unique name
c.register({"role": "researcher"})       # optional metadata
c.send("research-b", {"query": "..."}, subject="help")
msgs = c.wait(timeout=30)                # real-time, server pushes
```

### Run as a long-poll monitor (receive + drive work)

Instead of asking "anything new?" in a loop, run the monitor and let the bus push
work to you. `research_loop.py` blocks on a long-poll and acts the instant a message
or task arrives:

```bash
python research_loop.py --name worker-a --role researcher   # monitor, keep running
python research_loop.py --name worker-a --once              # one pass, then exit
```

- Incoming **messages** are routed to `handle_msg()` by subject (edit it for your
  logic — it can reply on the bus).
- Incoming **tasks** (posted via `--post-task` or `agent_post_task`) are claimed
  atomically and run to completion.

### Housekeeping — keep the roster clean

Throwaway probes (empty `meta`) clutter `--agents`. Remove a stale agent with the
**deregister** endpoint (persisted immediately, no restart needed):

```bash
python client.py --name worker-a --deregister     # remove this agent from the bus
curl -X POST http://127.0.0.1:8765/deregister \
     -H "Content-Type: application/json" -d '{"name":"worker-a"}'
```

Deregistering also drops the agent's inbox and releases any long-poll waiter on that
name. Deregistering a name that isn't registered returns `{"removed": false}` (safe
to call repeatedly). Note: the CLI auto-registers your name first, so a `--deregister`
via CLI always returns `true` — use the raw `curl` to confirm a name was really gone
before.

Rule of thumb: keep agents that describe a real role (`meta.role` set); delete the
empty-metadata probe test noise.

## Run it

```bash
# 1) start the service (in-memory only)
python server.py --port 8765

# or persist across restarts / sync across machines
python server.py --port 8765 \
    --state-dir "C:\Users\wuc\OneDrive - Microsoft\.codeguru-agent-bus"

# 2) in any CodeGuru window, connect with the client
python client.py --name research-a --agents
```

## Run it — one-liner launcher

`launcher.py` removes the "did I remember to start the server?" step: it checks the
port and daemonizes `server.py` if needed, so you can always bring the team up with
one command (safe to run repeatedly — it's a no-op if the service is already up).

```bash
python launcher.py                 # ensure service up (start if needed)
python launcher.py --stop          # stop the service on the port
python launcher.py --check         # exit 0 if up, 1 if down
python launcher.py --port 9000     # different port
python launcher.py --state-dir X   # override the persistence dir
```

Defaults: port `8765`, state-dir `OneDrive - Microsoft\.codeguru-agent-bus`, log to
`agentbus/service.log`. Override any of these with `--state-dir` / `--port` / `--log`,
or the `AGENT_BUS_STATE_DIR` / `AGENT_BUS_PORT` env vars. `stop` targets only the PIDs
listening on the port (via `netstat`/`lsof`), so it never kills unrelated Python.

Or use the npm scripts (runs the same launcher):

```bash
npm run agentbus         # start (or no-op if up)
npm run agentbus:stop
npm run agentbus:check
```

Start the MCP bridge independently after the service is up: `node mcp-server.cjs` (or
`npm run agentbus:mcp`) — this is what CodeGuru loads via `~/.codeguru.json` mcpServers.

## Use it from a session

```python
from client import AgentClient
c = AgentClient("research-a", port=8765)      # unique name per window
c.register({"role": "researcher"})

# talk to another agent (routed by the server)
c.send("research-b", {"kind": "request", "query": "..."}, subject="help")

# receive: drain (non-blocking) or long-poll (block until something arrives)
msgs = c.recv()
msgs = c.wait(timeout=30)

# pull work from the shared queue (claim is atomic — only one wins)
if (tid := c.post_task({"title": "analysis"})):
    task = c.claim("research-a")
    ... do the work ...
    c.task_done(task["id"], {"ok": True})

# shared state + team log
c.set_state("phase", "plumbing"); print(c.get_state("phase"))
c.log("started analysis")
```

Or from the shell:

```bash
python client.py --name research-a --post-task "ship the design"
python client.py --name worker-a  --wait 15        # block for 15s of push
python client.py --name research-a --recv
```

`demo_worker.py` shows the full worker loop (claim tasks + long-poll for work):

```bash
python demo_worker.py --name worker-a
python demo_worker.py --name worker-b
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + agent count |
| GET | `/agents` | list agents (+ queued mail, alive flag) |
| POST | `/register` | `{name, meta}` → create inbox |
| POST | `/deregister` | `{name}` → remove an agent, drop inbox + waiters |
| POST | `/send` | `{to, payload, subject}` → route a message |
| GET | `/recv?name=X` | drain an inbox (non-blocking) |
| GET | `/poll?name=X&timeout=N` | long-poll for new messages |
| POST | `/post-task` | `{payload:{…}}` → enqueue work |
| POST | `/claim` | `{worker}` → atomically claim one open task |
| POST | `/task-done` | `{id, result}` → complete a claimed task |
| POST | `/state/set` | `{key, value}` → latest-wins scratchboard |
| GET | `/state/get?key=K` | read a shared value |
| GET | `/state` | dump all shared state |
| POST | `/log` | `{line}` → append to the team log |

## Agent behavior rules

The service gives you routing, atomics, and shared state — but *coordination* still
depends on how each agent behaves. These are the agreed rules of conduct so a team of
independent CodeGuru windows (each with its own context and judgment) doesn't trip
over each other. **Every session should follow them.**

### 1. Identity

- **One agent name per window, unique and stable.** Your name is the address others
  send to and the key you own on the bus. Pick once (`worker-a`) and keep it — don't
  change it mid-session.
- **Never reuse or impersonate another agent's name.** If you collide, the roster
  shows two records for one name and messages get misrouted.
- **Register with a `role` and, ideally, `focus` + `contacts` metadata** so others can
  find and address you. An agent with no role is invisible to coordination.

### 2. Messaging etiquette

- **Address by name, send one message per intent.** Put a `subject` on every message
  so the receiver can route without parsing the payload.
- **Reply on the same subject within scope** (`subject="research-done"` for a
  `subject="research"` request) — don't start new unrelated threads.
- **Fire-and-forget by default; confirm only when it matters.** For critical work use
  the task queue (has a result channel) rather than relying on a mailbox reply.
- **Don't spam.** If you need to re-ask, wait a beat or use the queue; a mailbox with a
  flood of retries is a smell.

### 3. Task lifecycle

A task moves through `open → claimed → done`. The server enforces atomics; you follow
the lifecycle:

- **Post self-contained tasks.** Put every input the worker needs *in the task dict*
  (`title`, `inputs`, `output` path) — never rely on context the worker can't see.
- **Claim only what you can finish.** One worker, one claim: the server marks it
  `claimed` the instant you win; losers get `None` and move on (don't loop-claim the
  same task).
- **Always call `task_done` — success or failure** — with a result dict. A result of
  `{"ok": false, "error": ...}` is a legitimate completion; *not* calling `task_done`
  leaves the task stuck claimed.
- **Make work idempotent.** Re-runs must be safe — "check before doing" so a crash
  mid-task doesn't corrupt state on retry.

### 4. State & ownership

- **Namespace shared-state keys by owner or concern** (`kb.phase`, `profiles.status`,
  `maipipeline.version`) to avoid two agents stomping the same key.
- **Latest-wins is a contract, not a bug.** Shared state is a scratchboard, not a
  source of truth — persist authoritative records in files, mirror the *pointer/progress*
  on the bus.
- **Only the owning agent writes its domain keys.** If another agent needs to update a
  key it doesn't own, ask via message, don't overwrite.
- **Write distinct output paths.** Each agent renders results to its own
  file/folder — nobody overwrites a colleague's deliverable.

### 5. Logging

- **Log meaningful, human-readable steps** to the team `log` — what you're doing,
  when, and the outcome. Future sessions (and you, later) read this to reconstruct
  what happened.
- **Log outcomes, not noise.** One line per unit of work; skip per-call chatter.

### 6. Lifecycle & liveness

- **Register on startup, deregister on graceful exit** (Ctrl-C / when done) so the
  roster reflects reality.
- **Running a long-poll monitor is your heartbeat.** An agent that is `wait()`-ing shows
  `alive: true`; an idle agent shows `alive: false` (not the same as "gone").
- **Because registration persists in `agents.json`, a window that closed without
  deregistering stays on the roster.** Treat a long-inactive name (no `alive`, stale
  `registered_at`) as possibly-dead: re-register over it, or deregister it when you
  confirm it's not returning.

### 7. Concurrency & fairness

- **Don't monopolize the queue.** If no task is open for you, back off — don't spin on
  `claim()`; long-poll or wait instead.
- **One worker per task, no double-processing.** Trust the claim: if you lose a race,
  that task is being handled elsewhere.
- **Respect other agents' speed.** A slow colleague isn't dead; give the queue / state
  a chance to catch up before re-deriving their work.

### 8. Failure & recovery

- **A crash leaves half-finished claims.** On restart, re-register and reconcile: check
  for tasks you claimed but never marked done, and complete or release them.
- **Idempotency is your crash-safety net.** Because work is idempotent, re-running
  after a crash is safe by design.
- **Never silently drop work.** If you can't do a task, `task_done` with
  `{"ok": false, "reason": ...}` so a supervisor can re-route it.

---

This is a working baseline — tested green end-to-end (registration, routing, long-poll
push, atomic claims, shared state, restart persistence).

## MCP integration — use the bus as native tools

`mcp-server.cjs` exposes the service to any CodeGuru session through the **MCP
protocol**, so a session can `agent_send`, `agent_claim`, `agent_get_state`, etc.
without writing raw Python/HTTP — the same way your `github-tools`, `kusto-tools`
etc. already work.

**Prerequisite:** the service must be running (`python server.py --port 8765`).

Wire it into `~/.codeguru.json`, under `mcpServers` (matches the ai-coder-tools
pattern):

```json
"agentbus": {
  "command": "node",
  "args": ["Q:/CodeGuru/agentbus/mcp-server.cjs"],
  "env": { "AGENT_BUS_PORT": "8765" }
}
```

Tools exposed:

| Tool | Purpose |
|------|---------|
| `agent_alive` | service up? |
| `agent_agents` | list agents (+ queued mail, liveness) |
| `agent_deregister(name)` | remove an agent from the bus |
| `agent_send(name, to, payload, subject?)` | route a message |
| `agent_recv(name)` | drain inbox (non-blocking) |
| `agent_wait(name, timeout?)` | long-poll for new mail (real-time) |
| `agent_post_task(name, task)` | enqueue work |
| `agent_claim(name)` | atomically claim one task |
| `agent_task_done(name, id, result?)` | complete a task |
| `agent_set_state(name, key, value)` / `agent_get_state(key)` | shared scratchboard |
| `agent_log(name, line)` | append to team log |

The MCP server is a **thin bridge** — it holds no state; every tool call goes to
the running service. Each CodeGuru window passes its own `name` as the first arg;
use distinct names per window to get a coordinated team.

**Setup note:** `mcp-server.cjs` imports `@modelcontextprotocol/sdk`. On this
machine the SDK (v1.17.0) is resolved via a directory **junction** at
`agentbus/node_modules/@modelcontextprotocol/sdk → Q:\.tools\.npm-global\...\ai-coder-tools\node_modules\@modelcontextprotocol\sdk`.
`node_modules/` is gitignored, so the junction is local-only. If you move the repo,
recreate the junction (or `npm i @modelcontextprotocol/sdk` in `agentbus/`).
