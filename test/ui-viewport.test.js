const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const settings = fs.readFileSync(path.join(__dirname, "..", "public", "settings.js"), "utf8");
const part = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end));

function harness() {
  const nodes = new Map();
  const el = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        value: "", style: {}, hidden: false, textContent: "", options: [], attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(option) { this.options.push(option); },
        set innerHTML(value) { this.options = []; this.value = ""; },
      });
    }
    return nodes.get(id);
  };
  const state = {
    models: [], modelReady: false, modelInfo: new Map(), modelInfoErrors: new Set(),
    modelInfoLoading: new Set(), images: [], pdfs: [], requestInProgress: false,
  };
  const preferences = {
    getModel: () => "installed-model", setModel() {},
    getThinkMode: () => "high", getContextSize: () => "16384", getKeepWorking: () => true,
  };
  const events = new Map();
  const context = vm.createContext({
    state, el, document: { createElement: () => ({}) },
    window: { innerHeight: 844, hypermaniaPreferences: preferences,
      addEventListener: (name, callback) => events.set(name, callback) },
    debugLog() {}, setStatus() {}, renderThinkOptions() {}, renderModelMeta() {},
    refreshModelInfo: async () => {}, annotateOptionsInBackground() {}, showError() {},
  });
  vm.runInContext(part(source, "function hasDraft()", "function confirmDraftDiscard("), context);
  return { context, state, el, preferences, events };
}

test("model discovery exposes failures, retains drafts, and recovers without a fictional model", async () => {
  const h = harness();
  h.el("prompt").value = "  Keep my draft exactly  ";
  h.state.pdfs = [{ name: "synthetic.pdf" }];
  const responses = [
    { ok: true, json: async () => ({ models: [] }) },
    { ok: false, status: 503 },
    { ok: true, json: async () => ({ models: [{ name: "installed-model" }] }) },
  ];
  h.context.fetch = async () => responses.shift();
  vm.runInContext(part(source, "function renderModelReadiness(", "async function refreshModelInfo("), h.context);
  await h.context.loadModels();
  assert.equal(h.state.modelReady, false);
  assert.equal(h.el("model").options.length, 0);
  assert.match(h.el("modelReadinessText").textContent, /No models installed/);
  assert.equal(h.el("send").disabled, true);
  await h.context.loadModels();
  assert.match(h.el("modelReadinessText").textContent, /Ollama unavailable/);
  assert.equal(h.el("retryModels").hidden, false);
  assert.equal(h.el("model").options.length, 0);
  await h.context.loadModels();
  assert.equal(h.state.modelReady, true);
  assert.equal(h.el("model").value, "installed-model");
  assert.equal(h.el("modelReadiness").hidden, true);
  assert.equal(h.el("send").disabled, false);
  assert.equal(h.el("prompt").value, "  Keep my draft exactly  ");
  assert.equal(h.state.pdfs.length, 1);
});

test("unready models cannot start a send even through the keyboard handler", async () => {
  const h = harness();
  h.el("prompt").value = "Keep this";
  vm.runInContext(part(source, "async function sendChat()", "function syncSettingsPreferences("), h.context);
  await h.context.sendChat();
  assert.equal(h.state.requestInProgress, false);
  assert.equal(h.el("prompt").value, "Keep this");
});

test("composer grows within the available height and can explicitly expand then collapse", () => {
  const h = harness();
  const prompt = h.el("prompt");
  prompt.scrollHeight = 42;
  h.context.resizeComposer();
  assert.equal(prompt.style.height, "44px");
  prompt.scrollHeight = 800;
  h.context.resizeComposer();
  assert.equal(prompt.style.height, "140px");
  h.state.composerExpanded = true;
  h.context.resizeComposer();
  assert.equal(prompt.style.height, "320px");
  assert.equal(h.el("expandComposer").attributes["aria-expanded"], "true");
  h.context.window.innerHeight = 390;
  h.context.resizeComposer();
  assert.equal(prompt.style.height, "148px");
  h.state.composerExpanded = false;
  prompt.scrollHeight = 42;
  h.context.resizeComposer();
  assert.equal(prompt.style.height, "44px");
});

test("new output preserves a reader's position until Latest is requested", () => {
  const h = harness();
  const messages = h.el("messages");
  Object.assign(messages, { scrollTop: 100, scrollHeight: 1200 });
  h.state.followOutput = false;
  vm.runInContext(part(source, "function scrollMessagesToBottom(", "function isSafeLink("), h.context);
  vm.runInContext(part(source, "function setAssistantAnswerText(", "function createMessage("), h.context);
  const answer = { classList: { add() {} }, textContent: "" };
  h.context.setAssistantAnswerText(answer, "Another streamed chunk");
  assert.equal(messages.scrollTop, 100);
  assert.equal(h.el("jumpToLatest").hidden, false);
  h.context.scrollMessagesToBottom(true);
  assert.equal(messages.scrollTop, 1200);
  assert.equal(h.el("jumpToLatest").hidden, true);
  messages.scrollHeight = 1500;
  h.context.setAssistantAnswerText(answer, "A later streamed chunk");
  assert.equal(messages.scrollTop, 1500);
});

test("system instruction remains stable across an active send's generation stages", () => {
  const h = harness();
  h.preferences.getSystemInstruction = () => "New instruction from Settings";
  h.context.getContextLength = () => 8192;
  h.context.toOllamaMessages = (_, instruction) => [{ role: "system", content: instruction }];
  h.context.buildDocumentMessages = ({ systemInstruction }) => [{ role: "system", content: systemInstruction }];
  vm.runInContext(part(source, "function buildRequestBody(", "function setStatus("), h.context);
  h.state.requestInProgress = true;
  for (const instruction of ["Original instruction", ""]) {
    h.state.activeSystemInstruction = instruction;
    for (const mode of ["current", "none"]) {
      const body = h.context.buildRequestBody("model", [], undefined, true, { mode });
      assert.equal(body.messages[0].content, instruction);
    }
  }
  h.state.requestInProgress = false;
  const next = h.context.buildRequestBody("model", [], undefined, true, { mode: "none" });
  assert.equal(next.messages[0].content, "New instruction from Settings");
});

test("chat navigation protection covers drafts, files, and active requests but not an idle saved chat", () => {
  const h = harness();
  vm.runInContext(part(source, 'window.addEventListener("beforeunload"', 'window.addEventListener("focus"'), h.context);
  const listener = h.events.get("beforeunload");
  const protectedState = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    listener(event);
    return event.prevented;
  };
  assert.equal(protectedState(), false);
  h.el("prompt").value = "Unsent";
  assert.equal(protectedState(), true);
  h.el("prompt").value = "";
  h.state.pdfs = [{}];
  assert.equal(protectedState(), true);
  h.state.pdfs = [];
  h.state.requestInProgress = true;
  assert.equal(protectedState(), true);
});

test("settings edits apply between sends without changing active controls", () => {
  const h = harness();
  h.el("contextSize").options = [{ value: "8192" }, { value: "16384" }];
  h.el("contextSize").value = "8192";
  h.state.requestInProgress = true;
  h.state.activeKeepWorking = false;
  vm.runInContext(part(source, "function syncSettingsPreferences()", "function initializeConversationUI()"), h.context);
  h.context.syncSettingsPreferences();
  assert.equal(h.state.settingsPending, true);
  assert.equal(h.el("contextSize").value, "8192");
  h.state.requestInProgress = false;
  h.context.syncSettingsPreferences();
  assert.equal(h.state.settingsPending, false);
  assert.equal(h.state.thinkMode, "high");
  assert.equal(h.state.contextSize, 16384);
  assert.equal(h.state.activeKeepWorking, false);
  assert.equal(h.el("keepWorking").checked, true);
});

test("system instruction shows dirty feedback and protects unsaved edits", () => {
  const h = harness();
  h.preferences.getSystemInstruction = () => "Saved instruction";
  h.context.preferences = h.preferences;
  vm.runInContext(part(settings, "function hasUnsavedInstruction()", "const contextSelect ="), h.context);
  vm.runInContext(part(settings, 'window.addEventListener("beforeunload"', 'el("thinkMode").addEventListener'), h.context);
  h.el("systemInstruction").value = "Saved instruction";
  h.context.renderInstructionSaveState();
  assert.equal(h.el("saveSystemInstruction").disabled, true);
  h.el("systemInstruction").value = "Edited instruction";
  h.context.renderInstructionSaveState();
  assert.equal(h.el("saveSystemInstruction").disabled, false);
  assert.equal(h.el("instructionSaveState").textContent, "Unsaved changes");
  const event = { preventDefault() { this.prevented = true; } };
  h.events.get("beforeunload")(event);
  assert.equal(event.prevented, true);
});

test("instruction acknowledgment preserves text typed while saving", async () => {
  const h = harness();
  let release;
  let saved = "Old instruction";
  h.preferences.setSystemInstruction = (value) => new Promise((resolve) => { release = () => { saved = value; resolve(true); }; });
  h.preferences.getSystemInstruction = () => saved;
  h.context.preferences = h.preferences;
  h.context.setNotice = () => {};
  vm.runInContext(part(settings, "async function saveSystemInstruction()", "const contextSelect ="), h.context);
  h.el("systemInstruction").value = "First instruction";
  const pending = h.context.saveSystemInstruction();
  h.el("systemInstruction").value = "Newer unsaved instruction";
  release();
  await pending;
  assert.equal(h.el("systemInstruction").value, "Newer unsaved instruction");
  assert.equal(h.el("instructionSaveState").textContent, "Unsaved changes");
});

test("loading a stored chat locks send and navigation until its context arrives", async () => {
  const h = harness();
  let release;
  const conversation = { id: "test", title: "Test", threadId: "thread", model: "model" };
  h.state.conversations = [conversation];
  h.context.window.hypermaniaStorage = { loadConversation: () => new Promise((resolve) => { release = resolve; }) };
  const busy = [];
  Object.assign(h.context, {
    confirmDraftDiscard: () => true, setBusy: (value) => busy.push(value), CHAT_SCHEMA_VERSION: 2,
    LEGACY_CHAT_SCHEMA_VERSION: 1, isValidHistoryMessage: () => true, isValidDocumentContext: () => true,
    isTraceId: () => true, resetDraft() {}, clearError() {}, updateActiveChatHeading() {},
    renderStoredConversation() {}, renderConversationList() {}, applyConversationModel() {},
  });
  vm.runInContext(part(source, "async function selectConversation(", "async function persistCurrentConversation()"), h.context);
  const pending = h.context.selectConversation("test", { focus: false });
  assert.equal(h.state.storageLoading, true);
  assert.equal(busy[0], true);
  vm.runInContext(part(source, "async function sendChat()", "function syncSettingsPreferences()"), h.context);
  await h.context.sendChat();
  assert.equal(h.state.requestInProgress, false);
  await h.context.selectConversation("other");
  release({ summary: conversation, schemaVersion: 2, history: [], documents: [] });
  await pending;
  assert.equal(h.state.storageLoading, false);
  assert.equal(busy.at(-1), false);
});

test("a confirmed delete locks the composer until acknowledgment and unlocks before opening a fallback", async () => {
  const h = harness();
  const conversation = { id: "test", title: "Test", revision: 1 };
  h.state.activeConversation = conversation;
  h.state.conversations = [conversation];
  h.state.modelReady = true;
  h.context.window.confirm = () => true;
  let release;
  h.context.window.hypermaniaStorage = { request: () => new Promise((resolve) => { release = resolve; }) };
  const busy = [];
  let cleared = false;
  Object.assign(h.context, { makeConversationId: () => "mutation", setBusy: (value) => busy.push(value),
    startNewConversation: () => { assert.equal(h.state.storageLoading, false); cleared = true; },
    renderConversationList() {},
  });
  vm.runInContext(part(source, "async function deleteConversation(", "async function loadConversationHistory()"), h.context);
  vm.runInContext(part(source, "async function sendChat()", "function syncSettingsPreferences()"), h.context);
  const pending = h.context.deleteConversation(conversation);
  assert.equal(h.state.storageLoading, true);
  assert.equal(busy[0], true);
  await h.context.sendChat();
  assert.equal(h.state.requestInProgress, false);
  release({});
  await pending;
  assert.equal(cleared, true);
  assert.equal(h.state.storageLoading, false);
  assert.equal(busy.at(-1), false);
});
