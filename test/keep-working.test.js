const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const lifecycle = source.slice(source.indexOf("function requestResponseStop("), source.indexOf("async function sendChat("));
const line = (content) => JSON.stringify({ message: { content }, done: true }) + "\n";
const reply = (payload) => ({ ok: true, json: async () => payload });

function harness(handler) {
  let now = 0;
  let stage = 0;
  const calls = [];
  const labels = [];
  const state = { activeKeepWorking: true, stopRequested: false };
  const context = vm.createContext({
    state, AbortController,
    Date: { now: () => now },
    makeConversationId: () => `stage-${++stage}`,
    buildRequestBody: (model, messages, thinking, stream, documents) => ({ model, messages, stream, documents }),
    traceHeaders: () => ({}), debugLog() {}, cleanThinkingText: (value) => value,
    setBusy: (_, label) => { if (label) labels.push(label); },
    renderGenerationStatus() {}, touchGeneration() {},
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    CHAT_JOB_FETCH_TIMEOUT_MS: 15000, CHAT_JOB_HIDDEN_POLL_MS: 2000, CHAT_JOB_POLL_MS: 400,
    setTimeout: (callback, delay) => {
      if (delay < 15000) queueMicrotask(() => { now += delay; callback(); });
      return 1;
    },
    clearTimeout() {},
    publicError: (message, diagnostic, referenceId) => Object.assign(new Error(diagnostic), { publicMessage: message, referenceId }),
    apiResponseError: (body, fallback) => {
      let payload = {};
      try { payload = JSON.parse(body); } catch { /* Proxy responses need not be JSON. */ }
      return Object.assign(new Error(payload.error || fallback), { referenceId: payload.requestId || "" });
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return handler(url, options, context);
    },
  });
  vm.runInContext(lifecycle, context);
  return { context, state, calls, labels, advance: (ms) => { now += ms; }, now: () => now };
}

test("long foreground/background outages retain stage and offset past an hour", async () => {
  let polls = 0;
  const first = line("first");
  const tail = line(" second");
  const h = harness((url, options, context) => {
    if (url === "/api/chat/jobs") return reply({ id: JSON.parse(options.body).jobId });
    polls++;
    if (polls === 1) return reply({ offset: first.length, data: first, status: "running" });
    if (polls < 5) {
      h.advance(31 * 60 * 1000);
      context.document.hidden = polls === 3;
      throw new Error("offline");
    }
    assert.match(url, new RegExp(`offset=${first.length}$`));
    return reply({ offset: first.length + tail.length, data: tail, status: "complete" });
  });
  const result = await h.context.streamChat("model", [], true, {}, false);
  assert.equal(result.content, "first second");
  assert.ok(h.now() > 60 * 60 * 1000);
  assert.equal(h.calls.filter(({ url }) => url === "/api/chat/jobs").length, 1);
  assert.equal(JSON.parse(h.calls[0].options.body).keepWorking, true);
  assert.equal(h.state.activeJobId, null);
});

test("creation retries preserve exact stage/body after a lost acknowledgment", async () => {
  let creates = 0;
  const h = harness((url, options) => {
    if (url === "/api/chat/jobs") {
      if (++creates === 1) throw new Error("acknowledgment lost after server accepted request");
      return reply({ id: JSON.parse(options.body).jobId });
    }
    return reply({ offset: line("done").length, data: line("done"), status: "complete" });
  });
  h.state.activeKeepWorking = false;
  await h.context.streamChat("model", [], false, {}, false);
  assert.equal(creates, 2);
  assert.equal(h.calls[0].options.body, h.calls[1].options.body);
  assert.equal(JSON.parse(h.calls[0].options.body).keepWorking, false);
});

test("Stop before creation acknowledgment cancels the recovered same stage", async () => {
  const h = harness((url, options, context) => {
    if (url === "/api/chat/jobs") {
      context.requestResponseStop();
      context.requestResponseStop();
      return reply({ id: JSON.parse(options.body).jobId });
    }
    if (url.endsWith("/cancel")) return reply({ status: "canceled" });
    return reply({ offset: 0, data: "", status: "canceled" });
  });
  await assert.rejects(h.context.streamChat("model", [], false, {}, false), { name: "ChatCanceledError" });
  assert.equal(h.calls.filter(({ url }) => url.endsWith("/cancel")).length, 1);
  assert.match(h.calls[1].url, /stage-1\/cancel$/);
});

test("offline Stop remains pending and retries until server confirms cancellation", async () => {
  let cancels = 0;
  let polls = 0;
  const h = harness((url, options, context) => {
    if (url === "/api/chat/jobs") return reply({ id: JSON.parse(options.body).jobId });
    if (url.endsWith("/cancel")) {
      if (++cancels === 1) throw new Error("offline");
      return reply({ status: "canceled" });
    }
    if (++polls === 1) {
      context.requestResponseStop();
      return reply({ offset: 0, data: "", status: "running" });
    }
    return reply({ offset: 0, data: "", status: "canceled" });
  });
  await assert.rejects(h.context.streamChat("model", [], false, {}, false), { name: "ChatCanceledError" });
  assert.equal(cancels, 2);
  assert.ok(h.labels.includes("Stop pending — reconnecting to response…"));
});

test("completion that wins a Stop race remains authoritative", async () => {
  const h = harness((url, options, context) => {
    if (url === "/api/chat/jobs") {
      context.requestResponseStop();
      return reply({ id: JSON.parse(options.body).jobId });
    }
    if (url.endsWith("/cancel")) return reply({ status: "complete" });
    return reply({ offset: line("finished").length, data: line("finished"), status: "complete" });
  });
  assert.equal((await h.context.streamChat("model", [], true, {}, false)).content, "finished");
});

test("fallback and polishing transport uses fresh cancellable retained stages", async () => {
  const ids = [];
  const h = harness((url, options, context) => {
    if (url === "/api/chat/jobs") {
      const body = JSON.parse(options.body);
      ids.push(body.jobId);
      assert.equal(body.keepWorking, true);
      assert.equal(body.documents.mode, "none");
      context.requestResponseStop();
      return reply({ id: body.jobId });
    }
    if (url.endsWith("/cancel")) return reply({ status: "canceled" });
    return reply({ offset: 0, data: "", status: "canceled" });
  });
  for (let stage = 0; stage < 2; stage++) {
    h.state.stopRequested = false;
    await assert.rejects(h.context.fetchChatOnce("model", [], false, { mode: "none" }), { name: "ChatCanceledError" });
  }
  assert.equal(new Set(ids).size, 2);
  assert.ok(h.calls.every(({ url }) => url.startsWith("/api/chat/jobs")));
});

test("definitive capacity rejection is visible rather than retried indefinitely", async () => {
  const h = harness(() => ({ ok: false, status: 503,
    text: async () => JSON.stringify({ error: "Too many responses are being retained. Try again later.", requestId: "reference" }),
  }));
  await assert.rejects(h.context.streamChat("model", [], false, {}, false), /Too many responses/);
  assert.equal(h.calls.length, 1);
});

test("genuine job failure and missing-job errors remain visible", async () => {
  const h = harness((url, options) => url === "/api/chat/jobs"
    ? reply({ id: JSON.parse(options.body).jobId })
    : reply({ offset: 0, data: "", status: "failed", error: "The model request failed.", requestId: "reference" }));
  await assert.rejects(h.context.streamChat("model", [], false, {}, false), /The model request failed/);
  const missing = harness((url, options) => url === "/api/chat/jobs"
    ? reply({ id: JSON.parse(options.body).jobId })
    : { ok: false, status: 404, text: async () => JSON.stringify({ error: "This response is no longer available." }) });
  await assert.rejects(missing.context.streamChat("model", [], false, {}, false), /no longer available/);
  assert.equal(missing.calls.length, 2);
});


test("a recovered follow-up replaces reconnect status without a generation monitor", async () => {
  let polls = 0;
  const h = harness((url, options) => {
    if (url === "/api/chat/jobs") return reply({ id: JSON.parse(options.body).jobId });
    if (++polls === 1) throw new Error("offline after first pass completed");
    if (polls === 2) {
      assert.equal(h.labels.at(-1), "Reconnecting to response…");
      return reply({ offset: 0, data: "", status: "running" });
    }
    assert.equal(h.labels.at(-1), "Generating final answer…");
    return reply({ offset: line("polished").length, data: line("polished"), status: "complete" });
  });
  assert.equal(h.state.generationSession, undefined);
  const result = await h.context.fetchChatOnce("model", [], false, { mode: "none" });
  assert.equal(result.content, "polished");
  assert.equal(h.labels.at(-1), "Generating final answer…");
});
