(function () {
  const STORAGE_KEY = "codeguru_web_session_id";
  const messagesEl = document.getElementById("messages");
  const emptyState = document.getElementById("empty-state");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("prompt-input");
  const sendButton = document.getElementById("send-button");
  const newChatButton = document.getElementById("new-chat-button");

  let sessionId = localStorage.getItem(STORAGE_KEY);
  let isStreaming = false;

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatInline(text) {
    let html = escapeHtml(text);
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_, label, url) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    return html;
  }

  function renderMarkdownBlock(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let inUl = false;
    let inOl = false;

    function closeLists() {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
    }

    for (const line of lines) {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      const bullet = /^(\s*)[-*]\s+(.+)$/.exec(line);
      const ordered = /^(\s*)\d+\.\s+(.+)$/.exec(line);

      if (heading) {
        closeLists();
        const level = heading[1].length;
        html.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      } else if (bullet) {
        if (!inUl) {
          closeLists();
          html.push("<ul>");
          inUl = true;
        }
        html.push(`<li>${formatInline(bullet[2])}</li>`);
      } else if (ordered) {
        if (!inOl) {
          closeLists();
          html.push("<ol>");
          inOl = true;
        }
        html.push(`<li>${formatInline(ordered[2])}</li>`);
      } else if (line.trim() === "") {
        closeLists();
      } else {
        closeLists();
        html.push(`<p>${formatInline(line)}</p>`);
      }
    }

    closeLists();
    return html.join("");
  }

  function renderMarkdown(text) {
    if (!text) {
      return "";
    }

    const segments = [];
    const fence = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = fence.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: "code", lang: match[1], content: match[2].trimEnd() });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ type: "text", content: text.slice(lastIndex) });
    }

    if (segments.length === 0) {
      return renderMarkdownBlock(text);
    }

    return segments
      .map((segment) => {
        if (segment.type === "code") {
          const lang = segment.lang
            ? ` class="language-${escapeHtml(segment.lang)}"`
            : "";
          return `<pre><code${lang}>${escapeHtml(segment.content)}</code></pre>`;
        }
        return renderMarkdownBlock(segment.content);
      })
      .join("");
  }

  function clearMessages() {
    messagesEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.id = "empty-state";
    empty.innerHTML =
      "<h3>What would you like to build or fix?</h3>" +
      "<p>Ask CodeGuru to explore the codebase, implement features, run tests, or review changes.</p>";
    messagesEl.appendChild(empty);
  }

  function createMessage(role, html, options = {}) {
    const empty = document.getElementById("empty-state");
    if (empty) {
      empty.remove();
    }

    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}`;

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = role === "user" ? "You" : "CodeGuru";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (options.markdown) {
      bubble.classList.add("md");
    }
    bubble.innerHTML = html;

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function renderHistory(messages) {
    clearMessages();
    if (!messages || messages.length === 0) {
      return;
    }
    for (const msg of messages) {
      const role = msg.role === "user" ? "user" : "assistant";
      const isAssistant = role === "assistant";
      const html = isAssistant
        ? renderMarkdown(msg.content || "")
        : escapeHtml(msg.content || "").replace(/\n/g, "<br>");
      createMessage(role, html, { markdown: isAssistant });
    }
  }

  function setSessionId(id) {
    sessionId = id;
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function setStreaming(active) {
    isStreaming = active;
    sendButton.disabled = active;
    input.disabled = active;
    if (newChatButton) {
      newChatButton.disabled = active;
    }
  }

  async function loadHistory() {
    if (!sessionId) {
      return;
    }
    try {
      const response = await fetch(
        `/api/chat/history?session_id=${encodeURIComponent(sessionId)}`
      );
      if (response.status === 404) {
        setSessionId(null);
        return;
      }
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data.session_id) {
        setSessionId(data.session_id);
      }
      renderHistory(data.messages || []);
      return data;
    } catch {
      // ignore — start fresh
    }
  }

  async function startNewChat() {
    if (isStreaming) {
      return;
    }
    try {
      const response = await fetch("/api/chat/session", { method: "POST" });
      const data = await response.json();
      setSessionId(data.session_id);
      clearMessages();
    } catch {
      setSessionId(null);
      clearMessages();
    }
    input.focus();
  }

  async function sendMessage(message) {
    if (!message.trim() || isStreaming) {
      return;
    }

    createMessage("user", escapeHtml(message).replace(/\n/g, "<br>"));
    input.value = "";
    setStreaming(true);

    const assistantBubble = createMessage(
      "assistant",
      '<span class="hint">Thinking…</span>'
    );
    let assistantText = "";

    function renderAssistantBubble() {
      assistantBubble.classList.add("md");
      assistantBubble.innerHTML = renderMarkdown(assistantText);
    }

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          session_id: sessionId,
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
            setSessionId(payload.session_id);
          } else if (eventName === "delta" && payload.text) {
            assistantText += payload.text;
            renderAssistantBubble();
          } else if (eventName === "message" && payload.text) {
            assistantText += payload.text;
            renderAssistantBubble();
          } else if (eventName === "tool_start" && payload.name) {
            const chip = document.createElement("span");
            chip.className = "tool-chip";
            chip.textContent = `Running ${payload.name}…`;
            assistantBubble.appendChild(chip);
          } else if (eventName === "tool_summary" && payload.text) {
            assistantText += `\n\n${payload.text}`;
            renderAssistantBubble();
          } else if (eventName === "status" && payload.status) {
            assistantBubble.innerHTML =
              `<span class="hint">${escapeHtml(payload.status)}</span>` +
              (assistantText ? renderMarkdown(assistantText) : "");
            if (assistantText) {
              assistantBubble.classList.add("md");
            }
          } else if (eventName === "error") {
            if (!assistantText.trim()) {
              assistantBubble.innerHTML = `<span class="error-text">${escapeHtml(payload.message || "Unknown error")}</span>`;
            }
          } else if (eventName === "done") {
            if (payload.session_id && !payload.is_error) {
              setSessionId(payload.session_id);
            }
            if (payload.is_error && !assistantText.trim()) {
              assistantBubble.innerHTML = `<span class="error-text">${escapeHtml(payload.subtype || "Request failed")}</span>`;
            }
            if (payload.mode === "agent" && !payload.is_error) {
              void loadHistory();
            }
          }
        }

        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      if (!assistantText.trim()) {
        assistantBubble.innerHTML =
          '<span class="error-text">No response from the agent. Try again or start a new chat.</span>';
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

  if (newChatButton) {
    newChatButton.addEventListener("click", () => {
      void startNewChat();
    });
  }

  void loadHistory();
})();
