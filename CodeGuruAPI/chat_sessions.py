"""Persist web chat sessions under ~/.codeguru/web-chat/."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sessions_dir() -> Path:
    return Path.home() / ".codeguru" / "web-chat" / "sessions"


def _session_path(session_id: str) -> Path:
    return sessions_dir() / f"{session_id}.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _title_from_text(text: str, max_len: int = 100) -> str:
    line = text.strip().split("\n")[0]
    if len(line) <= max_len:
        return line
    return line[: max_len - 1] + "…"


def _title_from_messages(messages: list[dict[str, Any]]) -> str | None:
    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return _title_from_text(content)
    return None


def ensure_session_title(session: dict[str, Any]) -> None:
    if session.get("title"):
        return
    title = _title_from_messages(session.get("messages") or [])
    if not title and session.get("cli_session_id"):
        title = _title_from_messages(get_display_messages(session))
    if title:
        session["title"] = title
        save_session(session)


def list_sessions(*, limit: int = 50) -> list[dict[str, Any]]:
    """List saved web chats, newest first (skips empty unused sessions)."""
    root = sessions_dir()
    if not root.is_dir():
        return []

    items: list[dict[str, Any]] = []
    for path in root.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict) or not data.get("id"):
            continue

        session_id = str(data["id"])
        if data.get("id") != path.stem:
            continue

        messages = data.get("messages") or []
        has_cli = bool(data.get("cli_session_id"))
        if not messages and not has_cli:
            continue

        title = data.get("title")
        if not title:
            title = _title_from_messages(messages)
        if not title and has_cli:
            title = _title_from_messages(get_display_messages(data))
        if not title:
            title = "Chat"

        items.append(
            {
                "id": session_id,
                "title": title,
                "updated_at": data.get("updated_at"),
                "created_at": data.get("created_at"),
                "message_count": len(messages),
                "has_cli_session": has_cli,
            }
        )

    items.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    return items[:limit]


def create_session() -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    now = _now_iso()
    session = {
        "id": session_id,
        "created_at": now,
        "updated_at": now,
        "cli_session_id": None,
        "title": None,
        "messages": [],
    }
    save_session(session)
    return session


def load_session(session_id: str) -> dict[str, Any] | None:
    path = _session_path(session_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("id") != session_id:
        return None
    data.setdefault("messages", [])
    data.setdefault("cli_session_id", None)
    return data


def get_or_create_session(session_id: str | None) -> dict[str, Any]:
    if session_id:
        existing = load_session(session_id)
        if existing:
            return existing
    return create_session()


def save_session(session: dict[str, Any]) -> None:
    sessions_dir().mkdir(parents=True, exist_ok=True)
    session["updated_at"] = _now_iso()
    _session_path(session["id"]).write_text(
        json.dumps(session, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def append_message(session: dict[str, Any], role: str, content: str) -> None:
    session["messages"].append(
        {
            "role": role,
            "content": content,
            "timestamp": _now_iso(),
        }
    )
    if role == "user" and not session.get("title") and content.strip():
        session["title"] = _title_from_text(content)
    save_session(session)


def set_cli_session_id(session: dict[str, Any], cli_session_id: str | None) -> None:
    if cli_session_id:
        session["cli_session_id"] = cli_session_id
        save_session(session)


def sync_messages_from_cli(session: dict[str, Any], cwd: str | None = None) -> None:
    """Replace web session messages with the CLI transcript (source of truth)."""
    cli_session_id = session.get("cli_session_id")
    if not cli_session_id:
        return
    from cli_transcripts import load_cli_messages

    messages = load_cli_messages(cli_session_id, cwd)
    if messages:
        session["messages"] = messages
        ensure_session_title(session)
        save_session(session)


def get_display_messages(session: dict[str, Any]) -> list[dict[str, Any]]:
    """History for the UI — prefer CLI transcript when linked."""
    cli_session_id = session.get("cli_session_id")
    if cli_session_id:
        from cli_transcripts import load_cli_conversation
        from config import agent_cwd

        cli_messages, _ = load_cli_conversation(cli_session_id, str(agent_cwd()))
        if cli_messages:
            return cli_messages
    return session.get("messages", [])


def get_display_tool_events(session: dict[str, Any]) -> list[dict[str, Any]]:
    """Tool activity log for the UI — from CLI transcript when linked."""
    cli_session_id = session.get("cli_session_id")
    if cli_session_id:
        from cli_transcripts import load_cli_tool_events
        from config import agent_cwd

        events = load_cli_tool_events(cli_session_id, str(agent_cwd()))
        if events:
            return events
    return session.get("tool_events", [])
