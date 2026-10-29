const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const monitorSource = source.slice(source.indexOf("function pdfPreparationStatus("), source.indexOf("function supportsVision("));
const streamSource = source.slice(source.indexOf("async function streamChat("), source.indexOf("async function fetchChatOnce("));

function harness() {
  let now = 0;
  let interval;
  const labels = [];
  const state = { activeRequestId: "test-request" };
  const context = {
    state,
    Date: { now: () => now },
    setInterval: (callback) => { interval = callback; return 1; },
    clearInterval: () => { interval = null; },
    setBusy: (_, label) => labels.push(label),
    debugLog() {},
    fetch: async () => ({ ok: true }),
  };
  vm.createContext(context);
  vm.runInContext(monitorSource, context);
  return { context, state, labels, advance: (ms) => { now += ms; }, tick: () => interval(), label: () => labels.at(-1) };
}

test("duration formatting handles seconds, minute/hour boundaries, and long waits", () => {
  const { context } = harness();
  for (const [seconds, expected] of [[0, "0s"], [25, "25s"], [59, "59s"], [60, "1m0s"],
    [530, "8m50s"], [3599, "59m59s"], [3600, "1h0m0s"], [5000, "1h23m20s"],
    [5425, "1h30m25s"], [90061, "25h1m1s"]]) {
    assert.equal(context.formatGenerationElapsed(seconds), expected);
  }
});

test("waiting keeps time since model output even when health checks succeed", async () => {
  const h = harness();
  h.context.beginGenerationMonitor();
  h.context.renderGenerationStatus();
  assert.equal(h.label(), "Waiting for Ollama…");
  h.advance(7999);
  await h.tick();
  assert.equal(h.label(), "Waiting for Ollama…");
  h.advance(1);
  await h.tick();
  assert.equal(h.label(), "Waiting for Ollama — no model output yet (8s)");
  h.advance(5345000);
  await h.tick();
  assert.equal(h.label(), "Waiting for Ollama — no model output yet (1h29m13s)");
});

test("thinking and answer phases survive silence and reset between sends", async () => {
  const h = harness();
  h.context.beginGenerationMonitor();
  h.context.touchGeneration("thinking");
  assert.equal(h.label(), "Receiving reasoning…");
  h.advance(30000);
  await h.tick();
  assert.equal(h.label(), "Waiting for more reasoning — no new output for 30s");
  h.context.touchGeneration("answer");
  assert.equal(h.label(), "Generating answer…");
  h.advance(65000);
  await h.tick();
  assert.equal(h.label(), "Waiting for more answer text — no new output for 1m5s");
  h.context.endGenerationMonitor("Done.");
  h.context.beginGenerationMonitor();
  h.context.renderGenerationStatus();
  assert.equal(h.label(), "Waiting for Ollama…");
  h.context.touchGeneration("answer");
  assert.equal(h.label(), "Generating answer…");
});

test("health failures recover without claiming generation progress", async () => {
  const h = harness();
  h.context.fetch = async () => { throw new Error("offline"); };
  h.context.beginGenerationMonitor();
  h.advance(10000);
  await h.tick();
  await h.tick();
  assert.equal(h.label(), "Cannot reach Ollama — no new model output for 10s");
  h.context.fetch = async () => ({ ok: true });
  await h.tick();
  assert.equal(h.label(), "Waiting for Ollama — no model output yet (10s)");
  h.context.fetch = async () => ({ ok: false, status: 503 });
  await h.tick();
  await h.tick();
  h.context.touchGeneration("thinking");
  assert.equal(h.label(), "Receiving reasoning…");
});

test("a pending health check cannot overlap or overwrite recovery and later operations", async () => {
  const h = harness();
  let resolveHealth;
  let requests = 0;
  h.context.fetch = () => { requests++; return new Promise((resolve) => { resolveHealth = resolve; }); };
  h.context.beginGenerationMonitor();
  const pending = h.tick();
  await h.tick();
  assert.equal(requests, 1);
  h.state.generationSession.reconnecting = true;
  h.context.setBusy(true, "Reconnecting to response…");
  h.advance(10000);
  await h.tick();
  assert.equal(h.label(), "Reconnecting to response…");
  h.context.stopGenerationMonitor();
  h.context.setBusy(true, "Polishing final answer…");
  resolveHealth({ ok: false, status: 503 });
  await pending;
  assert.equal(h.label(), "Polishing final answer…");
  assert.equal(h.state.generationSession, null);
  h.context.beginGenerationMonitor();
  h.context.touchGeneration("answer");
  assert.equal(h.label(), "Generating answer…");
  h.context.endGenerationMonitor("Request failed. Your message is ready to retry.");
  h.context.touchGeneration("thinking");
  assert.equal(h.label(), "Request failed. Your message is ready to retry.");
});

test("late health checks from a previous send cannot change the next send", async () => {
  const h = harness();
  let rejectHealth;
  h.context.fetch = () => new Promise((_, reject) => { rejectHealth = reject; });
  h.context.beginGenerationMonitor();
  const pending = h.tick();
  h.context.beginGenerationMonitor();
  h.context.touchGeneration("answer");
  rejectHealth(new Error("late failure"));
  await pending;
  assert.equal(h.state.generationPingFailures, 0);
  assert.equal(h.label(), "Generating answer…");
});

test("PDF labels retain exact filenames and attachment position", () => {
  const h = harness();
  for (const name of ["1234.pdf", "<img src=x onerror=alert(1)>.pdf", "資料".repeat(200) + ".pdf"]) {
    assert.equal(h.context.pdfPreparationStatus({ name }, 2, 3), `Preparing ${name} (2 of 3)…`);
  }
  // The shared UI sink uses textContent for both live and visible labels.
  const busySource = source.slice(source.indexOf("function setBusy("), source.indexOf("function ensureErrorControls("));
  assert.match(busySource, /status\.textContent = statusText/);
  assert.match(busySource, /state\.assistantWaitLabel\.textContent = statusText/);
  assert.doesNotMatch(busySource, /innerHTML/);
});

test("real stream polling handles empty polls, reasoning, reconnect, and answer catch-up", async () => {
  const h = harness();
  const observations = [];
  let step = 0;
  let offset = 0;
  const chunks = ["", JSON.stringify({ message: { thinking: "considering" } }) + "\n", null, "",
    JSON.stringify({ message: { content: "answer" } })];
  Object.assign(h.context, {
    buildRequestBody: () => ({}), traceHeaders: () => ({}),
    CHAT_JOB_HIDDEN_POLL_MS: 2000, CHAT_JOB_POLL_MS: 400,
    CHAT_JOB_FETCH_TIMEOUT_MS: 15000, CHAT_JOB_VISIBLE_RETRY_MS: 30000,
    AbortController, cleanThinkingText: (text) => text,
    setTimeout: (callback, ms) => { if (ms < 15000) queueMicrotask(callback); return 1; },
    clearTimeout() {},
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    fetch: async (url) => {
      if (url === "/api/chat/jobs") return { ok: true, json: async () => ({ id: "job" }) };
      observations.push(h.label());
      const data = chunks[step++];
      if (data === null) throw new Error("disconnected");
      h.advance(10000);
      offset += data.length;
      return { ok: true, json: async () => ({ data, offset, status: step === chunks.length ? "complete" : "running" }) };
    },
  });
  vm.runInContext(streamSource, h.context);
  h.context.beginGenerationMonitor();
  const result = await h.context.streamChat("mock-model", [], true);
  assert.equal(result.thinking, "considering");
  assert.equal(result.content, "answer");
  assert.ok(observations.includes("Waiting for Ollama — no model output yet (10s)"));
  assert.ok(observations.includes("Receiving reasoning…"));
  assert.ok(observations.includes("Reconnecting to response…"));
  assert.ok(observations.includes("Waiting for more reasoning — no new output for 10s"));
  assert.equal(h.label(), "Generating answer…");
});

test("stream completion stops the monitor before fallback and saving", () => {
  // Guard the integration ordering; timer behavior itself is exercised above.
  assert.match(source, /await streamChat\([^\n]+\);\s*\/\/[^\n]+\n\s*stopGenerationMonitor\(\);\s*if \(!reply\)/);
});
