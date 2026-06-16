"""Lightweight LLM client for legacy quick tasks and chat fallback."""

from __future__ import annotations

from openai import OpenAI

from config import llm_config


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
    cfg = llm_config()
    model = cfg.get("model") or "MiniMax-M2.7"
    stream = _client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=4096,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
