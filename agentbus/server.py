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

import a2a_api

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
        self.interrupts: dict[str, dict] = {}    # name -> {reason, by, ts}
        self._ver: int = 0                       # monotonic CAS version counter
        self.logs: list[str] = []
        self.answers: dict[str, dict] = {}       # id -> ask-chen answer entry
        self.answers_ev = threading.Event()      # wakes the ask-chen worker

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
            ("answers.json", lambda d: self.answers.update(d)),
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
    def _ld_state(self, d):
        self.state = {k: v for k, v in d.items()}
        # advance the version counter past every loaded version so new writes
        # can never collide with versions already in the persisted state
        for e in self.state.values():
            if isinstance(e, dict) and isinstance(e.get("ver"), int):
                self._ver = max(self._ver, e["ver"])

    def persist(self):
        if not self.state_dir:
            return
        self._save("agents.json", self.agents)
        self._save("inboxes.json", self.inboxes)
        self._save("tasks.json", self.tasks)
        self._save("state.json", self.state)
        self._save("answers.json", self.answers)
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
            self.interrupts.pop(name, None)
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
        """Return leftover messages, any pending interrupt, and a fresh
        Event to wait on. If either is already present the waiter returns
        immediately without blocking."""
        with self.lock:
            pending = list(self.inboxes.get(name, []))
            intr = self.drain_interrupt(name)
            self.polls.setdefault(name, []).append(threading.Event())
            ev = self.polls[name][-1]
            if pending or intr:
                ev.set()  # make wait() return at once; caller drains below
            return pending, intr, ev

    def done_polling(self, name, ev):
        with self.lock:
            try:
                self.polls.setdefault(name, []).remove(ev)
            except ValueError:
                pass

    # -- interrupt ---------------------------------------------------------
    def interrupt(self, name, reason="", by="anon"):
        """Flag `name` to be steered at its next inbox delivery.

        The flag is delivered (and cleared) on the next poll/recv for that
        name, so a working agent is interrupted at its nearest step boundary
        rather than mid-action. Wake any waiting long-poller so an idle agent
        sees it immediately.
        """
        with self.lock:
            entry = {"reason": reason, "by": by, "ts": _now()}
            self.interrupts[name] = entry
            self._wake(name)
            self.persist()
            return entry

    def drain_interrupt(self, name):
        """Return and clear any pending interrupt flag for `name`."""
        with self.lock:
            entry = self.interrupts.pop(name, None)
            if entry:
                self.persist()
            return entry

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
    def set_state(self, key, value, by="anon", expect=None):
        """Write a shared key. `expect` enables compare-and-set: if given and
        it doesn't match the current entry's `ver`, the write is rejected
        (returns (None, current)) so a coordinated objective isn't blindly
        overwritten by a stale view. Versions are unique per write (monotonic),
        so two writes in the same second never collide."""
        with self.lock:
            cur = self.state.get(key)
            cur_ver = cur.get("ver") if cur else None
            if expect is not None and cur_ver != expect:
                return None, cur
            self._ver += 1
            entry = {"key": key, "value": value, "by": by, "ts": _now(),
                     "ver": self._ver}
            self.state[key] = entry
            self.persist()
            return entry, cur

    def get_state(self, key):
        with self.lock:
            v = self.state.get(key)
            return v["value"] if v else None

    def state_ver(self, key):
        """Return the current CAS version (`ver`) of a key, or None if unset
        (e.g. a legacy key written before versions existed)."""
        with self.lock:
            v = self.state.get(key)
            return v.get("ver") if v else None

    def all_state(self):
        with self.lock:
            return {k: v["value"] for k, v in self.state.items()}

    # -- ask-chen ---------------------------------------------------------
    def post_question(self, question, caller, asked_by):
        aid = uuid.uuid4().hex
        entry = {"id": aid, "question": question, "caller": caller or "",
                 "status": "pending", "answer": None, "sources": [],
                 "confidence": None, "needs_human": False, "ts": _now(),
                 "asked_by": asked_by}
        with self.lock:
            self.answers[aid] = entry
            self.answers_ev.set()
            self.persist()
        return aid

    def get_answer(self, aid):
        with self.lock:
            e = self.answers.get(aid)
            return dict(e) if e else None

    def answer_done(self, aid, result):
        with self.lock:
            e = self.answers.get(aid)
            if not e:
                return False
            e["status"] = "done"
            e["answer"] = result.get("answer")
            e["sources"] = result.get("sources") or []
            e["confidence"] = result.get("confidence")
            e["needs_human"] = bool(result.get("needs_human"))
            if result.get("error"):
                e["error"] = result["error"]
            self.persist()
            return True

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
    store: Store = None      # injected by main()
    ask_token: str | None = None
    port: int = 8765

    # ---- helpers --------------------------------------------------------
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _ask_auth(self) -> bool:
        """Return True if the request carries the shared Ask-Chen Bearer token.
        A2A security: 401 on missing/wrong token, 501 if not configured.
        Sends the error response itself on failure."""
        ok, status, err = a2a_api.check_auth(
            a2a_api.extract_token(self.headers.get("Authorization", "")),
            self.ask_token)
        if not ok:
            self._json(err, status)
            return False
        return True

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
            intr = st.drain_interrupt(name)
            return self._json({"messages": st.recv(name, clear), "interrupt": intr})
        if path == "/state/get":
            key = q.get("key", [""])[0]
            if q.get("v", ["0"])[0] in ("1", "true"):
                return self._json({"value": st.get_state(key),
                                   "ver": st.state_ver(key)})
            return self._json({"value": st.get_state(key)})
        # A2A discovery: the Agent Card
        if path == "/.well-known/agent-card.json":
            return self._json(a2a_api.agent_card(
                f"http://127.0.0.1:{Handler.port}"))
        # A2A GetTask: GET /tasks/{id}
        if path.startswith("/tasks/"):
            if not self._ask_auth():
                return
            tid = path[len("/tasks/"):]
            e = st.get_answer(tid)
            if not e:
                return self._json({"error": "not found"}, 404)
            return self._json({"task": a2a_api.stored_entry_to_task(e)})
        return self._json({"error": "not found"}, 404)

    def _poll(self, q):
        name = q.get("name", [""])[0]
        timeout = float(q.get("timeout", ["10"])[0])
        st = self.store
        pending, intr, ev = st.poll_pending(name)
        # if a message or interrupt is already waiting, return immediately
        if pending or intr:
            st.done_polling(name, ev)
            msgs = st.recv(name, clear=True)
            return self._json({"messages": msgs, "interrupt": intr})
        ev.wait(timeout)
        st.done_polling(name, ev)
        msgs = st.recv(name, clear=True)
        intr = st.drain_interrupt(name)
        return self._json({"messages": msgs, "interrupt": intr})

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
        if path == "/interrupt":
            if not name:
                return self._json({"error": "name required"}, 400)
            return self._json({"interrupt": st.interrupt(name,
                                                         body.get("reason", ""),
                                                         sender)})
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
            entry, cur = st.set_state(body.get("key", ""), body.get("value"),
                                      sender, body.get("expect"))
            if entry is None:
                return self._json({"error": "conflict", "current_ver": cur.get("ver") if cur else None,
                                   "hint": "set_state requires expect=<current ver>"}, 409)
            return self._json({"state": entry, "ver": entry["ver"]})
        if path == "/log":
            return self._json({"lines": st.log(body.get("line", ""), sender)})
        # ---- A2A endpoints (per A2A v1.0 REST binding) ----
        if path.startswith("/tasks/") and path.endswith(":cancel"):
            if not self._ask_auth():
                return
            tid = path[len("/tasks/"):-len(":cancel")]
            e = st.get_answer(tid)
            if not e:
                return self._json({"error": "not found"}, 404)
            if e["status"] == "pending":
                with st.lock:
                    e["status"] = "error"
                    e["answer"] = "canceled by client"
                    st.persist()
                st.answers_ev.set()
            return self._json({"task": a2a_api.stored_entry_to_task(e)})
        if path == "/message:send":
            if not self._ask_auth():
                return
            msg = body.get("message") or {}
            # Accept the question either as the message text or a legacy
            # top-level "question" field for convenience during migration.
            question = ""
            for part in msg.get("parts") or []:
                if part.get("text"):
                    question = part["text"].strip()
                    break
            if not question:
                question = (body.get("question") or "").strip()
            if not question:
                return self._json({"error": "message requires a text part"}, 400)
            caller = msg.get("metadata", {}).get("caller") if isinstance(
                msg.get("metadata"), dict) else None
            tid = st.post_question(question, caller, "a2a-client")
            return self._json({"task": {"id": tid, "status": {
                "state": "TASK_STATE_SUBMITTED", "timestamp": _now()}}})
        return self._json({"error": "not found"}, 404)


def _azure_worker(store: Store):
    """Daemon thread: bridge the remote Azure Storage-queue inbox into the local
    ask-chen worker, and post replies back to the results queue.

    Remote agents (Claude/Copilot over the internet) enqueue questions to the
    `askchen-inbox` queue with a `{"question":..., "id":...}` payload. We claim
    each one, answer it via ask_chen, enqueue `{"id":..., "result":{...}}` to
    `askchen-replies`, then delete the inbox message. This lets colleagues reach
    Chen's KB without exposing any local compute to the internet (Azure blocked
    the Function-app deployment via the MAI public-no-auth deny policy, so the
    Storage-queue relay is the remote door; all real work stays local).
    """
    try:
        import azure_queue
        import ask_chen
        conn = os.environ.get("AGENTBUS_AZURE_CONN")
        if not conn:
            print("azure-relay: AGENTBUS_AZURE_CONN not set; relay disabled",
                  flush=True)
            return
        client = azure_queue.QueueClient.from_connection_string(conn)
    except Exception as e:  # noqa: BLE001
        print(f"azure-relay: init failed ({str(e)[:200]}); relay disabled",
              flush=True)
        return

    inbox, replies = "askchen-inbox", "askchen-replies"
    while True:
        try:
            msg = client.recv(inbox, visibility_timeout=300)
        except Exception as e:  # noqa: BLE001
            time.sleep(5)
            continue
        if not msg:
            time.sleep(3)
            continue
        try:
            payload = json.loads(msg["text"] or "{}")
            if not isinstance(payload, dict):
                payload = {"question": str(payload)}
            question = (payload.get("question") or "").strip()
            rid = payload.get("id") or decode_reply_id(msg.get("id", ""))
            caller = payload.get("caller", "azure-relay")
            if not question:
                client.delete(inbox, msg["id"], msg["receipt"])
                continue
            result = ask_chen.answer(question, caller)
            client.put(replies, json.dumps({"id": rid, "result": result},
                                           ensure_ascii=False))
            client.delete(inbox, msg["id"], msg["receipt"])
            store.log(f"azure-relay: answered '{question[:80]}' -> {rid}",
                      by="azure-relay")
            if result.get("needs_human"):
                store.send("chen", {"question": question,
                                    "answer": result.get("answer"),
                                    "sources": result.get("sources")},
                           subject="ask-chen: needs human (azure relay)",
                           sender="azure-relay")
        except Exception as e:  # noqa: BLE001
            store.log(f"azure-relay: error {str(e)[:200]}", by="azure-relay")
            time.sleep(3)


def decode_reply_id(queue_msg_id: str) -> str:
    """"Correlation id for replies when the client didn't supply one: reuse the
    Azure queue MessageId (a short, unique token the client can read back from
    the responses only if we echo it). For replies we echo it as the id."""
    return queue_msg_id or str(uuid.uuid4().hex)


def _answer_worker(store: Store):
    """Daemon thread: claim pending /ask questions, run claude, store result.
    Flags needs_human answers to Chen's inbox + log."""
    while True:
        aid = None
        with store.lock:
            for a in store.answers.values():
                if a.get("status") == "pending":
                    aid = a["id"]
                    a["status"] = "working"
                    break
            if aid is None:
                store.answers_ev.clear()
        if aid is None:
            store.answers_ev.wait(timeout=2)
            continue
        try:
            e = store.get_answer(aid)
            import ask_chen
            result = ask_chen.answer(e.get("question", ""), e.get("caller", ""))
            store.answer_done(aid, result)
            if result.get("needs_human"):
                subject = "ask-chen: needs human"
                payload = {"question": e.get("question"),
                           "answer": result.get("answer"),
                           "sources": result.get("sources")}
                store.send("chen", payload, subject=subject,
                           sender="ask-chen")
                store.log(
                    f"ask-chen `{e.get('caller','')}` needs human: "
                    f"{e.get('question','')[:120]}")
        except Exception as ex:  # noqa: BLE001
            store.answer_done(aid, {"answer": f"worker error: {str(ex)[:200]}",
                                    "sources": [], "confidence": 0,
                                    "needs_human": True,
                                    "error": str(ex)[:200]})


def main(argv=None):
    ap = argparse.ArgumentParser(prog="agentbus-server",
                                 description="CodeGuru agent-bus service")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--state-dir", default=None,
                    help="JSON persistence dir (omit for in-memory only)")
    ap.add_argument("--ask-token", default=os.environ.get("AGENTBUS_ASK_TOKEN"),
                    help="shared Bearer token for the /ask endpoints "
                         "(omit to disable Ask-Chen)")
    ap.add_argument("--azure-relay", action="store_true",
                    help="also bridge the remote Azure Storage-queue inbox "
                         "(reads AGENTBUS_AZURE_CONN; polls askchen-inbox -> "
                         "askchen-replies)")
    args = ap.parse_args(argv)

    store = Store(args.state_dir)
    store.load()
    Handler.store = store
    Handler.ask_token = args.ask_token
    Handler.port = args.port

    if args.ask_token:
        t = threading.Thread(target=_answer_worker, args=(store,), daemon=True)
        t.start()

    if args.azure_relay:
        import ask_chen  # ensure the answer worker is available to the relay
        rt = threading.Thread(target=_azure_worker, args=(store,), daemon=True)
        rt.start()

    if args.state_dir:
        print(f"state-dir : {args.state_dir}", flush=True)
    print(f"listening : http://{args.host}:{args.port}", flush=True)
    print(f"health    : GET /health", flush=True)
    print(f"ask-chen  : {'enabled (--ask-token)' if args.ask_token else 'DISABLED (no --ask-token)'}",
          flush=True)
    if args.ask_token:
        print(f"a2a card  : GET /.well-known/agent-card.json", flush=True)
        print(f"a2a send  : POST /message:send   (Bearer token)", flush=True)
        print(f"a2a task  : GET /tasks/{{id}}     (Bearer token)", flush=True)
    print(f"azure-relay: {'enabled (--azure-relay)' if args.azure_relay else 'DISABLED (no --azure-relay)'}",
          flush=True)

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
