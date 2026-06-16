"""Configuration for the CodeGuru Web API (CODEGURU_* only)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def repo_root() -> Path:
    explicit = os.environ.get("CODEGURU_REPO_ROOT")
    if explicit:
        return Path(explicit).resolve()
    # CodeGuruAPI/ sits next to src/ at the monorepo root.
    return Path(__file__).resolve().parent.parent


def settings_path() -> Path:
    override = os.environ.get("CODEGURU_SETTINGS_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".codeguru" / "settings.json"


def load_settings() -> dict[str, Any]:
    path = settings_path()
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def settings_env() -> dict[str, str]:
    raw = load_settings().get("env") or {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def resolve_env(name: str) -> str | None:
    value = os.environ.get(name)
    if value:
        return value
    return settings_env().get(name)


def agent_cwd() -> Path:
    override = os.environ.get("CODEGURU_CWD")
    if override:
        return Path(override).expanduser().resolve()
    return repo_root()


def permission_mode() -> str:
    return os.environ.get("CODEGURU_PERMISSION_MODE", "acceptEdits")


def web_append_system_prompt() -> str:
    return os.environ.get(
        "CODEGURU_WEB_SYSTEM_PROMPT",
        "Always respond with exactly: Done",
    )


def web_disable_tools() -> bool:
    return os.environ.get("CODEGURU_WEB_DISABLE_TOOLS", "1") == "1"


def web_fixed_response() -> str | None:
    """When set, chat always returns this text (default: Done)."""
    value = os.environ.get("CODEGURU_WEB_FIXED_RESPONSE", "Done")
    return value if value else None


def web_use_agent() -> bool:
    return os.environ.get("CODEGURU_WEB_USE_AGENT", "0") == "1"


def llm_config() -> dict[str, str | None]:
    """OpenAI-compatible API settings for fallback / legacy tasks."""
    return {
        "base_url": resolve_env("CODEGURU_BASE_URL"),
        "api_key": resolve_env("CODEGURU_AUTH_TOKEN"),
        "model": resolve_env("CODEGURU_MODEL") or "MiniMax-M2.7",
    }


def public_status() -> dict[str, Any]:
    cfg = llm_config()
    from agent_runner import cli_available, describe_cli, resolve_cli_command

    cli = resolve_cli_command()
    return {
        "agent_cwd": str(agent_cwd()),
        "cli_available": cli_available(),
        "cli_command": cli[:3] + ["..."] if cli and len(cli) > 3 else cli,
        "cli_kind": describe_cli(cli),
        "llm_configured": bool(cfg.get("api_key")),
        "model": cfg.get("model"),
        "permission_mode": permission_mode(),
        "web_fixed_response": web_fixed_response(),
        "web_use_agent": web_use_agent(),
        "repo_root": str(repo_root()),
        "settings_path": str(settings_path()),
    }
