(function () {
  const messagesEl = document.getElementById("messages");
  const emptyState = document.getElementById("empty-state");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("prompt-input");
  const sendButton = document.getElementById("send-button");

  let sessionId = null;
  let isStreaming = false;

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatText(text) {
    const escaped = escapeHtml(text);
    return escaped
      .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function createMessage(role, html) {
    if (emptyState) {
      emptyState.remove();
    }

    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}`;

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = role === "user" ? "You" : "CodeGuru";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerHTML = html;

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function setStreaming(active) {
    isStreaming = active;
    sendButton.disabled = active;
    input.disabled = active;
  }

  async function sendMessage(message) {
    if (!message.trim() || isStreaming) {
      return;
    }

    createMessage("user", escapeHtml(message).replace(/\n/g, "<br>"));
    input.value = "";
    setStreaming(true);

    const assistantBubble = createMessage("assistant", '<span class="hint">Thinking…</span>');
    let assistantText = "";

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          session_id: sessionId,
          mode: "agent",
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let eventName = "message";
          let dataLine = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataLine = line.slice(6);
            }
          }

          if (!dataLine) {
            continue;
          }

          let payload;
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }

          if (eventName === "session" && payload.session_id) {
            sessionId = payload.session_id;
          } else if (eventName === "delta" && payload.text) {
            assistantText += payload.text;
            assistantBubble.innerHTML = formatText(assistantText);
          } else if (eventName === "message" && payload.text) {
            assistantText = payload.text;
            assistantBubble.innerHTML = formatText(assistantText);
          } else if (eventName === "tool_start" && payload.name) {
            const chip = document.createElement("span");
            chip.className = "tool-chip";
            chip.textContent = `Running ${payload.name}…`;
            assistantBubble.appendChild(chip);
          } else if (eventName === "tool_summary" && payload.text) {
            assistantText += `\n\n${payload.text}`;
            assistantBubble.innerHTML = formatText(assistantText);
          } else if (eventName === "error") {
            if (!assistantText.trim()) {
              assistantBubble.innerHTML = `<span class="error-text">${escapeHtml(payload.message || "Unknown error")}</span>`;
            }
          } else if (eventName === "done") {
            if (payload.session_id && !payload.is_error) {
              sessionId = payload.session_id;
            }
            if (payload.is_error && !assistantText.trim()) {
              assistantBubble.innerHTML = `<span class="error-text">${escapeHtml(payload.subtype || "Request failed")}</span>`;
            }
          }
        }

        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      if (!assistantText) {
        assistantBubble.innerHTML = '<span class="hint">Done.</span>';
      }
    } catch (error) {
      assistantBubble.innerHTML = `<span class="error-text">${escapeHtml(error.message || String(error))}</span>`;
    } finally {
      setStreaming(false);
      input.focus();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input.value);
    }
  });
})();
