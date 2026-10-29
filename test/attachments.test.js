const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

// Run the actual attachment functions with a small DOM double. Browser geometry
// is verified separately; this harness exercises state changes and event guards.
function harness() {
  const nodes = new Map();
  const document = {
    activeElement: null,
    createElement: (tag) => new Element(tag),
    getElementById: (id) => nodes.get(id),
  };
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.className = "";
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      const classes = new Set();
      this.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
        contains: (name) => classes.has(name),
      };
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    replaceChildren() { this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    focus() { document.activeElement = this; }
    click() { return this.listeners.click?.({ target: this }); }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(selector === `.${child.className.split(" ").at(-1)}` ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
  }
  for (const id of ["preview", "attachmentTray", "attachmentToggle", "dropzone", "dropLabel", "dropHint",
    "images", "prompt", "model", "thinkMode", "thinkingControl", "status", "send", "newChat", "conversationList",
    "keepWorking", "stopResponse", "responseNotice"]) {
    nodes.set(id, new Element());
  }
  nodes.get("attachmentTray").hidden = true;
  nodes.get("attachmentTray").append(nodes.get("dropzone"), nodes.get("preview"));
  const state = { images: [], pdfs: [], documents: [], requestInProgress: false, sendLabel: "Send" };
  const errors = [];
  const context = vm.createContext({
    state, document, el: (id) => nodes.get(id), MAX_CONVERSATION_DOCUMENTS: 16,
    makeConversationId: () => "test-id", isPdf: (file) => file.type === "application/pdf",
    fileToDataUrl: async () => "data:image/png;base64,aGVsbG8=",
    updateSendState() {}, renderModelMeta() {}, setStatus() {}, debugLog() {},
    showError: (...args) => errors.push(args),
  });
  const slices = [
    ["function renderPreview()", "function isGptOssModel("],
    ["async function ingestFiles(", "function extractErrorDetails("],
    ["function setBusy(", "function ensureErrorControls("],
    ["function attachFileHandling()", 'el("send").addEventListener'],
  ];
  for (const [start, end] of slices) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  context.attachFileHandling();
  return { context, nodes, state, document, errors };
}

const pdf = (name) => ({ name, type: "application/pdf" });

test("eleven selected PDFs collapse to a correct summary without preview tiles", async () => {
  const { context, nodes, state, document } = harness();
  context.setAttachmentTrayOpen(true);
  nodes.get("dropzone").focus();
  nodes.get("images").files = Array.from({ length: 11 }, (_, i) => pdf(`report-${i}.pdf`));
  await nodes.get("images").listeners.change({ target: nodes.get("images") });
  assert.equal(state.pdfs.length, 11);
  assert.equal(nodes.get("attachmentTray").hidden, true);
  assert.equal(nodes.get("attachmentToggle").textContent, "Show 11 PDFs attached");
  assert.equal(nodes.get("attachmentToggle").attributes["aria-expanded"], "false");
  assert.equal(document.activeElement, nodes.get("attachmentToggle"));
  const figures = nodes.get("preview").children;
  assert.equal(figures.length, 11);
  assert.ok(figures.every((figure) => figure.children.length === 1 && figure.children[0].tagName === "figcaption"));
  nodes.get("attachmentToggle").click();
  assert.equal(nodes.get("attachmentToggle").textContent, "Hide 11 PDFs attached");
  assert.equal(nodes.get("attachmentToggle").attributes["aria-expanded"], "true");
});

test("mixed appends preserve thumbnails and exact filenames; removal updates counts and focus", async () => {
  const { context, nodes, state, document } = harness();
  const name = `${"long-name-".repeat(20)}<report>.pdf`;
  await context.ingestFiles([pdf(name)]);
  await context.ingestFiles([{ name: "chart.png", type: "image/png" }], { pasted: true });
  assert.equal(nodes.get("attachmentToggle").textContent, "Show 1 image and 1 PDF attached");
  assert.equal(nodes.get("preview").children[0].children[0].tagName, "img");
  assert.equal(nodes.get("preview").children[1].children[0].children[1].textContent, name);
  context.setAttachmentTrayOpen(true);
  const buttons = nodes.get("preview").querySelectorAll(".attachment-remove");
  assert.equal(buttons[1].attributes["aria-label"], `Remove ${name}`);
  buttons[1].click();
  assert.equal(state.pdfs.length, 0);
  assert.equal(state.images.length, 1);
  assert.equal(document.activeElement, nodes.get("preview").querySelectorAll(".attachment-remove")[0]);
  nodes.get("preview").querySelectorAll(".attachment-remove")[0].click();
  assert.equal(nodes.get("preview").children.length, 0);
  assert.equal(nodes.get("dropLabel").textContent.startsWith("Drop images"), true);
  assert.equal(document.activeElement, nodes.get("attachmentToggle"));
});

test("busy inspection remains available while every file mutation path stays locked", async () => {
  const { context, nodes, state } = harness();
  await context.ingestFiles([pdf("keep.pdf")]);
  state.requestInProgress = true;
  context.setBusy(true);
  nodes.get("attachmentToggle").click();
  assert.equal(nodes.get("attachmentTray").hidden, false);
  assert.equal(nodes.get("dropzone").attributes["aria-disabled"], "true");
  const remove = nodes.get("preview").querySelectorAll(".attachment-remove")[0];
  assert.equal(remove.disabled, true);
  remove.click();
  await context.ingestFiles([pdf("blocked.pdf")]);
  await nodes.get("dropzone").listeners.drop({ preventDefault() {}, dataTransfer: { files: [pdf("drop.pdf")] } });
  nodes.get("images").files = [pdf("input.pdf")];
  await nodes.get("images").listeners.change({ target: nodes.get("images") });
  assert.equal(state.pdfs.length, 1);
  nodes.get("attachmentToggle").click();
  assert.equal(nodes.get("attachmentTray").hidden, true);
  state.requestInProgress = false;
  context.setBusy(false);
  assert.equal(remove.disabled, false);
});

test("drop appends files, keyboard browse works, and a rejected append preserves pending state", async () => {
  const { context, nodes, state, errors } = harness();
  let browsed = 0;
  nodes.get("images").listeners.click = () => browsed++;
  nodes.get("dropzone").listeners.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(browsed, 1);
  await nodes.get("dropzone").listeners.drop({ preventDefault() {}, dataTransfer: { files: [pdf("drop.pdf")] } });
  assert.equal(state.pdfs[0].name, "drop.pdf");
  await context.ingestFiles(Array.from({ length: 16 }, (_, i) => pdf(`${i}.pdf`)));
  assert.equal(state.pdfs.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(nodes.get("attachmentToggle").textContent, "Show 1 PDF attached");
});

test("an image read finishing after Send cannot mutate the pending attachment snapshot", async () => {
  const { context, state } = harness();
  let finishRead;
  context.fileToDataUrl = () => new Promise((resolve) => { finishRead = resolve; });
  const ingest = context.ingestFiles([{ name: "late.png", type: "image/png" }]);
  state.requestInProgress = true;
  finishRead("data:image/png;base64,aGVsbG8=");
  await ingest;
  assert.equal(state.images.length, 0);
});

test("mocked send collapses immediately, retains failed files, and clears successful pending files", async () => {
  const { context, nodes, state } = harness();
  Object.assign(state, { history: [], modelInfo: new Map(), threadId: "test" });
  const pending = { id: "doc", pages: [{ number: 1, text: "mock", image: "mock" }] };
  const noOp = () => {};
  Object.assign(context, {
    clearError: noOp, historyHasImages: () => false, getThinkPayload: () => undefined,
    supportsVision: () => true, addMessage: () => ({ row: { remove: noOp } }),
    pdfPreparationStatus: () => "Preparing mock PDF…", setAssistantAnswerText: noOp,
    createAssistantMessage: () => ({ answerPre: {}, answerNode: {}, pending: {}, pendingLabel: {}, answerRow: { remove: noOp } }),
    renderPdf: async () => pending, getContextLength: () => 8192,
    beginGenerationMonitor: noOp, renderGenerationStatus: noOp, stopGenerationMonitor: noOp,
    endGenerationMonitor: () => context.setBusy(false), renderMarkdown: noOp,
    persistCurrentConversationSafely: async () => {}, extractErrorDetails: (error) => error,
  });
  vm.runInContext(source.slice(source.indexOf("async function sendChat()"), source.indexOf("function attachFileHandling()")), context);
  await context.ingestFiles([pdf("keep.pdf")]);
  nodes.get("prompt").value = "  preserve this draft  ";
  context.setAttachmentTrayOpen(true);
  context.streamChat = async () => {
    assert.equal(nodes.get("attachmentTray").hidden, true);
    assert.equal(state.requestInProgress, true);
    throw new Error("mock network failure");
  };
  await context.sendChat();
  assert.equal(state.pdfs.length, 1);
  assert.equal(state.history.length, 0);
  assert.equal(state.documents.length, 0);
  assert.equal(nodes.get("prompt").value, "  preserve this draft  ");
  assert.equal(state.requestInProgress, false);
  assert.equal(nodes.get("attachmentToggle").textContent, "Show 1 PDF attached");
  // A confirmed Stop uses the same exact draft/file rollback without treating
  // an intentional cancellation as an error or persisting a partial answer.
  let stopErrors = 0;
  let saves = 0;
  context.showError = () => stopErrors++;
  context.persistCurrentConversationSafely = async () => saves++;
  context.streamChat = async () => {
    const error = new Error("Response stopped.");
    error.name = "ChatCanceledError";
    throw error;
  };
  await context.sendChat();
  assert.equal(stopErrors, 0);
  assert.equal(saves, 0);
  assert.equal(state.pdfs.length, 1);
  assert.equal(state.history.length, 0);
  assert.equal(state.documents.length, 0);
  assert.equal(nodes.get("prompt").value, "  preserve this draft  ");
  assert.equal(nodes.get("prompt").disabled, false);
  assert.equal(nodes.get("responseNotice").hidden, false);
  assert.equal(nodes.get("responseNotice").textContent, "Stopped. Your message and attachments are ready to send again.");
  context.streamChat = async () => {
    state.stopRequested = true;
    return { content: "", thinking: "unfinished reasoning" };
  };
  let followups = 0;
  context.polishFinalAnswer = async () => { followups++; return { content: "unexpected" }; };
  await context.sendChat();
  assert.equal(followups, 0);
  assert.equal(stopErrors, 0);
  assert.equal(saves, 0);
  assert.equal(nodes.get("prompt").value, "  preserve this draft  ");
  // Exercise both actual NDJSON error paths through sendChat and debugLog,
  // including the HTTP /api/log payload rather than just a thrown exception.
  const sentinel = "PRIVATE_PROMPT_FILENAME_MODEL_OUTPUT_SENTINEL";
  const logPayloads = [];
  Object.assign(context, {
    AbortController, setTimeout, clearTimeout,
    CHAT_JOB_FETCH_TIMEOUT_MS: 15000, CHAT_JOB_POLL_MS: 400, CHAT_JOB_HIDDEN_POLL_MS: 2000,
    buildRequestBody: () => ({}), traceHeaders: () => ({}), cleanThinkingText: (text) => text,
  });
  vm.runInContext(source.slice(source.indexOf("function debugLog("), source.indexOf("function requestResult(")), context);
  vm.runInContext(source.slice(source.indexOf("function extractErrorDetails("), source.indexOf("function imageSupportHint(")), context);
  vm.runInContext(source.slice(source.indexOf("function requestResponseStop("), source.indexOf("async function sendChat(")), context);
  for (const suffix of ["\n", ""]) {
    const data = JSON.stringify({ error: sentinel }) + suffix;
    context.fetch = async (url, options) => {
      if (url === "/api/log") {
        logPayloads.push(JSON.parse(options.body));
        return { ok: true };
      }
      return { ok: true, json: async () => url === "/api/chat/jobs"
        ? { id: "test-id" }
        : { status: "complete", data, offset: data.length } };
    };
    await context.sendChat();
    assert.equal(nodes.get("prompt").value, "  preserve this draft  ");
  }
  // A separately thrown exception must also be safe even if it contains data
  // that did not pass through the normal streaming-error classifier.
  context.streamChat = async () => { throw new Error(sentinel); };
  await context.sendChat();
  assert.equal(logPayloads.filter((entry) => entry.event === "send_error").length, 3);
  assert.equal(JSON.stringify(logPayloads).includes(sentinel), false);
  context.streamChat = async () => {
    assert.equal(nodes.get("responseNotice").hidden, true);
    assert.equal(nodes.get("responseNotice").textContent, "");
    return { content: "mock answer", thinking: "" };
  };
  await context.sendChat();
  assert.equal(state.pdfs.length, 0);
  assert.equal(state.documents.length, 1);
  assert.equal(state.history.length, 2);
  assert.equal(nodes.get("attachmentTray").hidden, true);
  assert.equal(nodes.get("attachmentToggle").textContent, "+ Add images or PDF");
});


test("active lifecycle notice remains visible before and after the waiting bubble is removed", () => {
  const { context, state, nodes } = harness();
  state.activeJobId = "retained-stage";
  state.assistantWaitLabel = { textContent: "" };
  context.setBusy(true, "Waiting for Ollama…");
  assert.equal(nodes.get("responseNotice").hidden, false);
  assert.equal(state.assistantWaitLabel.textContent, "Waiting for Ollama…");
  // Receiving answer text removes the pending bubble in the actual stream.
  state.assistantWaitLabel = null;
  context.setBusy(true, "Reconnecting to response…");
  assert.equal(nodes.get("responseNotice").textContent, "Reconnecting to response…");
  assert.equal(nodes.get("responseNotice").hidden, false);
  state.stopRequested = true;
  context.setBusy(true, "Stop pending — reconnecting to response…");
  assert.equal(nodes.get("responseNotice").textContent, "Stop pending — reconnecting to response…");
  state.stopRequested = false;
  context.setBusy(true, "Generating answer…");
  assert.equal(nodes.get("responseNotice").textContent, "Generating answer…");
  state.activeJobId = null;
  context.setBusy(true);
  assert.equal(nodes.get("responseNotice").hidden, true);
  assert.equal(nodes.get("responseNotice").textContent, "");
});
