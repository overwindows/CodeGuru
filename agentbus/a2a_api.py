#!/usr/bin/env python3
"""a2a_api.py — shared A2A (Agent2Agent v1.0) wire-format helpers.

Used by BOTH the local agentbus server (server.py) and the Azure Functions
hosting (func_app/) so the ask-chen agent answers with an identical A2A wire
shape no matter where it runs. Pure functions — no server state, no HTTP, so
the same builders work in a threaded daemon and in a stateless function.

Dispatch model: a single request router maps raw method+path+body to one of
the A2A operations. The local bus runs it while also keeping its async task
table; the Function runs it synchronously and returns the final Task.
"""
from __future__ import annotations

import json, time, uuid


def json_dumps(obj) -> str:
    """UTF-8-safe JSON serialization shared by HTTP responders."""
    return json.dumps(obj, ensure_ascii=False)


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id() -> str:
    return uuid.uuid4().hex


def check_auth(token: str | None, expected: str | None) -> tuple[bool, int, dict]:
    """Validate a request against the configured token.

    Returns (ok, status, error_body):
    - (False, 501, {...}) if expected is None (not configured).
    - (False, 401, {...}) if expected set but token missing/wrong.
    - (True, 200, None) on success.
    Mirrors A2A auth semantics: 501 unconfigured, 401 auth-failure.
    """
    if not expected:
        return False, 501, {"error": "Ask-Chen not configured on server"}
    if token and token == expected:
        return True, 200, None
    return False, 401, {"error": "unauthorized"}


def extract_token(auth_header: str) -> str:
    auth = auth_header or ""
    return auth[7:].strip() if auth.lower().startswith("bearer ") else ""


def extract_question(message: dict, body: dict) -> str:
    """Pull the question text from an A2A message, or a legacy top-level
    'question' field for convenience."""
    if isinstance(message, dict):
        for part in message.get("parts") or []:
            if isinstance(part, dict) and part.get("text"):
                return str(part["text"]).strip()
    q = body.get("question") if isinstance(body, dict) else None
    return str(q).strip() if isinstance(q, str) else ""


def answer_to_task(result: dict, question: str, caller: str,
                   task_id: str | None = None) -> dict:
    """Map an ask_chen.answer() result to an A2A Task object (COMPLETED /
    INPUT_REQUIRED / FAILED). `task_id` defaults to a fresh uuid."""
    tid = task_id or new_id()
    error = result.get("error")
    needs_human = bool(result.get("needs_human"))
    if error:
        state = "TASK_STATE_FAILED"
    elif needs_human:
        state = "TASK_STATE_INPUT_REQUIRED"
    else:
        state = "TASK_STATE_COMPLETED"
    task = {
        "id": tid,
        "status": {"state": state, "timestamp": now()},
        "metadata": {"question": question, "caller": caller or ""},
    }
    answer = result.get("answer")
    if answer:
        task["artifacts"] = [{
            "artifactId": f"{tid}-answer",
            "name": "answer",
            "parts": [{"text": answer}],
            "metadata": {
                "sources": result.get("sources") or [],
                "confidence": result.get("confidence"),
                "needs_human": needs_human,
            },
        }]
    return task


def stored_entry_to_task(e: dict) -> dict:
    """Map a persisted ask-chen answer entry (snake_case, async lifecycle) to
    an A2A Task. Used by the local bus where a background worker fills the
    entry in: pending/working become SUBMITTED/WORKING, then COMPLETED /
    INPUT_REQUIRED / FAILED."""
    state = {
        "pending": "TASK_STATE_SUBMITTED",
        "working": "TASK_STATE_WORKING",
        "done": ("TASK_STATE_INPUT_REQUIRED" if e.get("needs_human")
                 else "TASK_STATE_COMPLETED"),
        "error": "TASK_STATE_FAILED",
    }.get(e.get("status"), "TASK_STATE_SUBMITTED")
    task = {"id": e["id"],
            "status": {"state": state, "timestamp": e.get("ts", now())},
            "metadata": {"question": e.get("question"),
                         "caller": e.get("caller") or ""}}
    if e.get("answer"):
        task["artifacts"] = [{
            "artifactId": f"{e['id']}-answer",
            "name": "answer",
            "parts": [{"text": e["answer"]}],
            "metadata": {
                "sources": e.get("sources") or [],
                "confidence": e.get("confidence"),
                "needs_human": bool(e.get("needs_human")),
            },
        }]
    return task


def agent_card(base_url: str) -> dict:
    """The A2A Agent Card (RFC 3.2) advertising the ask-chen agent."""
    return {
        "name": "ask-chen",
        "description": ("Answers colleagues' agents' questions grounded in "
                        "Chen Wu's knowledge base."),
        "version": "1.0.0",
        "url": base_url,
        "provider": {"organization": "Chen Wu"},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
            "stateTransitionHistory": False,
        },
        "securitySchemes": [{
            "type": "apiKey", "name": "apikey", "in": "header",
            "keyName": "Authorization",
            "description": "Shared Bearer token for the ask-chen agent",
        }],
        "securityRequirements": [{"securitySchemeName": "apikey"}],
        "skills": [{
            "id": "kb-qa",
            "name": "Knowledge Base Q&A",
            "description": ("Answer questions grounded in Chen's knowledge "
                            "base; flags needs_human when the KB is silent."),
            "tags": ["kb", "qa", "career", "ml"],
            "inputModes": ["text/plain"],
            "outputModes": ["text/plain"],
        }],
    }
