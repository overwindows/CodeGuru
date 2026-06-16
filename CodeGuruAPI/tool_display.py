"""Format CodeGuru agent tool calls for the web UI."""

from __future__ import annotations

import json
from typing import Any

_MAX_PREVIEW = 280
_MAX_SUMMARY = 160


def summarize_tool_input(name: str, tool_input: Any) -> str:
    if not isinstance(tool_input, dict):
        return str(tool_input)[:_MAX_SUMMARY] if tool_input else ""

    n = name or "tool"

    if n == "Bash":
        cmd = tool_input.get("command") or ""
        desc = tool_input.get("description")
        if desc:
            return f"{desc}: {cmd}"[:_MAX_SUMMARY]
        return str(cmd)[:_MAX_SUMMARY]

    if n == "Grep":
        pattern = tool_input.get("pattern") or ""
        path = tool_input.get("path") or tool_input.get("glob") or ""
        return f'"{pattern}" in {path}'[:_MAX_SUMMARY]

    if n == "Glob":
        pattern = tool_input.get("pattern") or ""
        path = tool_input.get("path") or ""
        return f"{pattern} @ {path}"[:_MAX_SUMMARY]

    if n in ("Read", "FileReadTool"):
        return str(tool_input.get("file_path") or tool_input.get("path") or "")[
            :_MAX_SUMMARY
        ]

    if n in ("Edit", "Write", "FileEditTool", "FileWriteTool"):
        path = tool_input.get("file_path") or tool_input.get("path") or ""
        return str(path)[:_MAX_SUMMARY]

    if n == "WebSearch":
        return str(tool_input.get("query") or "")[:_MAX_SUMMARY]

    if n == "WebFetch":
        url = tool_input.get("url") or ""
        prompt = tool_input.get("prompt")
        if prompt:
            return f"{url} — {prompt}"[:_MAX_SUMMARY]
        return str(url)[:_MAX_SUMMARY]

    if n == "Agent":
        return str(tool_input.get("prompt") or tool_input.get("description") or "")[
            :_MAX_SUMMARY
        ]

    try:
        compact = json.dumps(tool_input, ensure_ascii=False)
    except (TypeError, ValueError):
        compact = str(tool_input)
    return compact[:_MAX_SUMMARY]


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text") or "")
        return "".join(parts)
    return str(content) if content is not None else ""


def summarize_tool_result(content: Any) -> tuple[str, str]:
    """Return (status, preview) where status is ok | error | denied."""
    text = _content_to_text(content).strip()
    if not text:
        return "ok", "(no output)"

    lowered = text.lower()
    if (
        "requires approval" in lowered
        or "haven't granted" in lowered
        or "denied" in lowered
    ):
        return "denied", text[:_MAX_PREVIEW]

    if (
        text.startswith("Error")
        or "ENOENT" in text
        or "error:" in lowered
        or "failed" in lowered[:40]
    ):
        return "error", text[:_MAX_PREVIEW]

    return "ok", text[:_MAX_PREVIEW]


def tool_icon(name: str) -> str:
    icons = {
        "Bash": "⌘",
        "Grep": "🔍",
        "Glob": "📁",
        "Read": "📄",
        "Edit": "✏️",
        "Write": "💾",
        "WebSearch": "🌐",
        "WebFetch": "🔗",
        "Agent": "🤖",
    }
    return icons.get(name, "⚙️")
