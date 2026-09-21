const state = {
  requestSeq: 0,
  history: [],
  images: [],
  models: [],
  modelInfo: new Map(),
  contextSize: Number.parseInt(window.hypermaniaPreferences.getContextSize(), 10) || 8192,
  thinkMode: window.hypermaniaPreferences.getThinkMode(),
  assistantPre: null,
  assistantReasoningPre: null,
  assistantReasoningDetails: null,
  assistantPendingBubble: null,
  assistantWait: null,
  assistantWaitLabel: null,
  sendLabel: "",
  generationTimer: null,
  generationActive: false,
  generationLastChunkAt: 0,
  generationPingFailures: 0,
};

const el = (id) => document.getElementById(id);

function debugLog(event, details = {}) {
  const payload = {
    event,
    at: new Date().toISOString(),
    ...details,
  };

  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

function getContextLength() {
  const value = Number.parseInt(el("contextSize").value, 10);
  if (!Number.isFinite(value) || value < 2048) return undefined;
  return value;
}

function buildRequestBody(model, messages, thinkValue, stream) {
  const body = {
    model,
    messages,
    stream,
  };

  const options = {};
  const numCtx = getContextLength();
  if (numCtx !== undefined) {
    options.num_ctx = numCtx;
  }
  if (Object.keys(options).length) {
    body.options = options;
  }

  if (thinkValue !== undefined) {
    body.think = thinkValue;
  }

  return body;
}

function setStatus(text) {
  el("status").textContent = text;
}

function setBusy(isBusy, statusText = "") {
  const status = el("status");
  status.classList.toggle("loading", isBusy);
  if (statusText) {
    status.textContent = statusText;
  }

  const send = el("send");
  send.disabled = isBusy;
  send.textContent = isBusy ? "Waiting..." : state.sendLabel;
}

function clearError() {
  const box = el("errorBox");
  box.hidden = true;
  el("errorMessage").textContent = "";
  el("errorHint").textContent = "";
}

function showError(message, hint = "") {
  el("errorMessage").textContent = message;
  el("errorHint").textContent = hint;
  el("errorBox").hidden = false;
}

function scrollMessagesToBottom() {
  const messages = el("messages");
  messages.scrollTop = messages.scrollHeight;
}

function isSafeLink(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function appendInlineMarkdown(target, source) {
  const tokenPattern = /(`[^`]*`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^\s)]+\)|https?:\/\/[^\s<]+)/g;
  let cursor = 0;

  for (const match of source.matchAll(tokenPattern)) {
    target.append(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    let node;

    if (token.startsWith("`")) {
      node = document.createElement("code");
      node.textContent = token.slice(1, -1);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      node = document.createElement("strong");
      appendInlineMarkdown(node, token.slice(2, -2));
    } else if (token.startsWith("~~")) {
      node = document.createElement("s");
      appendInlineMarkdown(node, token.slice(2, -2));
    } else if (token.startsWith("*") || token.startsWith("_")) {
      node = document.createElement("em");
      appendInlineMarkdown(node, token.slice(1, -1));
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
      if (linkMatch && isSafeLink(linkMatch[2])) {
        node = document.createElement("a");
        node.href = linkMatch[2];
        node.target = "_blank";
        node.rel = "noreferrer noopener";
        node.textContent = linkMatch[1];
      }
    } else if (isSafeLink(token)) {
      node = document.createElement("a");
      node.href = token;
      node.target = "_blank";
      node.rel = "noreferrer noopener";
      node.textContent = token;
    }

    target.append(node || document.createTextNode(token));
    cursor = (match.index || 0) + token.length;
  }

  target.append(document.createTextNode(source.slice(cursor)));
}

function appendMarkdownParagraph(container, lines) {
  if (!lines.length) return;
  const paragraph = document.createElement("p");
  lines.forEach((line, index) => {
    if (index) paragraph.append(document.createElement("br"));
    appendInlineMarkdown(paragraph, line);
  });
  container.appendChild(paragraph);
}

function markdownTableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line) {
  const cells = markdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdown(target, source) {
  target.replaceChildren();
  target.classList.remove("is-streaming");
  if (!source) return;

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraphLines = [];
  const flushParagraph = () => {
    appendMarkdownParagraph(target, paragraphLines);
    paragraphLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      flushParagraph();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (fence[1].trim()) code.dataset.language = fence[1].trim();
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      target.appendChild(pre);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const node = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(node, heading[2]);
      target.appendChild(node);
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      target.appendChild(document.createElement("hr"));
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      flushParagraph();
      const headers = markdownTableCells(line);
      const tableWrap = document.createElement("div");
      tableWrap.className = "markdown-table-wrap";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      headers.forEach((header) => {
        const cell = document.createElement("th");
        appendInlineMarkdown(cell, header);
        headerRow.appendChild(cell);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const values = markdownTableCells(lines[index]);
        const row = document.createElement("tr");
        headers.forEach((_, cellIndex) => {
          const cell = document.createElement("td");
          appendInlineMarkdown(cell, values[cellIndex] || "");
          row.appendChild(cell);
        });
        tbody.appendChild(row);
        index += 1;
      }
      index -= 1;
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      target.appendChild(tableWrap);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      const blockquote = document.createElement("blockquote");
      const quoteLines = [quote[1]];
      while (index + 1 < lines.length && /^>\s?/.test(lines[index + 1])) {
        index += 1;
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
      }
      appendMarkdownParagraph(blockquote, quoteLines);
      target.appendChild(blockquote);
      continue;
    }

    const list = line.match(/^\s*((?:[-+*])|\d+[.)])\s+(.+)$/);
    if (list) {
      flushParagraph();
      const ordered = /^\d/.test(list[1]);
      const listNode = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const item = lines[index].match(/^\s*((?:[-+*])|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        const listItem = document.createElement("li");
        appendInlineMarkdown(listItem, item[2]);
        listNode.appendChild(listItem);
        index += 1;
      }
      index -= 1;
      target.appendChild(listNode);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraphLines.push(line);
  }
  flushParagraph();
}

function setAssistantAnswerText(target, content) {
  target.classList.add("is-streaming");
  target.textContent = content;
}

function createMessage(role, content, meta = "") {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const node = document.createElement("article");
  node.className = `message-bubble ${role}`;

  if (meta) {
    node.dataset.meta = meta;
  }

  const pre = document.createElement("pre");
  pre.textContent = content;

  node.appendChild(pre);
  row.appendChild(node);
  el("messages").appendChild(row);
  scrollMessagesToBottom();

  return { row, node, pre };
}

function createAssistantMessage(meta = "", context = "this request") {
  const reasoningRow = document.createElement("div");
  reasoningRow.className = "message-row assistant";

  const reasoningNode = document.createElement("article");
  reasoningNode.className = "message-bubble assistant reasoning-bubble";

  if (meta) {
    reasoningNode.dataset.meta = meta;
  }

  const pending = document.createElement("div");
  pending.className = "wait-indicator";
  const pendingLabel = document.createElement("span");
  pendingLabel.textContent = "Thinking…";
  pending.appendChild(pendingLabel);
  const cursor = document.createElement("span");
  cursor.className = "text-cursor Primer_Brand__TextCursorAnimation-module__TextCursorAnimation-cursor___1_9mQ";
  cursor.setAttribute("aria-hidden", "true");
  cursor.setAttribute("data-testid", "TextCursorAnimation-cursor");
  pending.appendChild(cursor);

  const reasoningDetails = document.createElement("details");
  reasoningDetails.className = "thinking-panel";

  const summary = document.createElement("summary");
  summary.textContent = `Reasoning for: ${context}`;

  const reasoningPre = document.createElement("pre");
  reasoningPre.className = "thinking-text";
  reasoningPre.textContent = "";

  reasoningDetails.appendChild(summary);
  reasoningDetails.appendChild(reasoningPre);
  reasoningNode.appendChild(reasoningDetails);
  reasoningRow.appendChild(reasoningNode);

  const answerRow = document.createElement("div");
  answerRow.className = "message-row assistant";

  const answerNode = document.createElement("article");
  answerNode.className = "message-bubble assistant final-answer-bubble is-pending";

  const answerPre = document.createElement("div");
  answerPre.className = "final-answer-text";
  answerPre.textContent = "";

  answerNode.appendChild(pending);
  answerNode.appendChild(answerPre);
  answerRow.appendChild(answerNode);

  el("messages").appendChild(reasoningRow);
  el("messages").appendChild(answerRow);
  scrollMessagesToBottom();

  return {
    reasoningRow,
    reasoningNode,
    reasoningPre,
    reasoningDetails,
    answerRow,
    answerNode,
    answerPre,
    pending,
    pendingLabel,
  };
}

function addMessage(role, content, meta = "") {
  return createMessage(role, content, meta);
}

function renderPreview() {
  const preview = el("preview");
  preview.innerHTML = "";

  if (!state.images.length) {
    preview.classList.remove("has-items");
    return;
  }

  preview.classList.add("has-items");
  state.images.forEach((image) => {
    const figure = document.createElement("figure");
    figure.innerHTML = `<img src="${image.dataUrl}" alt="${image.name}"><figcaption>${image.name}</figcaption>`;
    preview.appendChild(figure);
  });
}

function setDropLabel() {
  const count = state.images.length;
  el("dropLabel").textContent = count
    ? `${count} image${count === 1 ? "" : "s"} attached`
    : "Drop images here, click to browse, or paste in the message box";
  el("dropHint").textContent = count ? "Ready to send with your next prompt." : "PNG, JPG, WEBP, GIF";
  el("attachmentToggle").textContent = count
    ? `+ ${count} image${count === 1 ? "" : "s"} attached`
    : "+ Add images";
}

function setAttachmentTrayOpen(open) {
  const tray = el("attachmentTray");
  const toggle = el("attachmentToggle");
  tray.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
}

function isGptOssModel(modelName, info) {
  const family = String(info?.details?.family || "");
  return /gpt[- ]?oss/i.test(modelName) || /gpt[- ]?oss/i.test(family);
}

function renderThinkOptions(modelName, info) {
  const select = el("thinkMode");
  const gptOss = isGptOssModel(modelName, info);
  const selected = state.thinkMode || "auto";

  const options = gptOss
    ? [
        ["auto", "Auto"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
      ]
    : [
        ["auto", "Auto"],
        ["off", "Off"],
        ["on", "On"],
      ];

  select.innerHTML = "";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  const fallback = gptOss ? "medium" : "auto";
  select.value = options.some(([value]) => value === selected) ? selected : fallback;
  state.thinkMode = select.value;
  window.hypermaniaPreferences.setThinkMode(state.thinkMode);

  const hint = el("thinkHint");
  if (hint) {
    hint.textContent = gptOss
      ? "GPT-OSS uses Low, Medium, or High. Auto maps to Medium here."
      : "Auto lets the model decide. Off and On are best for Qwen-style models.";
  }
}

function getThinkPayload(modelName, info) {
  const mode = state.thinkMode;
  if (isGptOssModel(modelName, info)) {
    if (mode === "low" || mode === "medium" || mode === "high") {
      return mode;
    }
    return "medium";
  }

  if (mode === "off") return false;
  if (mode === "on") return true;
  return undefined;
}

function summarizeThinkingContext(prompt, imageCount) {
  const pieces = [];
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (trimmed) {
    pieces.push(trimmed.length > 88 ? `${trimmed.slice(0, 85)}…` : trimmed);
  }
  if (imageCount) {
    pieces.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }
  return pieces.length ? pieces.join(" · ") : "this request";
}

function cleanThinkingText(text) {
  if (!text) return "";
  return String(text)
    .replace(/^<think>\s*/i, "")
    .replace(/\s*<\/think>\s*$/i, "")
    .trim();
}

function buildPolishMessages(messages, thinking, promptText) {
  return [
    {
      role: "system",
      content:
        "You are polishing a local model response for the user. Return only the final answer. Do not include reasoning, labels, or analysis. If the answer should be JSON, output valid JSON only.",
    },
    ...messages,
    {
      role: "assistant",
      content: `Hidden reasoning transcript:\n${cleanThinkingText(thinking)}`,
    },
    {
      role: "user",
      content:
        `Write the final answer only for this request. Keep it concise and polished.\n\nUser request:\n${promptText}`,
    },
  ];
}

async function polishFinalAnswer(model, messages, thinking, promptText) {
  const polishMessages = buildPolishMessages(messages, thinking, promptText);
  debugLog("polish_start", {
    requestId: state.activeRequestId,
    promptChars: promptText.length,
    thinkingChars: cleanThinkingText(thinking).length,
  });

  const result = await fetchChatOnce(model, polishMessages, false);
  debugLog("polish_complete", {
    requestId: state.activeRequestId,
    replyChars: result.content.length,
    thinkingChars: result.thinking.length,
  });
  return result;
}

function beginGenerationMonitor() {
  state.generationActive = true;
  state.generationLastChunkAt = Date.now();
  state.generationPingFailures = 0;

  if (state.generationTimer) {
    clearInterval(state.generationTimer);
  }

  state.generationTimer = setInterval(async () => {
    if (!state.generationActive) return;

    const idleMs = Date.now() - state.generationLastChunkAt;
    const idleSeconds = Math.max(1, Math.round(idleMs / 1000));

    if (idleMs >= 8000) {
      setBusy(true, `Still thinking… (${idleSeconds}s since last update)`);
      debugLog("generation_idle", {
        requestId: state.activeRequestId,
        idleSeconds,
      });
    }

    try {
      const res = await fetch("/api/ollama/tags", { cache: "no-store" });
      if (!state.generationActive) return;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      state.generationPingFailures = 0;
    } catch {
      if (!state.generationActive) return;
      state.generationPingFailures += 1;
      debugLog("ollama_ping_failed", {
        requestId: state.activeRequestId,
        idleSeconds,
        failures: state.generationPingFailures,
      });
      if (state.generationPingFailures >= 2) {
        setBusy(true, `Checking Ollama… no response yet (${idleSeconds}s idle)`);
      }
    }
  }, 5000);
}

function touchGeneration(phase) {
  state.generationLastChunkAt = Date.now();
  if (phase === "thinking") {
    setBusy(true, "Thinking…");
  } else if (phase === "answer") {
    setBusy(true, "Streaming answer…");
  }
}

function endGenerationMonitor(statusText = "Done.") {
  state.generationActive = false;
  if (state.generationTimer) {
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }
  setBusy(false, statusText);
}

function supportsVision(info, modelName = "") {
  const capabilities = info?.capabilities || [];
  if (Array.isArray(capabilities) && capabilities.includes("vision")) {
    return true;
  }
  return /vision|vl|llava|gemma3/i.test(modelName);
}

function formatCapabilities(info, modelName) {
  const capabilities = Array.isArray(info?.capabilities) ? info.capabilities : [];
  if (!capabilities.length) {
    return supportsVision(info, modelName) ? ["vision"] : ["text"];
  }
  return capabilities;
}

function renderModelMeta() {
  const container = el("modelMeta");
  container.innerHTML = "";

  const modelName = el("model").value;
  const info = state.modelInfo.get(modelName);
  const summary = document.createElement("div");
  summary.className = "model-meta-summary";

  if (!modelName) {
    summary.textContent = "No model selected";
  } else if (!info) {
    summary.textContent = `${modelName} · loading details…`;
  } else {
    const parts = [modelName];
    parts.push(supportsVision(info, modelName) ? "supports images" : "text only");

    if (info.details?.family && info.details.family !== modelName) {
      parts.push(info.details.family);
    }

    summary.textContent = parts.join(" · ");
  }

  container.appendChild(summary);

  if (state.images.length && !supportsVision(info, modelName)) {
    const note = document.createElement("div");
    note.className = "model-meta-note warn";
    note.textContent = "Images attached, but this model cannot use them.";
    container.appendChild(note);
  }
}

async function fetchModelInfo(model) {
  const res = await fetch("/api/ollama/show", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, verbose: false }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}

async function loadModels() {
  const select = el("model");
  select.innerHTML = "";
  state.modelInfo.clear();
  debugLog("load_models_start");

  try {
    const res = await fetch("/api/ollama/tags");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.models = (data.models || []).map((m) => m.name);

    const fallback = state.models.find((m) => /vision|llava|gemma3/i.test(m)) || state.models[0] || "llama3.2-vision";

    for (const name of state.models) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }

    if (!state.models.length) {
      const option = document.createElement("option");
      option.value = fallback;
      option.textContent = fallback;
      select.appendChild(option);
    }

    const savedModel = window.hypermaniaPreferences.getModel();
    select.value = state.models.includes(savedModel) ? savedModel : fallback;
    window.hypermaniaPreferences.setModel(select.value);

    await refreshModelInfo(select.value, true);
    renderThinkOptions(select.value, state.modelInfo.get(select.value));
    setStatus(state.models.length ? "Ollama is ready." : "Ollama is running, but no models are installed.");
    debugLog("load_models_success", {
      count: state.models.length,
      selected: select.value,
    });
    annotateOptionsInBackground();
  } catch (error) {
    setStatus(`Could not load models: ${error.message}`);
    debugLog("load_models_error", {
      message: error.message,
    });
    const fallback = "llama3.2-vision";
    const option = document.createElement("option");
    option.value = fallback;
    option.textContent = fallback;
    select.appendChild(option);
    select.value = fallback;
    renderThinkOptions(select.value, state.modelInfo.get(select.value));
    renderModelMeta();
  }
}

async function refreshModelInfo(model, immediate = false) {
  if (!model) return;
  debugLog("model_info_start", { model });

  try {
    const info = await fetchModelInfo(model);
    state.modelInfo.set(model, info);

    const option = [...el("model").options].find((candidate) => candidate.value === model);
    if (option) {
      const vision = supportsVision(info, model);
      option.textContent = vision ? `${model} (vision)` : `${model} (text)`;
    }
  } catch {
    // Keep fallback heuristics if the model details call fails.
    debugLog("model_info_error", { model });
  } finally {
    if (immediate) {
      renderModelMeta();
      renderThinkOptions(model, state.modelInfo.get(model));
    }
  }
}

function annotateOptionsInBackground() {
  for (const option of [...el("model").options]) {
    if (state.modelInfo.has(option.value)) continue;
    refreshModelInfo(option.value).then(() => {
      if (el("model").value === option.value) {
        renderModelMeta();
      }
    });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function ingestFiles(fileList, { append = false, pasted = false } = {}) {
  const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;

  const uploaded = [];
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    uploaded.push({
      name: file.name,
      dataUrl,
      base64: dataUrl.split(",")[1],
    });
  }

  state.images = append ? [...state.images, ...uploaded] : uploaded;
  renderPreview();
  setDropLabel();
  setAttachmentTrayOpen(true);
  renderModelMeta();
  if (pasted) {
    setStatus(`Added ${uploaded.length} pasted image${uploaded.length === 1 ? "" : "s"}.`);
  }
}

function extractErrorDetails(raw) {
  let current = raw;
  for (let i = 0; i < 4; i += 1) {
    if (typeof current !== "string") break;
    try {
      const parsed = JSON.parse(current);
      current = parsed.error ?? parsed.message ?? parsed;
    } catch {
      break;
    }
  }

  if (typeof current === "object" && current) {
    if (typeof current.message === "string") return current.message;
    if (typeof current.error === "string") return current.error;
  }

  return typeof current === "string" ? current : "Unexpected Ollama error";
}

function imageSupportHint(modelName) {
  const supported = [...state.modelInfo.entries()]
    .filter(([name, info]) => supportsVision(info, name))
    .map(([name]) => name);

  if (supported.length) {
    return `Try one of the vision-capable models already installed: ${supported.join(", ")}.`;
  }

  return `Install a vision model such as gemma3, llama4, qwen2.5-vl, or another multimodal Ollama model, then refresh the model list.`;
}

async function streamChat(model, messages, thinkValue) {
  const requestBody = buildRequestBody(model, messages, thinkValue, true);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(extractErrorDetails(body) || `HTTP ${res.status}`);
  }
  debugLog("stream_started", {
    requestId: state.activeRequestId,
    model,
    thinkValue: thinkValue === undefined ? "default" : String(thinkValue),
  });

  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json();
    return data.message?.content || "";
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let thinkingFull = "";
  let sawFirstChunk = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        let chunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          // ignore malformed partial chunks
          chunk = null;
        }
        if (chunk) {
          if (chunk.error) {
            throw new Error(extractErrorDetails(chunk.error));
          }
          if (chunk.message?.thinking) {
            if (state.assistantWaitLabel) {
              state.assistantWaitLabel.textContent = "Thinking…";
            }
            thinkingFull += chunk.message.thinking;
            if (state.assistantReasoningPre) {
              state.assistantReasoningPre.textContent = thinkingFull;
            }
            if (state.assistantReasoningDetails) {
              state.assistantReasoningDetails.open = false;
            }
            touchGeneration("thinking");
            if (!sawFirstChunk) {
              debugLog("stream_thinking_seen", {
                requestId: state.activeRequestId,
                chars: thinkingFull.length,
              });
            }
          }
          if (chunk.message?.content) {
            if (!sawFirstChunk && state.assistantWait) {
              state.assistantWait.remove();
              state.assistantWait = null;
              state.assistantWaitLabel = null;
              state.assistantPendingBubble?.classList.remove("is-pending");
            }
            sawFirstChunk = true;
            full += chunk.message.content;
            if (state.assistantPre) {
              setAssistantAnswerText(state.assistantPre, full);
            }
            touchGeneration("answer");
            if (!sawFirstChunk) {
              debugLog("stream_answer_seen", {
                requestId: state.activeRequestId,
                chars: full.length,
              });
            }
          }
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (state.assistantPre && !sawFirstChunk) {
      setAssistantAnswerText(state.assistantPre, "");
      scrollMessagesToBottom();
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    let chunk;
    try {
      chunk = JSON.parse(trailing);
    } catch {
      chunk = null;
    }

    if (chunk) {
      if (chunk.error) {
        throw new Error(extractErrorDetails(chunk.error));
      }
      if (chunk.message?.thinking) {
        if (state.assistantWaitLabel) {
          state.assistantWaitLabel.textContent = "Thinking…";
        }
        thinkingFull += chunk.message.thinking;
        if (state.assistantReasoningPre) {
          state.assistantReasoningPre.textContent = thinkingFull;
        }
        touchGeneration("thinking");
      }
      if (chunk.message?.content) {
        if (!sawFirstChunk && state.assistantWait) {
          state.assistantWait.remove();
          state.assistantWait = null;
          state.assistantWaitLabel = null;
          state.assistantPendingBubble?.classList.remove("is-pending");
        }
        sawFirstChunk = true;
        full += chunk.message.content;
        if (state.assistantPre) {
          setAssistantAnswerText(state.assistantPre, full);
        }
        touchGeneration("answer");
      }
    }
  }

  if (state.assistantWait) {
    state.assistantWait.remove();
    state.assistantWait = null;
    state.assistantWaitLabel = null;
  }

  state.assistantPendingBubble?.classList.remove("is-pending");

  if (state.assistantPre) {
    const cleanedThinking = cleanThinkingText(thinkingFull);
    if (full) {
      setAssistantAnswerText(state.assistantPre, full);
    } else if (cleanedThinking) {
      setAssistantAnswerText(state.assistantPre, "(Reasoning only; see the collapsed thoughts below.)");
    } else {
      setAssistantAnswerText(state.assistantPre, "(Model returned no visible answer.)");
    }
    scrollMessagesToBottom();
  }

  return { content: full, thinking: cleanThinkingText(thinkingFull) };
}

async function fetchChatOnce(model, messages, thinkValue) {
  const requestBody = buildRequestBody(model, messages, thinkValue, false);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(extractErrorDetails(body) || `HTTP ${res.status}`);
  }

  const data = await res.json();
  debugLog("fallback_response", {
    requestId: state.activeRequestId,
    contentChars: data.message?.content?.length || 0,
    thinkingChars: data.message?.thinking?.length || 0,
  });
  return {
    content: data.message?.content || "",
    thinking: data.message?.thinking || "",
  };
}

async function sendChat() {
  clearError();

  const prompt = el("prompt").value.trim();
  const model = el("model").value;
  const info = state.modelInfo.get(model);
  const hasImages = state.images.length > 0;
  const thinkValue = getThinkPayload(model, info);

  if (!prompt && !hasImages) return;

  if (hasImages && !supportsVision(info, model)) {
    const message = `The selected model, ${model}, does not support image input.`;
    const hint = imageSupportHint(model);
    showError(message, hint);
    setStatus("Choose a vision-capable model before sending images.");
    createMessage("assistant", message, "preflight check");
    return;
  }

  const userContent = prompt || "Describe the attached image.";
  const attachments = state.images.map((img) => img.base64);
  const requestId = ++state.requestSeq;
  state.activeRequestId = requestId;
  debugLog("send_start", {
    requestId,
    model,
    thinkMode: state.thinkMode,
    thinkValue: thinkValue === undefined ? "default" : String(thinkValue),
    numCtx: getContextLength() ?? "default",
    promptChars: userContent.length,
    imageCount: attachments.length,
  });

  addMessage(
    "user",
    hasImages ? `${userContent}\n\n[${state.images.length} image(s) attached]` : userContent
  );

  state.history.push({
    role: "user",
    content: userContent,
    images: attachments,
  });

  el("prompt").value = "";

  beginGenerationMonitor();
  setBusy(true, "Waiting for Ollama...");

  try {
    const assistant = createAssistantMessage(`model: ${model}`, summarizeThinkingContext(prompt, state.images.length));
    state.assistantPre = assistant.answerPre;
    state.assistantReasoningPre = assistant.reasoningPre;
    state.assistantReasoningDetails = assistant.reasoningDetails;
    state.assistantPendingBubble = assistant.answerNode;
    state.assistantWait = assistant.pending;
    state.assistantWaitLabel = assistant.pendingLabel;
    setAssistantAnswerText(state.assistantPre, "");

    let { content: reply, thinking } = await streamChat(model, state.history, thinkValue);
    if (!reply) {
      debugLog("stream_without_final_answer", {
        requestId,
        thinkingChars: thinking.length,
      });
      if (state.assistantWaitLabel) {
        state.assistantWaitLabel.textContent = thinking
          ? "Polishing final answer…"
          : "Retrying without streaming…";
      }
      if (cleanThinkingText(thinking)) {
        const polished = await polishFinalAnswer(model, state.history, thinking, userContent);
        reply = polished.content || reply;
        thinking = thinking || polished.thinking;
      } else {
        const fallback = await fetchChatOnce(model, state.history, false);
        reply = fallback.content || reply;
        thinking = thinking || fallback.thinking;
      }
    }
    state.history.push({ role: "assistant", content: reply, thinking });

    if (state.assistantReasoningPre) {
      state.assistantReasoningPre.textContent = cleanThinkingText(thinking) || "";
    }

    if (reply) {
      renderMarkdown(state.assistantPre, reply);
    } else {
      setAssistantAnswerText(state.assistantPre, cleanThinkingText(thinking)
        ? "(Reasoning only; open the collapsed thoughts below.)"
        : "(Model returned no visible answer.)");
    }

    debugLog("send_complete", {
      requestId,
      replyChars: reply.length,
      thinkingChars: thinking.length,
    });
    endGenerationMonitor("Done.");
    el("images").value = "";
    state.images = [];
    renderPreview();
    setDropLabel();
    setAttachmentTrayOpen(false);
    renderModelMeta();
  } catch (error) {
    const message = extractErrorDetails(error.message || String(error));
    const hint = message.toLowerCase().includes("multimodal")
      ? imageSupportHint(model)
      : "Try again after checking the selected model and Ollama server status.";

    showError(message, hint);
    createMessage("assistant", `Error: ${message}`, "request failed");
    debugLog("send_error", {
      requestId,
      message,
    });
    endGenerationMonitor(`Request failed: ${message}`);
    if (state.assistantPre) {
      setAssistantAnswerText(state.assistantPre, `Error: ${message}`);
    }
  } finally {
    endGenerationMonitor(el("status").textContent || "Done.");
    if (state.assistantReasoningDetails) {
      state.assistantReasoningDetails.open = false;
    }
    state.assistantPre = null;
    state.assistantReasoningPre = null;
    state.assistantReasoningDetails = null;
    state.assistantPendingBubble = null;
    state.assistantWait = null;
    state.assistantWaitLabel = null;
    state.activeRequestId = null;
  }
}

function attachFileHandling() {
  const input = el("images");
  const dropzone = el("dropzone");

  el("attachmentToggle").addEventListener("click", () => {
    setAttachmentTrayOpen(el("attachmentTray").hidden);
  });

  input.addEventListener("change", async (event) => {
    await ingestFiles(event.target.files || []);
  });

  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  const setDragState = (active) => dropzone.classList.toggle("dragging", active);
  dropzone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    setDragState(true);
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    setDragState(true);
  });
  dropzone.addEventListener("dragleave", (event) => {
    if (event.target === dropzone) setDragState(false);
  });
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    setDragState(false);
    await ingestFiles(event.dataTransfer?.files || []);
  });
}

el("send").addEventListener("click", sendChat);

el("model").addEventListener("change", () => {
  const model = el("model").value;
  window.hypermaniaPreferences.setModel(model);
  if (!state.modelInfo.has(model)) {
    refreshModelInfo(model, true);
  } else {
    renderModelMeta();
    renderThinkOptions(model, state.modelInfo.get(model));
  }
  clearError();
});

el("thinkMode").addEventListener("change", () => {
  state.thinkMode = el("thinkMode").value;
  window.hypermaniaPreferences.setThinkMode(state.thinkMode);
  clearError();
  debugLog("think_mode_changed", { thinkMode: state.thinkMode });
});

el("contextSize").addEventListener("change", () => {
  window.hypermaniaPreferences.setContextSize(el("contextSize").value);
  debugLog("context_size_changed", {
    numCtx: getContextLength() ?? "invalid",
  });
});

el("prompt").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;

  event.preventDefault();
  sendChat();
});

el("prompt").addEventListener("paste", (event) => {
  const clipboard = event.clipboardData;
  const imageFiles = Array.from(clipboard?.files || []).filter((file) => file.type.startsWith("image/"));
  const pastedImages = imageFiles.length
    ? imageFiles
    : Array.from(clipboard?.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);

  if (pastedImages.length) {
    event.preventDefault();
    ingestFiles(pastedImages, { append: true, pasted: true });
    return;
  }

  const text = event.clipboardData?.getData("text/plain");
  if (typeof text !== "string" || !text) return;

  event.preventDefault();
  const normalized = text.replace(/\r\n?/g, "\n");
  const target = el("prompt");
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.setRangeText(normalized, start, end, "end");
});

attachFileHandling();
el("errorBox").hidden = true;
clearError();
setDropLabel();
state.sendLabel = el("send").textContent;
const savedContextSize = window.hypermaniaPreferences.getContextSize();
const contextSelect = el("contextSize");
contextSelect.value = [...contextSelect.options].some((option) => option.value === savedContextSize) ? savedContextSize : "8192";
state.contextSize = Number.parseInt(contextSelect.value, 10);
window.hypermaniaPreferences.setContextSize(contextSelect.value);
loadModels();
debugLog("app_loaded");
