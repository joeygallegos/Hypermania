const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const PROJECT_DIR = path.resolve(__dirname, "..");
let appProcess;
let appBase;
let mockOllama;
let mockOllamaBase;
let lastChatRequest;
let chatRequestCount = 0;
let releaseHeldChat;
let appOutput = "";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function unusedPort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function waitForApp(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Hypermania exited before startup.\n${appOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process may not have bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}.\n${appOutput}`);
}

async function startChatJob(prompt, overrides = {}) {
  const response = await fetch(`${appBase}/api/chat/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model:latest",
      messages: [{ role: "user", content: prompt }],
      stream: true,
      ...overrides,
    }),
  });
  assert.equal(response.status, 202);
  return response.json();
}

async function fetchChatJob(id, offset = 0) {
  const response = await fetch(`${appBase}/api/chat/jobs/${id}?offset=${offset}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForChatJob(id, predicate, offset = 0, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let job;
  while (Date.now() < deadline) {
    job = await fetchChatJob(id, offset);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for chat job ${id}. Last state: ${JSON.stringify(job)}`);
}

before(async () => {
  // Exercise the real HTTP server in a child process while keeping tests fast,
  // deterministic, and independent of the user's installed Ollama models.
  mockOllama = http.createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "test-model:latest" }] }));
      return;
    }

    if (req.url === "/api/show") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ capabilities: ["completion"] }));
      return;
    }

    if (req.url === "/api/chat") {
      chatRequestCount += 1;
      lastChatRequest = await readJson(req);
      if (lastChatRequest.messages?.at(-1)?.content === "job-failure") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mock generation failed" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      if (lastChatRequest.messages?.at(-1)?.content === "incremental-recovery") {
        res.write('{"message":{"content":"first"},"done":false}\n');
        await new Promise((resolve) => { releaseHeldChat = resolve; });
        releaseHeldChat = null;
        res.end('{"message":{"content":" second"},"done":true}\n');
        return;
      }
      if (lastChatRequest.messages?.at(-1)?.content === "unicode-boundary") {
        const output = Buffer.from('{"message":{"content":"A🙂B"},"done":true}\n');
        const emojiStart = output.indexOf(Buffer.from("🙂"));
        res.write(output.subarray(0, emojiStart + 2));
        await new Promise((resolve) => setTimeout(resolve, 5));
        res.end(output.subarray(emojiStart + 2));
        return;
      }
      if (lastChatRequest.messages?.at(-1)?.content.startsWith("isolation-")) {
        const content = lastChatRequest.messages.at(-1).content;
        res.end(`${JSON.stringify({ message: { content }, done: true })}\n`);
        return;
      }
      if (lastChatRequest.messages?.at(-1)?.content === "recover-after-background") {
        res.write('{"message":{"content":"saved"},"done":false}\n');
        await new Promise((resolve) => setTimeout(resolve, 40));
        res.end('{"message":{"content":" response"},"done":true}\n');
        return;
      }
      res.write('{"message":{"content":"hello"},"done":false}\n');
      res.end('{"message":{"content":" world"},"done":true}\n');
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const ollamaPort = await listen(mockOllama);
  mockOllamaBase = `http://127.0.0.1:${ollamaPort}`;

  const appPort = await unusedPort();
  appBase = `http://127.0.0.1:${appPort}`;
  appProcess = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      OLLAMA_BASE: mockOllamaBase,
      PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  appProcess.stdout.on("data", (chunk) => { appOutput += chunk; });
  appProcess.stderr.on("data", (chunk) => { appOutput += chunk; });
  await waitForApp(`${appBase}/`);
}, { timeout: 15000 });

after(async () => {
  releaseHeldChat?.();
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill();
    await Promise.race([
      once(appProcess, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  if (mockOllama?.listening) {
    await new Promise((resolve, reject) => mockOllama.close((error) => error ? reject(error) : resolve()));
  }
});

test("serves the chat shell and its required assets", async () => {
  const index = await fetch(`${appBase}/`);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /id="conversationList"/);
  assert.match(html, /src="\/chat-history\.js"/);
  assert.ok(html.indexOf('/chat-history.js') < html.indexOf('/app.js'));

  for (const asset of ["/app.js", "/chat-history.js", "/style.css"]) {
    const response = await fetch(`${appBase}${asset}`);
    assert.equal(response.status, 200, asset);
  }
});

test("proxies model discovery with CORS enabled", async () => {
  const response = await fetch(`${appBase}/api/ollama/tags`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), { models: [{ name: "test-model:latest" }] });
});

test("streams chat bytes and forwards the complete context", async () => {
  const payload = {
    model: "test-model:latest",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer", thinking: "reasoning" },
      { role: "user", content: "continue" },
    ],
    stream: true,
  };
  const response = await fetch(`${appBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson");
  assert.equal(
    await response.text(),
    '{"message":{"content":"hello"},"done":false}\n{"message":{"content":" world"},"done":true}\n'
  );
  assert.deepEqual(lastChatRequest, payload);
});

test("retains a generation while the browser is away and returns missed chunks", async () => {
  const requestsBefore = chatRequestCount;
  const start = await fetch(`${appBase}/api/chat/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model:latest",
      messages: [{ role: "user", content: "recover-after-background" }],
      stream: true,
    }),
  });

  assert.equal(start.status, 202);
  const { id } = await start.json();
  assert.match(id, /^[a-f0-9-]{36}$/);

  // No client holds a response stream during this pause. This represents a
  // backgrounded browser whose JavaScript and network activity were suspended.
  await new Promise((resolve) => setTimeout(resolve, 100));

  const result = await fetch(`${appBase}/api/chat/jobs/${id}?offset=0`);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    status: "complete",
    offset: 93,
    data: '{"message":{"content":"saved"},"done":false}\n{"message":{"content":" response"},"done":true}\n',
  });
  const missedTail = await fetch(`${appBase}/api/chat/jobs/${id}?offset=45`);
  assert.deepEqual(await missedTail.json(), {
    status: "complete",
    offset: 93,
    data: '{"message":{"content":" response"},"done":true}\n',
  });
  const invalidOffset = await fetch(`${appBase}/api/chat/jobs/${id}?offset=94`);
  assert.equal(invalidOffset.status, 416);
  assert.equal(chatRequestCount, requestsBefore + 1);
  assert.deepEqual(lastChatRequest, {
    model: "test-model:latest",
    messages: [{ role: "user", content: "recover-after-background" }],
    stream: true,
  });
});

test("returns only new chunks while a retained generation is still running", async () => {
  const firstChunk = '{"message":{"content":"first"},"done":false}\n';
  const finalChunk = '{"message":{"content":" second"},"done":true}\n';
  const { id } = await startChatJob("incremental-recovery");

  try {
    const running = await waitForChatJob(
      id,
      (job) => job.status === "running" && job.data === firstChunk
    );
    assert.equal(running.offset, firstChunk.length);

    releaseHeldChat();
    const completed = await waitForChatJob(
      id,
      (job) => job.status === "complete",
      running.offset
    );
    assert.equal(completed.offset, firstChunk.length + finalChunk.length);
    assert.equal(completed.data, finalChunk);
  } finally {
    // Ensure a failed assertion cannot leave the mock response open and hang the
    // server teardown for every test that follows.
    releaseHeldChat?.();
  }
});

test("preserves Unicode split across upstream byte chunks", async () => {
  const expected = '{"message":{"content":"A🙂B"},"done":true}\n';
  const { id } = await startChatJob("unicode-boundary");
  const completed = await waitForChatJob(id, (job) => job.status === "complete");

  assert.equal(completed.data, expected);
  // The browser sends offsets back as JavaScript string positions, including
  // the surrogate pair used by the emoji—not raw UTF-8 byte positions.
  assert.equal(completed.offset, expected.length);
});

test("keeps concurrent retained responses isolated by job ID", async () => {
  const requestsBefore = chatRequestCount;
  const [left, right] = await Promise.all([
    startChatJob("isolation-left"),
    startChatJob("isolation-right"),
  ]);
  const [leftResult, rightResult] = await Promise.all([
    waitForChatJob(left.id, (job) => job.status === "complete"),
    waitForChatJob(right.id, (job) => job.status === "complete"),
  ]);

  assert.match(leftResult.data, /isolation-left/);
  assert.doesNotMatch(leftResult.data, /isolation-right/);
  assert.match(rightResult.data, /isolation-right/);
  assert.doesNotMatch(rightResult.data, /isolation-left/);
  assert.equal(chatRequestCount, requestsBefore + 2);
});

test("reports a retained job failure without leaving it running", async () => {
  const { id } = await startChatJob("job-failure");
  const job = await waitForChatJob(id, (candidate) => candidate.status !== "running");

  assert.equal(job.status, "failed");
  assert.equal(job.offset, 0);
  assert.equal(job.data, "");
  assert.match(job.error, /mock generation failed/);
});

test("validates retained-job methods, payloads, IDs, and offsets", async (t) => {
  await t.test("rejects unsupported collection methods", async () => {
    const response = await fetch(`${appBase}/api/chat/jobs`);
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: "Method not allowed" });
  });

  await t.test("rejects malformed and non-object request bodies", async () => {
    for (const body of ["{", "[]", "null"]) {
      const response = await fetch(`${appBase}/api/chat/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      assert.equal(response.status, 400, body);
      assert.deepEqual(await response.json(), { error: "Invalid chat request." });
    }
  });

  await t.test("does not expose unknown or malformed job IDs", async () => {
    const unknown = await fetch(`${appBase}/api/chat/jobs/00000000-0000-4000-8000-000000000000`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: "This response is no longer available." });

    const malformed = await fetch(`${appBase}/api/chat/jobs/not-a-job-id`);
    assert.equal(malformed.status, 404);
    assert.deepEqual(await malformed.json(), { error: "Chat response not found." });
  });

  await t.test("rejects unsupported item methods before job lookup", async () => {
    const response = await fetch(`${appBase}/api/chat/jobs/00000000-0000-4000-8000-000000000000`, {
      method: "DELETE",
    });
    assert.equal(response.status, 405);
  });

  await t.test("rejects offsets outside the retained response", async () => {
    const { id } = await startChatJob("offset-validation");
    const completed = await waitForChatJob(id, (job) => job.status === "complete");
    for (const offset of ["-1", "1.5", "not-a-number", String(completed.offset + 1)]) {
      const response = await fetch(`${appBase}/api/chat/jobs/${id}?offset=${offset}`);
      assert.equal(response.status, 416, offset);
      assert.deepEqual(await response.json(), { error: "Invalid response offset." });
    }
  });
});

test("reports the configured Ollama endpoint", async () => {
  const response = await fetch(`${appBase}/api/ollama/config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ollamaBase: mockOllamaBase });
});

test("rejects malformed PDF uploads without invoking external tools", async () => {
  const response = await fetch(`${appBase}/api/pdf/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "not-valid-base64!" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /base64 PDF data/i);
});

test("returns 404 for missing static files", async () => {
  const response = await fetch(`${appBase}/missing-file.txt`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
});
