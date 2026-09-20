#!/usr/bin/env python3
"""demo_worker.py — a CodeGuru session joining the agent-bus SERVICE.

Run one copy per CodeGuru window, each with a different --name. The worker:
  1. registers with the daemon
  2. drains any queued tasks (claim -> run -> done)
  3. long-polls for new messages AND new task notifications in near-real-time
     (the service pushes, instead of this poller hammering a folder)

Usage:
    python server.py --port 8765 &            # start the service first
    python demo_worker.py --name worker-a
    python demo_worker.py --name worker-b
"""
import argparse, time

def handle_task(c, name, task):
    title = task.get("title") or task.get("id")
    print(f"[{name}] took task: {title}", flush=True)
    time.sleep(0.2)  # pretend to work
    return {"ok": True, "result": f"processed {title}"}

def handle_message(c, name, msg):
    print(f"[{name}] msg from {msg.get('from')}: {msg.get('payload')}", flush=True)
    if msg.get("payload") == "ping":
        c.send(msg["from"], "pong", subject="auto-reply")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--once", action="store_true", help="drain once then exit")
    ap.add_argument("--poll", type=float, default=5.0,
                    help="long-poll timeout seconds before housekeeping")
    args = ap.parse_args()

    from client import AgentClient
    c = AgentClient(args.name, port=args.port)
    if not c.alive():
        print(f"[{args.name}] ERROR: no service on port {args.port}. "
              f"Start it: python server.py --port {args.port}", flush=True)
        return
    c.register({"role": "demo-worker"})
    print(f"[{args.name}] connected to bus. (Ctrl-C to stop)", flush=True)

    try:
        while True:
            # drain the task queue first (a real worker loops until empty)
            while True:
                task = c.claim(args.name)
                if not task:
                    break
                res = handle_task(c, args.name, task)
                c.task_done(task["id"], res)
            # then long-poll: server pushes new messages/task-notifications
            for m in c.wait(timeout=args.poll):
                handle_message(c, args.name, m)
            if args.once:
                break
    except KeyboardInterrupt:
        print(f"\n[{args.name}] stopping", flush=True)


if __name__ == "__main__":
    main()
