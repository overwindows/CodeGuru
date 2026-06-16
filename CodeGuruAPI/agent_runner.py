"""Run the CodeGuru CLI in headless mode and parse stream-json output."""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from cli_env import subprocess_env
from config import agent_cwd, permission_mode, repo_root, web_append_system_prompt, web_disable_tools


class AgentRunnerError(Exception):
    pass


def _find_bun() -> str | None:
    candidates = [
        shutil.which("bun"),
        os.path.expanduser("~/.bun/bin/bun"),
        "/opt/homebrew/bin/bun",
    ]
    root = repo_root()
    local_bun = root / "node_modules" / ".bin" / "bun"
    if local_bun.is_file():
        candidates.insert(0, str(local_bun))

    for path in candidates:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def resolve_cli_command() -> list[str] | None:
    explicit = os.environ.get("CODEGURU_CLI")
    if explicit:
        return shlex.split(explicit)

    root = repo_root()
    cli_tsx = root / "src" / "entrypoints" / "cli.tsx"
    if cli_tsx.is_file():
        bun = _find_bun()
        if bun:
            return [bun, "run", str(cli_tsx)]

        if os.environ.get("CODEGURU_ALLOW_NPX_BUN", "0") == "1":
            npx = shutil.which("npx")
            if npx:
                return [npx, "--yes", "bun", "run", str(cli_tsx)]

    codeguru = shutil.which("codeguru")
    if codeguru:
        return [codeguru]

    if os.environ.get("CODEGURU_ALLOW_CLAUDE_CLI", "1") == "1":
        claude = shutil.which("claude")
        if claude:
            return [claude]

    return None


def describe_cli(cmd: list[str] | None) -> str:
    if not cmd:
        return "none"
    binary = Path(cmd[0]).name
    if binary in {"bun", "npx"}:
        return "codeguru-dev"
    if binary == "codeguru":
        return "codeguru"
    if binary == "claude":
        return "claude-system"
    return binary


def cli_available() -> bool:
    return resolve_cli_command() is not None


def _build_command(
    prompt: str,
    *,
    session_id: str | None = None,
    cwd: Path | None = None,
) -> list[str]:
    base = resolve_cli_command()
    if not base:
        raise AgentRunnerError(
            "CodeGuru CLI not found. Install Bun and run from the repo root, "
            "or set CODEGURU_CLI to the CLI launch command."
        )

    workdir = cwd or agent_cwd()
    cmd = [
        *base,
        "-p",
        prompt,
        "--verbose",
        "--output-format",
        "stream-json",
        "--permission-mode",
        permission_mode(),
        "--append-system-prompt",
        web_append_system_prompt(),
        "--add-dir",
        str(workdir),
    ]

    if web_disable_tools():
        cmd.extend(["--tools", ""])

    # Follow-up turns: --continue loads the latest saved transcript (reliable
    # in print mode). --resume <uuid> fails when the jsonl is not on disk yet.
    if session_id:
        cmd.append("--continue")

    return cmd


def _extract_assistant_text(message: dict[str, Any]) -> str:
    content = message.get("message", {}).get("content") or []
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            parts.append(block.get("text") or "")
        elif block_type == "tool_use":
            name = block.get("name") or "tool"
            parts.append(f"\n\n**[{name}]**\n")
    return "".join(parts)


def _parse_stream_event(obj: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    event = obj.get("event") or {}
    event_type = event.get("type")

    if event_type == "content_block_delta":
        delta = event.get("delta") or {}
        if delta.get("type") == "text_delta":
            text = delta.get("text") or ""
            if text:
                yield ("delta", {"text": text})
        elif delta.get("type") == "input_json_delta":
            yield ("tool_progress", {"partial": delta.get("partial_json") or ""})

    elif event_type == "content_block_start":
        block = event.get("content_block") or {}
        if block.get("type") == "tool_use":
            yield (
                "tool_start",
                {"name": block.get("name"), "id": block.get("id")},
            )


def _parse_line(line: str) -> Iterator[tuple[str, dict[str, Any]]]:
    line = line.strip()
    if not line:
        return

    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        yield ("log", {"line": line})
        return

    msg_type = obj.get("type")

    if msg_type == "system" and obj.get("subtype") == "init":
        yield (
            "session",
            {
                "session_id": obj.get("session_id"),
                "model": obj.get("model"),
                "cwd": obj.get("cwd"),
            },
        )
        return

    if msg_type == "stream_event":
        yield from _parse_stream_event(obj)
        if obj.get("session_id"):
            yield ("session", {"session_id": obj.get("session_id")})
        return

    if msg_type == "assistant":
        text = _extract_assistant_text(obj)
        if text:
            yield ("message", {"text": text})
        if obj.get("session_id"):
            yield ("session", {"session_id": obj.get("session_id")})
        return

    if msg_type == "streamlined_text":
        text = obj.get("text") or ""
        if text:
            yield ("message", {"text": text})
        return

    if msg_type == "streamlined_tool_use_summary":
        summary = obj.get("tool_summary") or ""
        if summary:
            yield ("tool_summary", {"text": summary})
        return

    if msg_type == "result":
        result_text = obj.get("result")
        if isinstance(result_text, str) and result_text.strip():
            yield ("message", {"text": result_text})
        yield (
            "done",
            {
                "subtype": obj.get("subtype"),
                "is_error": obj.get("is_error"),
                "duration_ms": obj.get("duration_ms"),
                "total_cost_usd": obj.get("total_cost_usd"),
                "session_id": obj.get("session_id"),
            },
        )
        return

    if msg_type == "system" and obj.get("subtype") == "status":
        yield ("status", {"status": obj.get("status")})


def run_agent_stream(
    prompt: str,
    *,
    session_id: str | None = None,
    cwd: Path | None = None,
) -> Iterator[tuple[str, dict[str, Any]]]:
    cmd = _build_command(prompt, session_id=session_id, cwd=cwd)
    workdir = cwd or agent_cwd()

    env = subprocess_env()

    yield (
        "started",
        {
            "command": cmd[:6],
            "cwd": str(workdir),
            "cli_kind": describe_cli(cmd),
        },
    )

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(workdir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except OSError as exc:
        raise AgentRunnerError(f"Failed to start CodeGuru CLI: {exc}") from exc

    assert proc.stdout is not None
    stderr_lines: list[str] = []
    done_with_error = False
    assistant_text = ""

    for line in proc.stdout:
        for event_type, payload in _parse_line(line):
            if event_type == "done" and payload.get("is_error"):
                done_with_error = True
            elif event_type == "message" and payload.get("text"):
                assistant_text += payload["text"]
            yield (event_type, payload)

    proc.wait()
    if proc.stderr is not None:
        stderr_lines = [line.rstrip() for line in proc.stderr.readlines() if line.strip()]

    if proc.returncode != 0:
        # CLI often exits 1 after surfacing the real error in stream-json output.
        if done_with_error or assistant_text.strip():
            return

        detail = "\n".join(stderr_lines[-20:]).strip()
        if not detail:
            detail = f"CLI exited with code {proc.returncode}"
        elif "Cannot find module" in detail or "lodash-es" in detail:
            detail += (
                "\n\nFix: install CLI dependencies in the repo root:\n"
                f"  cd {repo_root()} && npm install --legacy-peer-deps"
            )
        elif "EACCES" in detail and ".npm" in detail:
            detail += (
                "\n\nFix npm cache permissions, then install Bun:\n"
                "  sudo chown -R \"$(whoami)\" ~/.npm\n"
                "  brew install oven-sh/bun/bun\n"
                "  export CODEGURU_CLI=\"bun run "
                f"{repo_root() / 'src' / 'entrypoints' / 'cli.tsx'}\""
            )
        elif "needs an update" in detail or "claude update" in detail:
            detail += (
                "\n\nFix: install Bun for the dev CLI, or set CODEGURU_CLI to your "
                "local CodeGuru entrypoint. The web UI skips the upstream version gate "
                "when Bun is used from this repo."
            )
        yield ("error", {"message": detail, "code": proc.returncode})
        return

    if stderr_lines:
        yield ("log", {"line": "\n".join(stderr_lines[-5:])})
