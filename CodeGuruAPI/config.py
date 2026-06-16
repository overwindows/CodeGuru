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
    override = os.environ.get("CODEGURU_PERMISSION_MODE")
    if override:
        return override
    settings = load_settings()
    perms = settings.get("permissions")
    if isinstance(perms, dict) and perms.get("defaultMode"):
        return str(perms["defaultMode"])
    return "acceptEdits"


def permission_allow_rules() -> list[str]:
    """Tool allow rules from settings.json and CODEGURU_ALLOWED_TOOLS."""
    rules: list[str] = []
    env_rules = os.environ.get("CODEGURU_ALLOWED_TOOLS")
    if env_rules:
        rules.extend(r.strip() for r in env_rules.replace(",", " ").split() if r.strip())
    settings = load_settings()
    perms = settings.get("permissions")
    if isinstance(perms, dict):
        for rule in perms.get("allow") or []:
            if rule:
                rules.append(str(rule))
    # Preserve order, drop duplicates.
    seen: set[str] = set()
    out: list[str] = []
    for rule in rules:
        if rule not in seen:
            seen.add(rule)
            out.append(rule)
    return out


def web_append_system_prompt() -> str | None:
    """Optional extra system prompt — unset means use the CLI default prompts only."""
    value = os.environ.get("CODEGURU_WEB_SYSTEM_PROMPT")
    return value if value else None


def web_disable_tools() -> bool:
    """CLI enables tools by default; web matches unless explicitly disabled."""
    return os.environ.get("CODEGURU_WEB_DISABLE_TOOLS", "0") == "1"


def web_fixed_response() -> str | None:
    """Opt-in fixed reply (testing/demo). Unset = normal CLI behavior."""
    if "CODEGURU_WEB_FIXED_RESPONSE" not in os.environ:
        return None
    value = os.environ.get("CODEGURU_WEB_FIXED_RESPONSE", "")
    return value if value else None


def web_use_agent() -> bool:
    """Default on — web chat uses the same CodeGuru CLI agent as the terminal."""
    if "CODEGURU_WEB_USE_AGENT" in os.environ:
        return os.environ.get("CODEGURU_WEB_USE_AGENT", "1") == "1"
    return True


def web_use_llm_fallback() -> bool:
    """When CLI is unavailable, fall back to direct LLM chat."""
    return os.environ.get("CODEGURU_WEB_LLM_FALLBACK", "1") == "1"


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
    use_agent = web_use_agent() and cli_available()
    return {
        "agent_cwd": str(agent_cwd()),
        "cli_available": cli_available(),
        "cli_command": cli[:3] + ["..."] if cli and len(cli) > 3 else cli,
        "cli_kind": describe_cli(cli),
        "llm_configured": bool(cfg.get("api_key")),
        "model": cfg.get("model"),
        "permission_mode": permission_mode(),
        "web_fixed_response": web_fixed_response(),
        "web_use_agent": use_agent,
        "web_mode": (
            "fixed"
            if web_fixed_response() is not None
            else "agent"
            if use_agent
            else "llm"
            if web_use_llm_fallback() and cfg.get("api_key")
            else "unavailable"
        ),
        "repo_root": str(repo_root()),
        "settings_path": str(settings_path()),
    }
