#!/usr/bin/env python3
"""research_loop.py — a long-poll MONITOR that receives bus messages and DRIVES
this research agent to act on them.

How it works (the model you described):
  - `c.wait(timeout)` is a LONG-POLL: the request blocks server-side and returns
    the INSTANT a message lands (or after `timeout` sec). No busy-loop polling.
  - Each returned message is dispatched to a handler, which can do research work
    and reply on the bus. The loop wakes on demand and drives the agent.

    while True:
        for m in c.wait(timeout=60):   <- monitor: sleep until mail arrives
            handle_msg(c, m)           <- drive: act on whatever came in

Also drains the shared TASK queue (claim -> run -> done) like demo_worker, so a
colleague can hand you work via post_task and you'll pick it up.

Usage:
    python research_loop.py --name chen-session              # monitor + work
    python research_loop.py --name chen-session --once       # one pass, then exit
    python research_loop.py --name chen-session --role analyst

Run it from this folder with the service up (python launcher.py).
"""
import argparse, time, json


# ---- plug in your real research work here --------------------------
def handle_msg(c, name, msg):
    """Drive step: decide what to do with an inbox message."""
    sender, subject = msg.get("from"), msg.get("subject")
    payload = msg.get("payload")
    print(f"[{name}] <-- msg from {sender}"
          + (f" [{subject}]" if subject else "") + f": {json.dumps(payload)}",
          flush=True)

    # Example routing — replace with real logic.
    if subject == "research":
        print(f"[{name}] doing research on: {payload}", flush=True)
        # ... run your research, then reply on the bus ...
        c.send(sender, {"result": "done"}, subject="research-done")
    elif isinstance(payload, dict) and payload.get("ping"):
        c.send(sender, "pong", subject="auto-reply")


def handle_task(c, name, task):
    """A claimed unit of work (posted by any agent)."""
    title = task.get("title") or task.get("id")
    print(f"[{name}] took task: {title} — inputs: {json.dumps(task.get('inputs'))}",
          flush=True)
    time.sleep(0.2)  # pretend to work
    return {"ok": True, "result": f"researched {title}"}


# ---- the monitor loop ----------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="this session's unique bus name")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--role", default="researcher", help="meta role to register as")
    ap.add_argument("--once", action="store_true", help="one pass then exit")
    ap.add_argument("--wait", type=float, default=60.0,
                    help="long-poll seconds before the loop wakes for housekeeping")
    args = ap.parse_args()

    from client import AgentClient
    c = AgentClient(args.name, port=args.port)
    if not c.alive():
        print(f"[{args.name}] ERROR: no service on port {args.port}. "
              f"Start it: python launcher.py", flush=True)
        return
    c.register({"role": args.role, "window": "current"})
    print(f"[{args.name}] monitor ONLINE (role={args.role}). Ctrl-C to stop.",
          flush=True)

    try:
        while True:
            # 1) pick up any waiting work (claim is atomic — one worker only)
            while True:
                task = c.claim(args.name)
                if not task:
                    break
                c.task_done(task["id"], handle_task(c, args.name, task))
            # 2) long-poll: monitor until new mail arrives, then act on it
            for m in c.wait(timeout=args.wait):
                handle_msg(c, args.name, m)
            if args.once:
                break
    except KeyboardInterrupt:
        print(f"\n[{args.name}] monitor stopping", flush=True)


if __name__ == "__main__":
    main()
