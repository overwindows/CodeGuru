#!/usr/bin/env python3
"""launcher.py — bring the agent-bus SERVICE up (no-op if it's already running).

The service is the one long-lived prerequisite for multi-window coordination.
This launcher removes the "did I remember to start the server?" step: it checks
the port and daemonizes server.py if needed.

Usage:
    python launcher.py                 # ensure service up (start if needed)
    python launcher.py --stop          # stop a running service on the port

The default state-dir is the OneDrive folder so state syncs across machines and
survives restarts. Override with --state-dir / --port / AGENT_BUS_* env vars.
"""
from __future__ import annotations

import argparse, json, os, platform, signal, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _default_state_dir() -> str:
    env = os.environ.get("AGENT_BUS_STATE_DIR")
    if env:
        return env
    od = str(Path.home() / "OneDrive - Microsoft" / ".codeguru-agent-bus")
    return od


def is_up(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as r:
            return json.loads(r.read().decode()).get("ok") is True
    except Exception:
        return False


def start(port: int, state_dir: str, log_path: str) -> bool:
    if is_up(port):
        print(f"service already up on :{port}")
        return True
    logf = open(log_path, "a", encoding="utf-8")
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    cmd = [sys.executable, str(HERE / "server.py"), "--port", str(port)]
    if state_dir:
        cmd += ["--state-dir", state_dir]
    # DETACHED so the service outlives the launching terminal/session.
    if platform.system() == "Windows":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        creationflags = flags | subprocess.CREATE_NO_WINDOW
        subprocess.Popen(cmd, stdout=logf, stderr=logf, env=env,
                         stdin=subprocess.DEVNULL, close_fds=True,
                         creationflags=creationflags)
    else:
        subprocess.Popen(cmd, stdout=logf, stderr=logf, env=env,
                         stdin=subprocess.DEVNULL, start_new_session=True,
                         close_fds=True)
    # wait for the service to answer
    for _ in range(40):
        if is_up(port):
            print(f"service started on :{port}")
            print(f"state-dir : {state_dir}")
            print(f"log       : {log_path}")
            return True
        time.sleep(0.25)
    print("service failed to start; check the log at:", log_path, flush=True)
    return False


def _pids_on_port(port: int) -> list[int]:
    """Return the local PIDs listening on `port` (Windows netstat / unix lsof)."""
    pids: set[int] = set()
    try:
        if platform.system() == "Windows":
            out = subprocess.run(
                ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True).stdout
            for line in out.splitlines():
                parts = line.split()
                # e.g. "  TCP    127.0.0.1:8765    0.0.0.0:0    LISTENING    12345"
                if len(parts) >= 5 and f":{port}" in parts[1] and parts[3] == "LISTENING":
                    pids.add(int(parts[4]))
        else:
            out = subprocess.run(
                ["lsof", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
                capture_output=True, text=True).stdout
            for pid in out.split():
                if pid.isdigit():
                    pids.add(int(pid))
    except Exception:
        pass
    return sorted(pids)


def stop(port: int) -> bool:
    if not is_up(port):
        print(f"no service on :{port}")
        return True
    pids = _pids_on_port(port)
    if not pids:
        print(f"service responds but no listening PID found on :{port} (stop manually)")
        return False
    for pid in pids:
        kill(pid)
    # wait for it to stop answering
    for _ in range(40):
        if not is_up(port):
            print(f"service stopped on :{port} (pid(s) {pids})")
            return True
        time.sleep(0.25)
    print(f"service still up on :{port} — kill didn't take effect?")
    return False


def kill(pid: int) -> None:
    try:
        if platform.system() == "Windows":
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
        else:
            os.kill(pid, signal.SIGTERM)
    except Exception:
        pass


def check(port: int) -> int:
    return 0 if is_up(port) else 1


def main(argv=None):
    ap = argparse.ArgumentParser(prog="agentbus-launcher",
                                 description="ensures the agent-bus service is running")
    ap.add_argument("--port", type=int, default=int(os.environ.get("AGENT_BUS_PORT", 8765)))
    ap.add_argument("--state-dir", default=None,
                    help="persistence dir (default: OneDrive .codeguru-agent-bus)")
    ap.add_argument("--log", default=None, help="service log path")
    ap.add_argument("--stop", action="store_true", help="stop a running service")
    ap.add_argument("--check", action="store_true", help="exit 0 if up, 1 if down")
    args = ap.parse_args(argv)

    state_dir = args.state_dir or _default_state_dir()
    log_path = args.log or str(HERE / "service.log")

    if args.check:
        return check(args.port)
    if args.stop:
        return 0 if stop(args.port) else 1
    return 0 if start(args.port, state_dir, log_path) else 1


if __name__ == "__main__":
    sys.exit(main())
