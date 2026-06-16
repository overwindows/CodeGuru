"""Lightweight LLM client for legacy quick tasks and chat fallback."""

from __future__ import annotations

from openai import OpenAI

from config import llm_config

_LLM_FALLBACK_SYSTEM = (
    "You are Chen's official CLI assistant (CodeGuru web fallback). "
    "The full terminal agent is unavailable in this mode — you cannot run "
    "bash, edit files, or use tools. Answer from context only."
)


def _client() -> OpenAI:
    cfg = llm_config()
    api_key = cfg.get("api_key")
    if not api_key:
        raise RuntimeError(
            "No API key configured. Set CODEGURU_AUTH_TOKEN in "
            "~/.codeguru/settings.json."
        )
    base_url = cfg.get("base_url")
    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url.rstrip("/")
    return OpenAI(**kwargs)


def complete(system_prompt: str, user_prompt: str, *, max_tokens: int = 2048) -> str:
    cfg = llm_config()
    model = cfg.get("model") or "MiniMax-M2.7"
    response = _client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
        max_tokens=max_tokens,
    )
    content = response.choices[0].message.content
    return content or ""


def stream_chat(system_prompt: str, user_prompt: str):
    yield from stream_chat_messages(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )


def stream_chat_messages(messages: list[dict[str, str]]):
    cfg = llm_config()
    model = cfg.get("model") or "MiniMax-M2.7"
    stream = _client().chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
        max_tokens=4096,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


def build_web_chat_messages(
    history: list[dict[str, str]],
    *,
    system_prompt: str | None = None,
) -> list[dict[str, str]]:
    """Build OpenAI messages from stored web session history."""
    system = system_prompt or _LLM_FALLBACK_SYSTEM
    out: list[dict[str, str]] = [{"role": "system", "content": system}]
    for msg in history:
        role = msg.get("role")
        content = msg.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append({"role": role, "content": content})
    return out
