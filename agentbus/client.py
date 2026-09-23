#!/usr/bin/env python3
"""client.py — connect a CodeGuru session to the agent-bus SERVICE.

Pair with server.py (run: `python server.py --port 8765`). Each session creates
an AgentClient with a unique name and talks to the daemon over HTTP.

Usage (from any session, from this folder):
    from client import AgentClient
    c = AgentClient("research-a", port=8765)
    c.register({"role": "researcher"})

    c.send("research-b", {"kind": "request", "query": "..."}, subject="help")
    msgs = c.recv()                     # drain inbox (non-blocking)
    msgs = c.wait(timeout=30)           # OR block until something arrives

    if (tid := c.post_task({"title": "analysis"})):
        task = c.claim("research-a")
        ... do the work ...
        c.task_done(task["id"], {"ok": True})

    c.set_state("phase", "plumbing"); print(c.get_state("phase"))
    c.log("started analysis")

All calls are plain HTTP (stdlib urllib). `wait()` uses long-poll so the server
pushes new mail in near-real-time instead of you polling a folder.
"""
from __future__ import annotations

import json, time, urllib.request, urllib.parse, urllib.error, uuid


class Conflict(Exception):
    """Raised when a compare-and-set write loses the race (HTTP 409)."""


class AgentClient:
    def __init__(self, name: str, base: str = "http://127.0.0.1", port: int = 8765):
        self.name = name
        self.base = f"{base}:{port}"

    # ---- low level ------------------------------------------------------
    def _req(self, method: str, path: str, body: dict | None = None,
             timeout: float = 30) -> dict:
        url = self.base + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def get(self, path: str, timeout: float = 30) -> dict:
        return self._req("GET", path, None, timeout)

    # ---- identity -------------------------------------------------------
    def register(self, meta: dict | None = None) -> dict:
        return self._req("POST", "/register",
                         {"name": self.name, "meta": meta or {}})

    def agents(self) -> list:
        return self.get("/agents").get("agents", [])

    def deregister(self) -> bool:
        return self._req("POST", "/deregister",
                         {"name": self.name}).get("removed", False)

    def alive(self) -> bool:
        try:
            return bool(self.get("/health", timeout=3))
        except Exception:
            return False

    # ---- messaging ------------------------------------------------------
    def send(self, to: str, payload, subject: str = "") -> str:
        return self._req("POST", "/send",
                         {"from": self.name, "to": to, "payload": payload,
                          "subject": subject}).get("id")

    def recv(self, clear: bool = True) -> list:
        return self.get(f"/recv?name={self.name}&clear={'1' if clear else '0'}"
                        ).get("messages", [])

    def recv_ex(self, clear: bool = True) -> tuple:
        """Like recv(), but also returns any pending interrupt flag dict
        (or None). The flag is delivered+cleared on this read, so a working
        agent is steered at its nearest step boundary."""
        r = self.get(f"/recv?name={self.name}&clear={'1' if clear else '0'}")
        return r.get("messages", []), r.get("interrupt")

    def wait(self, timeout: float = 10) -> list:
        """Long-poll: block up to `timeout` sec for new inbox messages."""
        return self.wait_ex(timeout)[0]

    def wait_ex(self, timeout: float = 10) -> tuple:
        """Long-poll for new mail AND any interrupt flag (returned as
        (messages, interrupt_or_None)). Returns at once if either is already
        pending, else blocks until one arrives or `timeout` elapses."""
        try:
            r = self.get(f"/poll?name={self.name}&timeout={timeout}",
                         timeout=timeout + 5)
            return r.get("messages", []), r.get("interrupt")
        except Exception:
            return [], None

    def interrupt(self, other: str, reason: str = "") -> dict:
        """Ask the bus to steer agent `other` at its next delivery. Does not
        block the target's work mid-action; the flag is delivered on its next
        recv/wait and must be handled by that agent."""
        return self._req("POST", "/interrupt",
                         {"from": self.name, "name": other, "reason": reason})

    # ---- tasks ----------------------------------------------------------
    def post_task(self, task: dict) -> str:
        return self._req("POST", "/post-task",
                         {"from": self.name, "payload": task}).get("id")

    def claim(self, worker_hint: str = "") -> dict | None:
        res = self._req("POST", "/claim",
                        {"from": self.name, "worker": worker_hint or self.name})
        return res["task"] if res.get("claimed") else None

    def task_done(self, tid: str, result=None) -> bool:
        return self._req("POST", "/task-done",
                         {"from": self.name, "id": tid, "result": result}
                         ).get("ok", False)

    # ---- shared state ---------------------------------------------------
    def set_state(self, key: str, value, expect=None):
        """Write a shared key. Pass `expect` (the current `ver`, from
        get_state_ver) for compare-and-set: the write is rejected with a
        Conflict error if another writer changed the key meanwhile.
        Returns the new `ver` (CAS token) on success."""
        try:
            r = self._req("POST", "/state/set",
                          {"from": self.name, "key": key, "value": value,
                           "expect": expect})
            return r["ver"]
        except urllib.error.HTTPError as e:
            if e.code == 409:
                raise Conflict(f"state[{key}] changed by another writer")
            raise

    def get_state(self, key: str, default=None):
        return self.get(f"/state/get?key={urllib.parse.quote(key)}"
                        ).get("value", default)

    def get_state_ver(self, key: str):
        """Current compare-and-set version (`ver`) of a key, or None."""
        return self.get(f"/state/get?key={urllib.parse.quote(key)}&v=1"
                        ).get("ver")

    def all_state(self) -> dict:
        return self.get("/state").get("state", {})

    # ---- log ------------------------------------------------------------
    def log(self, line: str):
        return self._req("POST", "/log", {"from": self.name, "line": line})


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(prog="agentbus-client",
                                 description="CodeGuru agent-bus CLI client")
    ap.add_argument("--name", required=True)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--agents", action="store_true", help="list agents")
    ap.add_argument("--deregister", action="store_true",
                    help="remove this agent from the bus")
    ap.add_argument("--send", nargs=2, metavar=("TO", "PAYLOAD"))
    ap.add_argument("--subject", default="")
    ap.add_argument("--recv", action="store_true")
    ap.add_argument("--wait", type=float, default=0)
    ap.add_argument("--post-task", metavar="TITLE")
    ap.add_argument("--state-set", nargs=2, metavar=("KEY", "VALUE"))
    ap.add_argument("--state-expect", metavar="TS",
                    help="compare-and-set version for the next --state-set")
    ap.add_argument("--state-get", metavar="KEY")
    ap.add_argument("--interrupt", nargs="+", metavar="NAME [REASON]",
                    help="steer another agent at its next delivery")
    ap.add_argument("--log", metavar="LINE")
    args = ap.parse_args()

    c = AgentClient(args.name, port=args.port)
    c.register()
    if args.agents:
        for a in c.agents():
            print(a)
    if args.deregister:
        print({"removed": c.deregister()})
    if args.send:
        print(c.send(args.send[0], args.send[1], args.subject))
    if args.recv:
        print(json.dumps(c.recv(), ensure_ascii=False, indent=2))
    if args.wait:
        for m in c.wait(args.wait):
            print(json.dumps(m, ensure_ascii=False))
    if args.post_task:
        print(c.post_task({"title": args.post_task}))
    if args.state_set:
        ts = c.set_state(args.state_set[0], args.state_set[1],
                         expect=args.state_expect)
        print({"ts": ts})
    if args.state_get:
        print(c.get_state(args.state_get))
    if args.interrupt:
        name = args.interrupt[0]
        reason = " ".join(args.interrupt[1:])
        print(c.interrupt(name, reason))
    if args.log:
        c.log(args.log)
