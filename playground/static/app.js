// Playground frontend logic.

const $ = (sel) => document.querySelector(sel);

const MAX_HISTORY_TURNS = 20;

const statusEl = $("#status");
const modelSelect = $("#model-select");
const chatLog = $("#chat-log");
const chatInput = $("#chat-input");
const chatSend = $("#chat-send");
const chatStop = $("#chat-stop");
const chatImage = $("#chat-image");
const imagePreviewRow = $("#image-preview-row");

const imgPrompt = $("#img-prompt");
const imgNeg = $("#img-neg");
const imgW = $("#img-w");
const imgH = $("#img-h");
const imgSteps = $("#img-steps");
const imgCfg = $("#img-cfg");
const imgSeed = $("#img-seed");
const imgGenerate = $("#img-generate");
const imgStatus = $("#img-status");
const imgResult = $("#img-result");
const imgDownload = $("#img-download");

const editImage = $("#edit-image");
const editPreviewRow = $("#edit-preview-row");
const editPrompt = $("#edit-prompt");
const editNeg = $("#edit-neg");
const editSteps = $("#edit-steps");
const editCfg = $("#edit-cfg");
const editSeed = $("#edit-seed");
const editGenerate = $("#edit-generate");
const editStatus = $("#edit-status");
const editResult = $("#edit-result");
const editDownload = $("#edit-download");

const aioImage = $("#aio-image");
const aioPreviewRow = $("#aio-preview-row");
const aioPrompt = $("#aio-prompt");
const aioNeg = $("#aio-neg");
const aioSteps = $("#aio-steps");
const aioCfg = $("#aio-cfg");
const aioSeed = $("#aio-seed");
const aioGenerate = $("#aio-generate");
const aioStatus = $("#aio-status");
const aioResult = $("#aio-result");
const aioDownload = $("#aio-download");

let pendingEditImage = null; // {file, dataUrl}
let pendingAioImage = null; // {file, dataUrl}

let chatHistory = [];
let activeChat = null;
let pendingImages = []; // [{file, dataUrl}]

// --- Mode switching ---------------------------------------------------------

const MODE_MAP = {
  gemma: "chat",
  "qwen-image": "image",
  "qwen-edit": "edit",
  "qwen-aio": "aio",
};

modelSelect.addEventListener("change", () => {
  const mode = modelSelect.value;
  document.querySelectorAll(".mode").forEach((m) => m.classList.remove("active"));
  const target = MODE_MAP[mode] || "chat";
  $(`#mode-${target}`).classList.add("active");
});

// --- Health -----------------------------------------------------------------

let healthTimer = null;

async function refreshHealth() {
  try {
    const r = await fetch("/api/health");
    const h = await r.json();
    const g = h.gemma.loaded;
    const q = h.qwen_image.loaded;
    const e = h.qwen_edit.loaded;
    const a = h.qwen_aio.loaded;
    if (g && q && e && a) {
      statusEl.textContent = `Ready — Gemma on ${h.gemma.device}, Qwen-Image on ${h.qwen_image.device}, Qwen-Edit on ${h.qwen_edit.device}, AIO on ${h.qwen_aio.device}`;
      statusEl.className = "status ok";
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
      }
    } else {
      const parts = [];
      if (!g) parts.push(`Gemma: ${h.gemma.error || "loading…"}`);
      if (!q) parts.push(`Qwen-Image: ${h.qwen_image.error || "loading…"}`);
      if (!e) parts.push(`Qwen-Edit: ${h.qwen_edit.error || "loading…"}`);
      if (!a) parts.push(`AIO: ${h.qwen_aio.error || "loading…"}`);
      statusEl.textContent = parts.join(" | ");
      statusEl.className = "status error";
    }
  } catch (e) {
    statusEl.textContent = `Server unreachable: ${e}`;
    statusEl.className = "status error";
  }
}

refreshHealth();
healthTimer = setInterval(refreshHealth, 5000);

// --- Chat -------------------------------------------------------------------

function appendMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function appendImageMessage(role, images, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  for (const dataUrl of images) {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.style.maxWidth = "200px";
    img.style.maxHeight = "200px";
    img.style.borderRadius = "6px";
    img.style.display = "block";
    img.style.marginBottom = "6px";
    div.appendChild(img);
  }
  if (text) {
    const span = document.createElement("span");
    span.textContent = text;
    div.appendChild(span);
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function unescapeSSE(s) {
  return s
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\");
}

function trimHistory() {
  const sys = chatHistory.find((m) => m.role === "system");
  const turns = chatHistory.filter((m) => m.role !== "system");
  const trimmed = turns.slice(-MAX_HISTORY_TURNS * 2);
  chatHistory = sys ? [sys, ...trimmed] : trimmed;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text && pendingImages.length === 0) return;
  if (activeChat) return;

  const images = pendingImages.slice();
  const dataUrls = images.map((i) => i.dataUrl);

  // Show user message with images inline.
  appendImageMessage("user", dataUrls, text);
  chatHistory.push({ role: "user", content: text });
  trimHistory();
  chatInput.value = "";
  clearPendingImages();

  const assistantEl = appendMessage("assistant", "");
  const textNode = document.createTextNode("");
  assistantEl.textContent = "";
  assistantEl.appendChild(textNode);

  chatSend.disabled = true;
  chatStop.disabled = false;

  const controller = new AbortController();
  activeChat = controller;

  let acc = "";
  let pendingFrame = 0;
  const flush = () => {
    textNode.nodeValue = acc;
    pendingFrame = 0;
    chatLog.scrollTop = chatLog.scrollHeight;
  };
  const scheduleFlush = () => {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(flush);
  };

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatHistory,
        max_new_tokens: parseInt($("#chat-maxtok").value, 10),
        temperature: parseFloat($("#chat-temp").value),
        top_p: parseFloat($("#chat-topp").value),
        top_k: parseInt($("#chat-topk").value, 10),
        do_sample: $("#chat-sample").checked,
        images: dataUrls,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      textNode.nodeValue = `[Error ${resp.status}] ${err}`;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          if (data.startsWith("[ERROR] ")) {
            acc += `\n[error] ${data.slice(8)}`;
            scheduleFlush();
            continue;
          }
          acc += unescapeSSE(data);
          scheduleFlush();
        }
      }
    }
    flush();
    chatHistory.push({ role: "assistant", content: acc });
  } catch (e) {
    if (e.name !== "AbortError") {
      textNode.nodeValue = (acc ? acc + "\n\n" : "") + `[error] ${e}`;
    }
  } finally {
    activeChat = null;
    chatSend.disabled = false;
    chatStop.disabled = true;
  }
}

chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

chatStop.addEventListener("click", () => {
  if (activeChat) activeChat.abort();
});

// --- Image upload -----------------------------------------------------------

function renderPreviews() {
  imagePreviewRow.innerHTML = "";
  if (pendingImages.length === 0) {
    imagePreviewRow.hidden = true;
    return;
  }
  imagePreviewRow.hidden = false;
  pendingImages.forEach((img, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "image-preview";
    const el = document.createElement("img");
    el.src = img.dataUrl;
    const rm = document.createElement("button");
    rm.className = "remove";
    rm.textContent = "×";
    rm.title = "Remove";
    rm.addEventListener("click", () => {
      pendingImages.splice(idx, 1);
      renderPreviews();
    });
    wrap.appendChild(el);
    wrap.appendChild(rm);
    imagePreviewRow.appendChild(wrap);
  });
}

function clearPendingImages() {
  pendingImages = [];
  renderPreviews();
  chatImage.value = "";
}

chatImage.addEventListener("change", () => {
  for (const file of chatImage.files) {
    const reader = new FileReader();
    reader.onload = () => {
      pendingImages.push({ file, dataUrl: reader.result });
      renderPreviews();
    };
    reader.readAsDataURL(file);
  }
});

// --- Image generation -------------------------------------------------------

function revokeBlobUrl(el) {
  if (el.src?.startsWith("blob:")) URL.revokeObjectURL(el.src);
  if (el.href?.startsWith("blob:")) URL.revokeObjectURL(el.href);
}

async function generateImage() {
  const prompt = imgPrompt.value.trim();
  if (!prompt) return;
  imgGenerate.disabled = true;
  imgStatus.textContent = "Generating… (this can take 30-60s)";
  revokeBlobUrl(imgResult);
  imgResult.removeAttribute("src");

  const body = {
    prompt,
    negative_prompt: imgNeg.value || " ",
    width: parseInt(imgW.value, 10),
    height: parseInt(imgH.value, 10),
    steps: parseInt(imgSteps.value, 10),
    guidance_scale: parseFloat(imgCfg.value),
  };
  const seedVal = imgSeed.value.trim();
  if (seedVal) body.seed = parseInt(seedVal, 10);

  try {
    const t0 = performance.now();
    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.text();
      imgStatus.textContent = `Error ${resp.status}: ${err}`;
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    imgResult.src = url;
    imgDownload.href = url;
    imgDownload.style.display = "inline";
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    imgStatus.textContent = `Done in ${dt}s`;
  } catch (e) {
    imgStatus.textContent = `Error: ${e}`;
  } finally {
    imgGenerate.disabled = false;
  }
}

imgGenerate.addEventListener("click", generateImage);

// --- Image edit -------------------------------------------------------------

function renderEditPreview() {
  editPreviewRow.innerHTML = "";
  if (!pendingEditImage) {
    editPreviewRow.hidden = true;
    return;
  }
  editPreviewRow.hidden = false;
  const wrap = document.createElement("div");
  wrap.className = "image-preview";
  const el = document.createElement("img");
  el.src = pendingEditImage.dataUrl;
  const rm = document.createElement("button");
  rm.className = "remove";
  rm.textContent = "×";
  rm.title = "Remove";
  rm.addEventListener("click", () => {
    pendingEditImage = null;
    renderEditPreview();
    editImage.value = "";
  });
  wrap.appendChild(el);
  wrap.appendChild(rm);
  editPreviewRow.appendChild(wrap);
}

editImage.addEventListener("change", () => {
  const file = editImage.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingEditImage = { file, dataUrl: reader.result };
    renderEditPreview();
  };
  reader.readAsDataURL(file);
});

async function generateEdit() {
  const prompt = editPrompt.value.trim();
  if (!prompt) {
    editStatus.textContent = "Please enter an edit prompt.";
    return;
  }
  if (!pendingEditImage) {
    editStatus.textContent = "Please attach a source image.";
    return;
  }
  editGenerate.disabled = true;
  editStatus.textContent = "Editing… (this can take 30-60s)";
  if (editResult.src?.startsWith("blob:")) URL.revokeObjectURL(editResult.src);
  if (editDownload.href?.startsWith("blob:")) URL.revokeObjectURL(editDownload.href);
  editResult.removeAttribute("src");

  const body = {
    prompt,
    image: pendingEditImage.dataUrl,
    negative_prompt: editNeg.value || " ",
    steps: parseInt(editSteps.value, 10),
    guidance_scale: parseFloat(editCfg.value),
  };
  const seedVal = editSeed.value.trim();
  if (seedVal) body.seed = parseInt(seedVal, 10);

  try {
    const t0 = performance.now();
    const resp = await fetch("/api/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.text();
      editStatus.textContent = `Error ${resp.status}: ${err}`;
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    editResult.src = url;
    editDownload.href = url;
    editDownload.style.display = "inline";
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    editStatus.textContent = `Done in ${dt}s`;
  } catch (e) {
    editStatus.textContent = `Error: ${e}`;
  } finally {
    editGenerate.disabled = false;
  }
}

editGenerate.addEventListener("click", generateEdit);

// --- Image edit AIO (NSFW) --------------------------------------------------

function renderAioPreview() {
  aioPreviewRow.innerHTML = "";
  if (!pendingAioImage) {
    aioPreviewRow.hidden = true;
    return;
  }
  aioPreviewRow.hidden = false;
  const wrap = document.createElement("div");
  wrap.className = "image-preview";
  const el = document.createElement("img");
  el.src = pendingAioImage.dataUrl;
  const rm = document.createElement("button");
  rm.className = "remove";
  rm.textContent = "×";
  rm.title = "Remove";
  rm.addEventListener("click", () => {
    pendingAioImage = null;
    renderAioPreview();
    aioImage.value = "";
  });
  wrap.appendChild(el);
  wrap.appendChild(rm);
  aioPreviewRow.appendChild(wrap);
}

aioImage.addEventListener("change", () => {
  const file = aioImage.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingAioImage = { file, dataUrl: reader.result };
    renderAioPreview();
  };
  reader.readAsDataURL(file);
});

async function generateAio() {
  const prompt = aioPrompt.value.trim();
  if (!prompt) {
    aioStatus.textContent = "Please enter an edit prompt.";
    return;
  }
  if (!pendingAioImage) {
    aioStatus.textContent = "Please attach a source image.";
    return;
  }
  aioGenerate.disabled = true;
  aioStatus.textContent = "Editing with AIO… (this can take 30-60s)";
  if (aioResult.src?.startsWith("blob:")) URL.revokeObjectURL(aioResult.src);
  if (aioDownload.href?.startsWith("blob:")) URL.revokeObjectURL(aioDownload.href);
  aioResult.removeAttribute("src");

  const body = {
    prompt,
    image: pendingAioImage.dataUrl,
    negative_prompt: aioNeg.value || " ",
    steps: parseInt(aioSteps.value, 10),
    guidance_scale: parseFloat(aioCfg.value),
  };
  const seedVal = aioSeed.value.trim();
  if (seedVal) body.seed = parseInt(seedVal, 10);

  try {
    const t0 = performance.now();
    const resp = await fetch("/api/edit-aio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.text();
      aioStatus.textContent = `Error ${resp.status}: ${err}`;
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    aioResult.src = url;
    aioDownload.href = url;
    aioDownload.style.display = "inline";
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    aioStatus.textContent = `Done in ${dt}s`;
  } catch (e) {
    aioStatus.textContent = `Error: ${e}`;
  } finally {
    aioGenerate.disabled = false;
  }
}

aioGenerate.addEventListener("click", generateAio);
