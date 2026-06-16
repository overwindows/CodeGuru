"""CodeGuru Web API — chat UI backed by the CodeGuru CLI agent."""

from __future__ import annotations

import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from werkzeug.exceptions import BadRequest

from agent_runner import AgentRunnerError, cli_available, run_agent_stream
from codeguru import run_task
from config import public_status, web_fixed_response, web_use_agent

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _fixed_response_stream(text: str):
    yield _sse("delta", {"text": text})
    yield _sse("done", {"subtype": "success", "mode": "fixed"})


def _agent_event_stream(prompt: str, session_id: str | None):
    try:
        for event_type, payload in run_agent_stream(prompt, session_id=session_id):
            yield _sse(event_type, payload)
    except AgentRunnerError as exc:
        yield _sse("error", {"message": str(exc)})


@app.route("/")
def chat_page():
    return render_template("chat.html", status=public_status())


@app.route("/legacy")
def legacy_page():
    return render_template("legacy.html", status=public_status())


@app.route("/api/health")
def health():
    status = public_status()
    return jsonify({"ok": True, **status})


@app.route("/api/chat/stream", methods=["POST"])
def chat_stream():
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    session_id = body.get("session_id") or None

    if not message:
        raise BadRequest("message is required")

    use_agent = (
        body.get("mode", "agent") == "agent"
        and web_use_agent()
        and cli_available()
    )
    fixed = web_fixed_response()

    @stream_with_context
    def generate():
        if fixed and not use_agent:
            yield from _fixed_response_stream(fixed)
        elif use_agent:
            yield from _agent_event_stream(message, session_id)
        else:
            yield from _fixed_response_stream(fixed or "Done")

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
