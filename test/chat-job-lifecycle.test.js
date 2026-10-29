const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const lifecycleSource = source.slice(source.indexOf("function pruneChatJobs("), source.indexOf("async function handleChatJobs("));

function harness(keepWorking, beforeHeaders = false) {
  let now = 0;
  let streamController;
  let releaseHeaders;
  const timers = new Map();
  const jobs = new Map();
  const logs = [];
  const context = {
    AbortController, TextDecoder, Date: { now: () => now },
    MAX_CHAT_JOB_RUNTIME_MS: 30 * 60 * 1000,
    MAX_CHAT_JOB_CHARS: 8 * 1024 * 1024,
    MAX_CHAT_JOBS: 50, CHAT_JOB_RETENTION_MS: 6 * 60 * 60 * 1000,
    OLLAMA_TELEMETRY_FIELDS: {}, chatJobs: jobs,
    setTimeout(callback, delay) { const id = {}; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    errorDiagnostic: (error) => error.message,
    appendLogSafely: async (entry) => { logs.push(entry); },
    requestOllama: async (_target, _body, signal) => {
      const body = new ReadableStream({ start(controller) { streamController = controller; } });
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        streamController.error(error);
      }, { once: true });
      if (beforeHeaders) {
        await new Promise((resolve, reject) => {
          releaseHeaders = resolve;
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted before headers"), { name: "AbortError" })), { once: true });
        });
      }
      return { ok: true, body };
    },
  };
  vm.createContext(context);
  vm.runInContext(lifecycleSource, context);
  const job = {
    id: "test", status: "running", keepWorking, controller: new AbortController(),
    data: "", error: "", telemetry: {}, telemetryBuffer: "", updatedAt: 0,
  };
  jobs.set(job.id, job);
  return {
    job, jobs, timers, logs, context,
    run: () => context.runChatJob(job, Buffer.from("{}")),
    async advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
      await Promise.resolve();
    },
    finish() { releaseHeaders?.(); streamController.close(); },
    chunk(text) { streamController.enqueue(new TextEncoder().encode(text)); },
    fail(error) { streamController.error(error); },
  };
}

for (const beforeHeaders of [false, true]) {
  test(`Keep working remains active beyond an hour (${beforeHeaders ? "pre-header" : "streaming"})`, async () => {
    const h = harness(true, beforeHeaders);
    const running = h.run();
    await h.advance(31 * 60 * 1000);
    assert.equal(h.job.status, "running");
    await h.advance(31 * 60 * 1000);
    assert.equal(h.job.status, "running");
    assert.equal(h.timers.size, 0);
    h.finish();
    await running;
    assert.equal(h.job.status, "complete");
    assert.equal(h.job.controller, null);
  });
}

for (const keepWorking of [false, undefined]) {
  test(`limited mode retains its exact 30-minute deadline (${String(keepWorking)})`, async () => {
    const h = harness(keepWorking);
    const running = h.run();
    await h.advance(30 * 60 * 1000 - 1);
    assert.equal(h.job.status, "running");
    await h.advance(1);
    await running;
    assert.equal(h.job.status, "failed");
    assert.equal(h.job.error, "The model request exceeded the 30-minute response limit.");
    assert.equal(h.timers.size, 0);
    assert.equal(h.job.controller, null);
  });
}

test("late buffered output cannot resurrect a canceled job", async () => {
  const h = harness(true);
  const running = h.run();
  await Promise.resolve();
  h.job.status = "canceled";
  h.chunk('{"message":{"content":"late"}}\n');
  h.finish();
  await running;
  assert.equal(h.job.status, "canceled");
  assert.equal(h.job.data, "");
  assert.equal(h.job.controller, null);
});

test("Stop before the runner starts prevents inference and releases its handle", async () => {
  const h = harness(false);
  h.job.status = "canceled";
  h.job.controller.abort();
  await h.run();
  assert.equal(h.job.status, "canceled");
  assert.equal(h.job.data, "");
  assert.equal(h.job.controller, null);
  assert.equal(h.timers.size, 0);
});

test("the existing response cap terminates its transport even with Keep working", async () => {
  const h = harness(true);
  const controller = h.job.controller;
  const running = h.run();
  h.chunk("x".repeat(8 * 1024 * 1024 + 1));
  await running;
  assert.equal(h.job.status, "failed");
  assert.equal(controller.signal.aborted, true);
  assert.equal(h.job.errorDetails, "response_limit");
});

test("stream exceptions cannot inject private text into lifecycle diagnostics", async () => {
  const h = harness(true);
  const running = h.run();
  h.fail(new Error("PRIVATE_PROMPT_SENTINEL PRIVATE_FILENAME_SENTINEL.pdf PRIVATE_ANSWER_SENTINEL"));
  await running;
  assert.equal(h.job.status, "failed");
  assert.equal(h.job.errorDetails, "transport_error");
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_PROMPT_SENTINEL|PRIVATE_FILENAME_SENTINEL|PRIVATE_ANSWER_SENTINEL/);
});

test("pruning preserves running jobs and the existing completion retention and capacity bounds", async () => {
  const h = harness(true);
  await h.advance(7 * 60 * 60 * 1000);
  h.jobs.set("old-complete", { id: "old-complete", status: "complete", updatedAt: 0 });
  h.context.pruneChatJobs();
  assert.equal(h.jobs.has("test"), true);
  assert.equal(h.jobs.has("old-complete"), false);
  for (let index = 0; index < 49; index += 1) {
    h.jobs.set(String(index), { id: String(index), status: "running", updatedAt: 0 });
  }
  h.context.pruneChatJobs(true);
  assert.equal(h.jobs.size, 50);
  h.jobs.get("1").status = "complete";
  h.context.pruneChatJobs(true);
  assert.equal(h.jobs.size, 49);
  assert.equal(h.jobs.has("test"), true);
});
