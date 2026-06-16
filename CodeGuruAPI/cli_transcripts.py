"""Read CodeGuru CLI session transcripts (jsonl) for web UI history."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from config import agent_cwd
from tool_display import summarize_tool_input, summarize_tool_result

_MAX_SANITIZED_LENGTH = 200


def sanitize_path(name: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9]", "-", name)
    if len(sanitized) <= _MAX_SANITIZED_LENGTH:
        return sanitized
    digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:8]
    return f"{sanitized[:_MAX_SANITIZED_LENGTH]}-{digest}"


def config_homes() -> list[Path]:
    homes: list[Path] = []
    override = os.environ.get("CODEGURU_CONFIG_DIR")
    if override:
        homes.append(Path(override).expanduser())
    homes.append(Path.home() / ".codeguru")
    claude_home = Path.home() / ".claude"
    if claude_home not in homes:
        homes.append(claude_home)
    return homes


def transcript_path(session_id: str, cwd: str | Path | None = None) -> Path | None:
    project = sanitize_path(str(cwd or agent_cwd()))
    for home in config_homes():
        candidate = home / "projects" / project / f"{session_id}.jsonl"
        if candidate.is_file():
            return candidate
    return None


def _extract_text_only(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            parts.append(block.get("text") or "")
    return "".join(parts)


def _parse_transcript_lines(
    lines: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Build display messages and flat tool_events from jsonl lines."""
    messages: list[dict[str, Any]] = []
    tool_events: list[dict[str, Any]] = []
    pending: dict[str, dict[str, Any]] = {}

    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue

        if entry.get("isSidechain"):
            continue

        entry_type = entry.get("type")
        body = entry.get("message") or {}
        content = body.get("content")
        timestamp = entry.get("timestamp")

        if entry_type == "assistant" and isinstance(content, list):
            text = _extract_text_only(content).strip()
            turn_tools: list[dict[str, Any]] = []

            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                tool_id = block.get("id") or ""
                name = block.get("name") or "tool"
                summary = summarize_tool_input(name, block.get("input"))
                event = {
                    "id": tool_id,
                    "name": name,
                    "summary": summary,
                    "status": "running",
                    "result_preview": "",
                    "timestamp": timestamp,
                }
                turn_tools.append(event)
                tool_events.append(event)
                if tool_id:
                    pending[tool_id] = event

            if text or turn_tools:
                messages.append(
                    {
                        "role": "assistant",
                        "content": text,
                        "tools": turn_tools,
                        "timestamp": timestamp,
                    }
                )
            continue

        if entry_type == "user" and isinstance(content, list):
            user_text = _extract_text_only(content).strip()
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                tool_id = block.get("tool_use_id") or ""
                event = pending.get(tool_id)
                status, preview = summarize_tool_result(block.get("content"))
                if event:
                    event["status"] = status
                    event["result_preview"] = preview
                else:
                    tool_events.append(
                        {
                            "id": tool_id,
                            "name": "tool",
                            "summary": "",
                            "status": status,
                            "result_preview": preview,
                            "timestamp": timestamp,
                        }
                    )

            if user_text:
                messages.append(
                    {
                        "role": "user",
                        "content": user_text,
                        "timestamp": timestamp,
                    }
                )
            continue

        if entry_type == "user" and isinstance(content, str) and content.strip():
            messages.append(
                {
                    "role": "user",
                    "content": content.strip(),
                    "timestamp": timestamp,
                }
            )

    return messages, tool_events


def load_cli_messages(
    session_id: str,
    cwd: str | Path | None = None,
) -> list[dict[str, Any]]:
    messages, _ = load_cli_conversation(session_id, cwd)
    return messages


def load_cli_tool_events(
    session_id: str,
    cwd: str | Path | None = None,
) -> list[dict[str, Any]]:
    _, tool_events = load_cli_conversation(session_id, cwd)
    return tool_events


def load_cli_conversation(
    session_id: str,
    cwd: str | Path | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    path = transcript_path(session_id, cwd)
    if not path:
        return [], []

    lines = path.read_text(encoding="utf-8").splitlines()
    return _parse_transcript_lines(lines)
