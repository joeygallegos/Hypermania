const el = (id) => document.getElementById(id);
const preferences = window.hypermaniaPreferences;
let activeModel = "";
let activeModelInfo = null;

function setNotice(text, isError = false) {
  const notice = el("settingsNotice");
  notice.textContent = text;
  notice.classList.toggle("warn", isError);
}

function isGptOssModel(modelName, info) {
  const family = String(info?.details?.family || "");
  return /gpt[- ]?oss/i.test(modelName) || /gpt[- ]?oss/i.test(family);
}

function supportsVision(info, modelName = "") {
  return (Array.isArray(info?.capabilities) && info.capabilities.includes("vision")) || /vision|vl|llava|gemma3/i.test(modelName);
}

function renderThinkOptions() {
  const select = el("thinkMode");
  const gptOss = isGptOssModel(activeModel, activeModelInfo);
  const options = gptOss
    ? [["auto", "Auto"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]
    : [["auto", "Auto"], ["off", "Off"], ["on", "On"]];
  const saved = preferences.getThinkMode();

  select.replaceChildren();
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  select.value = options.some(([value]) => value === saved) ? saved : (gptOss ? "medium" : "auto");
  preferences.setThinkMode(select.value);
  el("thinkHint").textContent = gptOss
    ? "GPT-OSS uses Low, Medium, or High. Auto maps to Medium here."
    : "Auto lets the model decide. Off and On are best for Qwen-style models.";
}

async function fetchModelInfo(model) {
  const response = await fetch("/api/ollama/show", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, verbose: false }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadModels() {
  setNotice("Refreshing models…");
  try {
    const response = await fetch("/api/ollama/tags", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const models = (await response.json()).models?.map((model) => model.name) || [];
    const fallback = models.find((model) => /vision|llava|gemma3/i.test(model)) || models[0] || "";
    const saved = preferences.getModel();
    activeModel = models.includes(saved) ? saved : fallback;
    preferences.setModel(activeModel);
    activeModelInfo = activeModel ? await fetchModelInfo(activeModel).catch(() => null) : null;
    const capability = activeModel ? (supportsVision(activeModelInfo, activeModel) ? "vision" : "text") : "no installed models";
    el("activeModel").textContent = activeModel ? `${activeModel} · ${capability}` : "No model selected";
    renderThinkOptions();
    setNotice(models.length ? "Models refreshed." : "Ollama is running, but no models are installed.");
  } catch (error) {
    el("activeModel").textContent = "Could not load models";
    renderThinkOptions();
    setNotice(`Could not load models: ${error.message}`, true);
  }
}

async function loadOllamaConfig() {
  try {
    const response = await fetch("/api/ollama/config", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    el("ollamaBase").value = data.ollamaBase || "";
    el("ollamaBaseHint").textContent = "Current proxy target. Use a hostname or IP address with its Ollama port.";
  } catch {
    el("ollamaBaseHint").textContent = "Could not read the configured endpoint. Check that the Hypermania server is running.";
  }
}

async function saveOllamaConfig() {
  const button = el("saveOllamaBase");
  const endpoint = el("ollamaBase").value.trim();
  if (!endpoint) {
    setNotice("Enter an Ollama URL, such as http://192.168.1.50:11434.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Connecting…";
  try {
    const response = await fetch("/api/ollama/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollamaBase: endpoint }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(JSON.parse(body).error || `HTTP ${response.status}`);
    const data = JSON.parse(body);
    el("ollamaBase").value = data.ollamaBase;
    el("ollamaBaseHint").textContent = "Connected for this session. Set OLLAMA_BASE to keep it after a restart.";
    await loadModels();
  } catch (error) {
    el("ollamaBaseHint").textContent = "The previous Ollama instance is still active.";
    setNotice(`Could not change the Ollama instance: ${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = "Connect";
  }
}

const contextSelect = el("contextSize");
const savedContextSize = preferences.getContextSize();
contextSelect.value = [...contextSelect.options].some((option) => option.value === savedContextSize) ? savedContextSize : "8192";
preferences.setContextSize(contextSelect.value);
el("thinkMode").addEventListener("change", () => preferences.setThinkMode(el("thinkMode").value));
el("contextSize").addEventListener("change", () => preferences.setContextSize(el("contextSize").value));
el("refreshModels").addEventListener("click", loadModels);
el("saveOllamaBase").addEventListener("click", saveOllamaConfig);
Promise.all([loadOllamaConfig(), loadModels()]);
