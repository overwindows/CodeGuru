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

import json, time, urllib.request, urllib.parse, uuid


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

    def wait(self, timeout: float = 10) -> list:
        """Long-poll: block up to `timeout` sec for new inbox messages."""
        try:
            return self.get(f"/poll?name={self.name}&timeout={timeout}",
                            timeout=timeout + 5).get("messages", [])
        except Exception:
            return []

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
    def set_state(self, key: str, value):
        return self._req("POST", "/state/set",
                         {"from": self.name, "key": key, "value": value})

    def get_state(self, key: str, default=None):
        return self.get(f"/state/get?key={urllib.parse.quote(key)}"
                        ).get("value", default)

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
    ap.add_argument("--state-get", metavar="KEY")
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
        print(c.set_state(args.state_set[0], args.state_set[1]))
    if args.state_get:
        print(c.get_state(args.state_get))
    if args.log:
        c.log(args.log)
