#!/usr/bin/env node
// mcp-server.cjs — expose the agent-bus SERVICE to CodeGuru as MCP "tools".
//
// Any CodeGuru session that has this server wired as an MCP server can send,
// receive, and coordinate with other sessions using native tool calls, instead
// of each session writing raw Python/HTTP.
//
// The MCP server is a THIN BRIDGE: it has no state of its own. Every tool call
// is forwarded over HTTP to the running agent-bus service (server.py). Start
// the service first:
//
//     python server.py --port 8765 --state-dir "<OneDrive>\\.codeguru-agent-bus"
//
// Wire into ~/.codeguru.json mcpServers (matches the ai-coder-tools pattern):
//
//     "agentbus": { "command": "node", "args": ["Q:\\CodeGuru\\agentbus\\mcp-server.cjs"] }
//
// The agent "name" identifying this CodeGuru session is passed by the caller as
// the FIRST argument to every tool (e.g. agent_send(name, to, payload)). If every
// CodeGuru window uses a distinct name, they become coordinated peers.
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const PORT = process.env.AGENT_BUS_PORT || 8765;
const BASE = process.env.AGENT_BUS_BASE || "http://127.0.0.1";
const ROOT = `${BASE}:${PORT}`;

// --------------------------------------------------------------------------
// Tiny HTTP helper (Node 18+ has global fetch; fall back to http if absent).
// --------------------------------------------------------------------------
async function post(path, body, timeout = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${ROOT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function get(path, timeout = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${ROOT}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// --------------------------------------------------------------------------
// Tool handlers
// --------------------------------------------------------------------------
async function handleToolCall(name, args) {
  // `name` (the session/agent identity) is mandatory for every routed action.
  switch (name) {
    case "agent_alive":
      return text(JSON.stringify(await get("/health")));

    case "agent_agents":
      return text(JSON.stringify(await get("/agents")));

    case "agent_deregister": {
      const { name: who } = args;
      requireArgs({ name: who });
      const r = await post("/deregister", { name: who });
      return text(JSON.stringify({ removed: r.removed }));
    }

    // -- messaging -------------------------------------------------------
    case "agent_send": {
      const { name: who, to, payload, subject = "" } = args;
      requireArgs({ name: who, to, payload });
      const r = await post("/send", { from: who, to, payload, subject });
      return text(`sent message id=${r.id} to "${to}"`);
    }
    case "agent_recv": {
      const { name: who } = args;
      requireArgs({ name: who });
      const r = await get(`/recv?name=${encodeURIComponent(who)}&clear=1`);
      return text(JSON.stringify(r.messages || []));
    }
    case "agent_wait": {
      const { name: who, timeout = 10 } = args;
      requireArgs({ name: who });
      // long-poll for up to `timeout` seconds for new mail (real-time push)
      const r = await get(
        `/poll?name=${encodeURIComponent(who)}&timeout=${Number(timeout)}`,
        Number(timeout) + 5
      );
      return text(JSON.stringify(r.messages || []));
    }

    // -- task queue ------------------------------------------------------
    case "agent_post_task": {
      const { name: who, task } = args;
      requireArgs({ name: who, task });
      const r = await post("/post-task", { from: who, payload: task });
      return text(`queued task id=${r.id}`);
    }
    case "agent_claim": {
      const { name: who } = args;
      requireArgs({ name: who });
      const r = await post("/claim", { from: who, worker: who });
      return r.claimed
        ? text(JSON.stringify({ claimed: true, task: r.task }))
        : text(JSON.stringify({ claimed: false, task: null }));
    }
    case "agent_task_done": {
      const { name: who, id, result } = args;
      requireArgs({ name: who, id });
      const r = await post("/task-done", { from: who, id, result });
      return text(JSON.stringify({ ok: r.ok }));
    }

    // -- shared state ----------------------------------------------------
    case "agent_set_state": {
      const { name: who, key, value } = args;
      requireArgs({ name: who, key, value });
      const r = await post("/state/set", { from: who, key, value });
      return text(`set state[${key}]`);
    }
    case "agent_get_state": {
      const { key } = args;
      requireArgs({ key });
      const r = await get(`/state/get?key=${encodeURIComponent(key)}`);
      return text(JSON.stringify(r.value));
    }

    // -- log -------------------------------------------------------------
    case "agent_log": {
      const { name: who, line } = args;
      requireArgs({ name: who, line });
      const r = await post("/log", { from: who, line });
      return text(`logged (line ${r.lines})`);
    }

    default:
      return text(`unknown tool: ${name}`);
  }
}

function requireArgs(obj) {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") {
      throw new Error(`${k} is required`);
    }
  }
}

function text(content) {
  return { content: [{ type: "text", text: content }] };
}

// --------------------------------------------------------------------------
// Wire up the MCP server over stdio (matches the ai-coder-tools servers).
// --------------------------------------------------------------------------
const TOOL_DEFS = [
  { name: "agent_alive", description: "Check the agent-bus service is up.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "agent_agents", description: "List every agent registered on the bus, with queued-mail count and liveness.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "agent_deregister", description: "Remove an agent from the bus by a name you specify (drops its inbox and waiters).", inputSchema: { type: "object", properties: { name: { type: "string", description: "agent name to remove" } }, required: ["name"] } },
  { name: "agent_send", description: "Send a JSON message to another agent's inbox.", inputSchema: { type: "object", properties: { name: { type: "string", description: "this session's agent name" }, to: { type: "string" }, payload: {}, subject: { type: "string" } }, required: ["name", "to", "payload"] } },
  { name: "agent_recv", description: "Return all pending messages in this agent's inbox (non-blocking, clears them).", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "agent_wait", description: "Block up to `timeout` seconds for new messages to this agent (server pushes in real time). Returns messages as they arrive.", inputSchema: { type: "object", properties: { name: { type: "string" }, timeout: { type: "number" } }, required: ["name"] } },
  { name: "agent_post_task", description: "Publish a unit of work to the shared task queue.", inputSchema: { type: "object", properties: { name: { type: "string" }, task: { type: "object" } }, required: ["name", "task"] } },
  { name: "agent_claim", description: "Atomically claim one open task (only one worker succeeds). Returns {claimed, task} or claimed:false.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "agent_task_done", description: "Mark a claimed task complete with an optional result.", inputSchema: { type: "object", properties: { name: { type: "string" }, id: { type: "string" }, result: {} }, required: ["name", "id"] } },
  { name: "agent_set_state", description: "Write a shared key/value (latest wins) visible to all agents.", inputSchema: { type: "object", properties: { name: { type: "string" }, key: { type: "string" }, value: {} }, required: ["name", "key", "value"] } },
  { name: "agent_get_state", description: "Read a shared value by key.", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "agent_log", description: "Append a line to the shared team log.", inputSchema: { type: "object", properties: { name: { type: "string" }, line: { type: "string" } }, required: ["name", "line"] } },
];

const server = new Server(
  { name: "agentbus", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handleToolCall(name, args || {});
  } catch (e) {
    return {
      content: [{ type: "text", text: `agentbus error: ${e.message}` }],
      isError: true,
    };
  }
});

server.onerror = (e) => console.error("[agentbus mcp]", e);

async function main() {
  try {
    const health = await get("/health", 3000);
    console.error(`[agentbus mcp] connected to service at ${ROOT} (agents=${health.agents})`);
  } catch (e) {
    console.error(`[agentbus mcp] WARNING: service not running at ${ROOT} — start server.py first. (${e.message})`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
