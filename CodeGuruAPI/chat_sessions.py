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


def create_session() -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    now = _now_iso()
    session = {
        "id": session_id,
        "created_at": now,
        "updated_at": now,
        "cli_session_id": None,
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
        save_session(session)


def get_display_messages(session: dict[str, Any]) -> list[dict[str, Any]]:
    """History for the UI — prefer CLI transcript when linked."""
    cli_session_id = session.get("cli_session_id")
    if cli_session_id:
        from cli_transcripts import load_cli_messages
        from config import agent_cwd

        cli_messages = load_cli_messages(cli_session_id, str(agent_cwd()))
        if cli_messages:
            return cli_messages
    return session.get("messages", [])
