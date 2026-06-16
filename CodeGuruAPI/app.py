"""CodeGuru Web API — same agent as the CLI, via headless stream-json."""

from __future__ import annotations

import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from werkzeug.exceptions import BadRequest, NotFound

from agent_runner import AgentRunnerError, cli_available, run_agent_stream
from chat_sessions import (
    append_message,
    get_display_messages,
    get_display_tool_events,
    get_or_create_session,
    load_session,
    sync_messages_from_cli,
)
from codeguru import run_task
from config import (
    agent_cwd,
    llm_config,
    public_status,
    web_fixed_response,
    web_use_agent,
    web_use_llm_fallback,
)
from llm_client import build_web_chat_messages, stream_chat_messages

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _fixed_response_stream(text: str, session_id: str):
    yield _sse("session", {"session_id": session_id})
    yield _sse("delta", {"text": text})
    yield _sse("done", {"subtype": "success", "mode": "fixed", "session_id": session_id})


def _llm_chat_stream(user_message: str, session_id: str | None):
    """Fallback when the CLI binary is not available."""
    session = get_or_create_session(session_id)
    append_message(session, "user", user_message)
    yield _sse("session", {"session_id": session["id"]})
    yield _sse(
        "status",
        {"status": "CLI unavailable — using direct LLM (limited vs terminal agent)"},
    )

    try:
        api_messages = build_web_chat_messages(session["messages"])
        parts: list[str] = []
        for chunk in stream_chat_messages(api_messages):
            parts.append(chunk)
            yield _sse("delta", {"text": chunk})
        append_message(session, "assistant", "".join(parts))
        yield _sse(
            "done",
            {"subtype": "success", "mode": "llm", "session_id": session["id"]},
        )
    except Exception as exc:  # noqa: BLE001
        yield _sse("error", {"message": str(exc)})
        yield _sse(
            "done",
            {"subtype": "error", "is_error": True, "session_id": session["id"]},
        )


def _agent_event_stream(prompt: str, web_session_id: str):
    session = get_or_create_session(web_session_id)
    yield _sse("session", {"session_id": session["id"]})

    cli_session_id = session.get("cli_session_id")
    assistant_parts: list[str] = []
    cwd = str(agent_cwd())
    stream_error = False

    try:
        for event_type, payload in run_agent_stream(
            prompt,
            session_id=cli_session_id,
            cwd=agent_cwd(),
        ):
            if event_type == "session" and payload.get("session_id"):
                from chat_sessions import set_cli_session_id

                set_cli_session_id(session, payload["session_id"])
                cli_session_id = payload["session_id"]
            elif event_type == "delta" and payload.get("text"):
                assistant_parts.append(payload["text"])
            elif event_type == "message" and payload.get("text"):
                assistant_parts.append(payload["text"])
            elif event_type == "done":
                if payload.get("is_error"):
                    stream_error = True
                continue
            elif event_type == "error":
                stream_error = True
            elif event_type == "session":
                # CLI session id is tracked server-side only — do not forward
                # as "session" or the browser overwrites the web session id.
                continue
            yield _sse(event_type, payload)

        sync_messages_from_cli(session, cwd)
        if not session.get("messages") and assistant_parts:
            append_message(session, "user", prompt)
            append_message(session, "assistant", "".join(assistant_parts))

        yield _sse(
            "done",
            {
                "subtype": "error" if stream_error else "success",
                "is_error": stream_error,
                "mode": "agent",
                "session_id": session["id"],
                "cli_session_id": cli_session_id,
            },
        )
    except AgentRunnerError as exc:
        yield _sse("error", {"message": str(exc)})
        yield _sse(
            "done",
            {
                "subtype": "error",
                "is_error": True,
                "mode": "agent",
                "session_id": session["id"],
                "cli_session_id": cli_session_id,
            },
        )


@app.route("/")
def chat_page():
    return render_template("chat.html", status=public_status())


@app.route("/legacy")
def legacy_page():
    return render_template("legacy.html", status=public_status())


@app.route("/api/health")
def health():
    return jsonify({"ok": True, **public_status()})


@app.route("/api/chat/history")
def chat_history():
    session_id = request.args.get("session_id")
    if not session_id:
        raise BadRequest("session_id is required")

    session = load_session(session_id)
    if not session:
        raise NotFound("session not found")

    messages = get_display_messages(session)
    tool_events = get_display_tool_events(session)
    source = "cli" if session.get("cli_session_id") and messages else "web"

    return jsonify(
        {
            "session_id": session["id"],
            "cli_session_id": session.get("cli_session_id"),
            "messages": messages,
            "tool_events": tool_events,
            "source": source,
            "updated_at": session.get("updated_at"),
        }
    )


@app.route("/api/chat/session", methods=["POST"])
def chat_new_session():
    from chat_sessions import create_session

    session = create_session()
    return jsonify({"session_id": session["id"]})


@app.route("/api/chat/stream", methods=["POST"])
def chat_stream():
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    session_id = body.get("session_id") or None

    if not message:
        raise BadRequest("message is required")

    fixed = web_fixed_response()
    use_agent = web_use_agent() and cli_available()

    @stream_with_context
    def generate():
        session = get_or_create_session(session_id)
        sid = session["id"]

        if fixed is not None:
            append_message(session, "user", message)
            append_message(session, "assistant", fixed)
            yield from _fixed_response_stream(fixed, sid)
        elif use_agent:
            yield from _agent_event_stream(message, sid)
        elif web_use_llm_fallback() and llm_config().get("api_key"):
            yield from _llm_chat_stream(message, sid)
        else:
            yield _sse(
                "error",
                {
                    "message": (
                        "CodeGuru CLI not found and no API key configured. "
                        "Install Bun, run npm install in the repo, and set "
                        "CODEGURU_AUTH_TOKEN in ~/.codeguru/settings.json."
                    )
                },
            )
            yield _sse("done", {"subtype": "error", "is_error": True})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/legacy/task", methods=["POST"])
def legacy_task():
    body = request.get_json(silent=True) or {}
    task = body.get("task")
    code = (body.get("code") or "").strip()

    if not task:
        raise BadRequest("task is required")
    if not code:
        raise BadRequest("code is required")

    try:
        result = run_task(task, code)
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500

    return jsonify({"result": result, "task": task})


@app.route("/favicon.ico")
def favicon():
    icon = Path(app.root_path) / "static" / "favicon.ico"
    if icon.is_file():
        return app.send_static_file("favicon.ico")
    return ("", 204)


if __name__ == "__main__":
    host = os.environ.get("CODEGURU_WEB_HOST", "127.0.0.1")
    port = int(os.environ.get("CODEGURU_WEB_PORT", "8080"))
    debug = os.environ.get("CODEGURU_WEB_DEBUG", "1") == "1"
    app.run(host=host, port=port, debug=debug, threaded=True)
