#!/usr/bin/env python3
"""server.py — the CodeGuru agent-bus SERVICE.

An always-on daemon that agents connect to over HTTP. It routes messages, holds
per-agent inboxes, runs the task claim queue, and keeps shared state — replacing
"agents each polling a shared folder" with a real broker that pushes updates.

Design goals:
  * STDLIB ONLY — no pip install. Runs anywhere Python 3.9+ exists.
  * Real-time push via LONG-POLL, not websockets: a client calls
    GET /poll?name=X&timeout=N and the server holds the request until a new
    inbox message/task appears or the timeout elapses. No extra deps.
  * FILE-BACKED persistence (JSON under --state-dir) so messages/tasks/state
    survive a server restart, and (if --state-dir is on OneDrive) sync across
    machines.
  * Thread-safe: one thread per connection via http.server + ThreadingHTTPServer.

Run:
    python server.py --port 8765                 # in-memory only
    python server.py --port 8765 --state-dir "C:\\Users\\wuc\\OneDrive - Microsoft\\.codeguru-agent-bus"
"""
from __future__ import annotations

import argparse, json, os, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ---------------------------------------------------------------------------
# Storage: a thread-safe in-memory store, optionally file-backed.
# ---------------------------------------------------------------------------
class Store:
    def __init__(self, state_dir: str | None = None):
        self.state_dir = Path(state_dir) if state_dir else None
        self.lock = threading.RLock()
        self.agents: dict[str, dict] = {}          # name -> meta
        self.inboxes: dict[str, list[dict]] = {}   # name -> [msg,...]
        self.by_id: dict[str, dict] = {}           # msg id -> msg (for dedupe)
        self.tasks: dict[str, dict] = {}           # id -> task
        self.state: dict[str, dict] = {}           # key -> {value, by, ts}
        self.polls: dict[str, list[threading.Event]] = {}  # name -> waiters
        self.logs: list[str] = []

    # -- persistence ------------------------------------------------------
    def _fp(self, name: str) -> Path:
        return self.state_dir / name

    def load(self):
        if not self.state_dir:
            return
        self.state_dir.mkdir(parents=True, exist_ok=True)
        for fn, loader in (
            ("agents.json", self._ld_agents),
            ("inboxes.json", self._ld_inboxes),
            ("tasks.json", self._ld_tasks),
            ("state.json", self._ld_state),
        ):
            p = self._fp(fn)
            if p.exists():
                try:
                    loader(json.loads(p.read_text(encoding="utf-8")))
                except Exception:
                    pass

    def _save(self, name, data):
        if not self.state_dir:
            return
        p = self._fp(name)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp{}".format(uuid.uuid4().hex[:6]))
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, p)

    def _ld_agents(self, d): self.agents = {k: v for k, v in d.items()}
    def _ld_inboxes(self, d):
        for k, v in d.items():
            self.inboxes[k] = v; self.by_id.update({m["id"]: m for m in v})
    def _ld_tasks(self, d): self.tasks = {k: v for k, v in d.items()}
    def _ld_state(self, d): self.state = {k: v for k, v in d.items()}

    def persist(self):
        if not self.state_dir:
            return
        self._save("agents.json", self.agents)
        self._save("inboxes.json", self.inboxes)
        self._save("tasks.json", self.tasks)
        self._save("state.json", self.state)
        self._save("log.md", {"_text": "\n".join(self.logs)})

    # -- agents -----------------------------------------------------------
    def register(self, name, meta):
        with self.lock:
            if name not in self.agents:
                self.agents[name] = {"name": name, "registered_at": _now(),
                                     "meta": meta or {}}
            elif meta:
                self.agents[name]["meta"] = {**self.agents[name].get("meta", {}),
                                             **meta}
            self.inboxes.setdefault(name, [])
            return self.agents[name]

    def deregister(self, name):
        """Remove an agent, drop its inbox + poll waiters, and persist."""
        with self.lock:
            removed = self.agents.pop(name, None)
            if removed is None:
                return False
            for m in self.inboxes.pop(name, []):
                self.by_id.pop(m["id"], None)
            for ev in self.polls.pop(name, []):
                ev.set()  # release any long-poll waiter holding the name
            self.persist()
            return True

    def list_agents(self):
        with self.lock:
            return [
                {"name": n, "meta": a.get("meta", {}),
                 "queued": len(self.inboxes.get(n, [])),
                 "alive": bool(self.polls.get(n))}
                for n, a in self.agents.items()
            ]

    # -- messaging --------------------------------------------------------
    def send(self, to, payload, subject="", sender="anon"):
        mid = uuid.uuid4().hex
        msg = {"id": mid, "from": sender, "to": to, "subject": subject,
               "payload": payload, "ts": _now()}
        with self.lock:
            self.inboxes.setdefault(to, []).append(msg)
            self.by_id[mid] = msg
            self._wake(to)
            self.persist()
        return mid

    def recv(self, name, clear=True):
        with self.lock:
            q = list(self.inboxes.get(name, []))
            if clear:
                self.inboxes[name] = []
                for m in q:
                    self.by_id.pop(m["id"], None)
                self.persist()
            return q

    def _wake(self, name):
        for ev in self.polls.get(name, []):
            ev.set()

    def poll_pending(self, name):
        """Return leftover messages and a fresh Event to wait on."""
        with self.lock:
            pending = list(self.inboxes.get(name, []))
            self.polls.setdefault(name, []).append(threading.Event())
            return pending, self.polls[name][-1]

    def done_polling(self, name, ev):
        with self.lock:
            try:
                self.polls.setdefault(name, []).remove(ev)
            except ValueError:
                pass

    # -- tasks ------------------------------------------------------------
    def post_task(self, task):
        tid = task.get("id") or uuid.uuid4().hex
        entry = {"id": tid, "created_at": _now(), "status": "open",
                 **{k: v for k, v in task.items() if k != "id"}}
        with self.lock:
            self.tasks[tid] = entry
            self._wake("*")  # wake any waiting worker
            self.persist()
        return tid

    def claim(self, worker):
        with self.lock:
            for tid, t in self.tasks.items():
                if t.get("status") == "open":
                    t["status"] = "claimed"
                    t["claimed_by"] = worker
                    t["claimed_at"] = _now()
                    self.persist()
                    return {"task": t, "id": tid}
        return None

    def task_done(self, tid, result=None):
        with self.lock:
            t = self.tasks.get(tid)
            if not t:
                return False
            t["status"] = "done"
            t["done_at"] = _now()
            if result is not None:
                t["result"] = result
            self.persist()
            return True

    # -- state ------------------------------------------------------------
    def set_state(self, key, value, by="anon"):
        with self.lock:
            self.state[key] = {"key": key, "value": value, "by": by, "ts": _now()}
            self.persist()
            return self.state[key]

    def get_state(self, key):
        with self.lock:
            v = self.state.get(key)
            return v["value"] if v else None

    def all_state(self):
        with self.lock:
            return {k: v["value"] for k, v in self.state.items()}

    # -- log --------------------------------------------------------------
    def log(self, line, by="anon"):
        with self.lock:
            self.logs.append(f"- `{_now()}` **{by}**: {line}")
            if len(self.logs) > 2000:
                self.logs = self.logs[-2000:]
            self.persist()
            return len(self.logs)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    store: Store = None  # injected by main()

    # ---- helpers --------------------------------------------------------
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(n) if n else b"{}"
            return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return {}

    def log_message(self, *a):
        pass  # silence default stderr logging

    # ---- routes ---------------------------------------------------------
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = u.path.rstrip("/")
        st = self.store

        if path == "/health":
            return self._json({"ok": True, "agents": len(st.agents),
                               "time": _now()})
        if path == "/agents":
            return self._json({"agents": st.list_agents()})
        if path == "/poll":
            return self._poll(q)
        if path == "/state":
            return self._json({"state": st.all_state()})
        if path == "/recv":
            name = q.get("name", [""])[0]
            clear = q.get("clear", ["0"])[0] in ("1", "true")
            return self._json({"messages": st.recv(name, clear)})
        if path == "/state/get":
            return self._json({"value": st.get_state(q.get("key", [""])[0])})
        return self._json({"error": "not found"}, 404)

    def _poll(self, q):
        name = q.get("name", [""])[0]
        timeout = float(q.get("timeout", ["10"])[0])
        st = self.store
        pending, ev = st.poll_pending(name)
        # drain messages that were waiting before we subscribed
        if pending:
            st.done_polling(name, ev)
            return self._json({"messages": pending})
        ev.wait(timeout)
        st.done_polling(name, ev)
        msgs = st.recv(name, clear=True)
        return self._json({"messages": msgs})

    def do_POST(self):
        u = urlparse(self.path)
        path = u.path.rstrip("/")
        body = self._read_body()
        st = self.store
        sender = body.get("from", "anon")
        name = body.get("name", "")
        payload = body.get("payload")

        if path == "/register":
            return self._json({"agent": st.register(name, body.get("meta"))})
        if path == "/deregister":
            if not name:
                return self._json({"error": "name required"}, 400)
            return self._json({"removed": st.deregister(name)})
        if path == "/send":
            return self._json({"id": st.send(body.get("to", ""), payload,
                                             body.get("subject", ""), sender)})
        if path == "/post-task":
            return self._json({"id": st.post_task(payload or {})})
        if path == "/claim":
            res = st.claim(body.get("worker", name))
            return self._json({"claimed": bool(res),
                               **({"task": res["task"]} if res else {})})
        if path == "/task-done":
            return self._json({"ok": st.task_done(body.get("id", ""),
                                                  body.get("result"))})
        if path == "/state/set":
            return self._json({"state": st.set_state(body.get("key", ""),
                                                     body.get("value"), sender)})
        if path == "/log":
            return self._json({"lines": st.log(body.get("line", ""), sender)})
        return self._json({"error": "not found"}, 404)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="agentbus-server",
                                 description="CodeGuru agent-bus service")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--state-dir", default=None,
                    help="JSON persistence dir (omit for in-memory only)")
    args = ap.parse_args(argv)

    store = Store(args.state_dir)
    store.load()
    Handler.store = store

    if args.state_dir:
        print(f"state-dir : {args.state_dir}", flush=True)
    print(f"listening : http://{args.host}:{args.port}", flush=True)
    print(f"health    : GET /health", flush=True)

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
