"""Adapt CODEGURU_* settings for external CLI modules at subprocess spawn time.

CodeGuru-owned code uses only CODEGURU_* names. The upstream CLI and its
dependencies still read ANTHROPIC_* / CLAUDE_* — that translation lives here,
not in user-facing config or app logic.
"""

from __future__ import annotations

import os

from config import settings_env

# Upstream CLI module env names (not used in CodeGuru application code).
_CLI_MODULE_ENV_MAP: tuple[tuple[str, str], ...] = (
    ("CODEGURU_BASE_URL", "ANTHROPIC_BASE_URL"),
    ("CODEGURU_AUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"),
    ("CODEGURU_MODEL", "ANTHROPIC_MODEL"),
    ("CODEGURU_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    ("CODEGURU_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_CODE_AUTO_COMPACT_WINDOW"),
    ("CODEGURU_AUTOCOMPACT_PCT_OVERRIDE", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"),
)


def subprocess_env() -> dict[str, str]:
    """Build env for spawning the upstream CLI child process."""
    env = os.environ.copy()
    merged = settings_env()

    for key, value in merged.items():
        env.setdefault(key, value)

    for codeguru_key, module_key in _CLI_MODULE_ENV_MAP:
        value = env.get(codeguru_key) or merged.get(codeguru_key)
        if value and not env.get(module_key):
            env[module_key] = value

    token = env.get("CODEGURU_AUTH_TOKEN") or merged.get("CODEGURU_AUTH_TOKEN")
    if token:
        # Some upstream paths still look for ANTHROPIC_API_KEY.
        env.setdefault("ANTHROPIC_AUTH_TOKEN", token)
        env.setdefault("ANTHROPIC_API_KEY", token)

    # Dev tree (0.0.1-beta) is blocked by upstream remote min-version checks.
    # Web-spawned child only — keeps terminal behavior unchanged.
    env.setdefault("NODE_ENV", "test")

    return env
