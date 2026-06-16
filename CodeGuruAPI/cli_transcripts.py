"""Read CodeGuru CLI session transcripts (jsonl) for web UI history."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from config import agent_cwd

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


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
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


def load_cli_messages(
    session_id: str,
    cwd: str | Path | None = None,
) -> list[dict[str, Any]]:
    path = transcript_path(session_id, cwd)
    if not path:
        return []

    messages: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        if entry.get("isSidechain"):
            continue

        entry_type = entry.get("type")
        if entry_type not in ("user", "assistant"):
            continue

        body = entry.get("message") or {}
        text = _extract_text(body.get("content"))
        if not text.strip():
            continue

        messages.append(
            {
                "role": "user" if entry_type == "user" else "assistant",
                "content": text,
                "timestamp": entry.get("timestamp"),
            }
        )
    return messages
