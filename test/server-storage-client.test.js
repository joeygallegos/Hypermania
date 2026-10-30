const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID, createHash } = require("node:crypto");
const { openStorage } = require("../storage");
const source = fs.readFileSync(path.join(__dirname, "../public/server-storage.js"), "utf8");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hypermania-client-"));
  const filename = path.join(directory, "test.sqlite");
  let store = openStorage(filename);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  let uploads = 0;
  let loseAck = false;
  function page() {
    const window = {};
    vm.runInNewContext(source, { window, crypto: { randomUUID }, AbortController, setTimeout, clearTimeout,
      fetch: async (url, options) => {
        const parts = url.slice("/api/storage/".length).split("/");
        const payload = options.body ? JSON.parse(options.body) : undefined;
        let result;
        try {
          if (parts[0] === "chunks") {
            if (options.method === "PUT") { uploads++; result = store.putChunk(parts[1], parts[2], Number(parts[3]), payload.content); }
            else result = store.getChunk(parts[1], parts[2], Number(parts[3]));
          } else if (parts[0] === "conversations") {
            if (options.method === "PUT") result = store.saveConversation(parts[1], payload);
            else result = store.getConversation(parts[1]);
          } else if (parts[0] === "hash") result = { hash: createHash("sha256").update(payload.content).digest("hex") };
          else if (parts.join("/") === "import/check") result = { skipped: store.checkImport(payload.source, payload.fingerprint) };
        } catch (error) { return { ok: false, status: error.status || 503, json: async () => ({ error: error.message }) }; }
        if (loseAck && parts[0] === "conversations" && options.method === "PUT") { loseAck = false; throw new Error("Lost acknowledgment"); }
        return { ok: true, json: async () => structuredClone(result) };
      },
    });
    return window.hypermaniaStorage;
  }
  return { get store() { return store; }, page, uploads: () => uploads, loseAck: () => { loseAck = true; },
    reopen: () => { store.close(); store = openStorage(filename); }, };
}
function summary(id = randomUUID()) {
  return { id, threadId: randomUUID(), title: "Synthetic", model: "model", revision: 0,
    createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z" };
}

test("browser client round-trips images and PDFs, and text updates do not re-upload images", async (t) => {
  const f = fixture(t);
  const page = f.page();
  const first = summary();
  const history = [{ role: "user", content: "Question", images: ["AAAA"], documentIds: ["pdf"] }, { role: "assistant", content: "Answer", model: "model" }];
  const documents = [{ id: "pdf", name: "Synthetic.pdf", pages: [{ number: 1, text: "Native text", image: "B".repeat(6 * 1024 * 1024) }] }];
  const saved = await page.saveConversation(first, history, documents);
  const count = f.uploads();
  history.push({ role: "user", content: "Follow-up" });
  const next = await page.saveConversation(saved, history, documents);
  assert.equal(f.uploads(), count);
  const otherBrowser = f.page();
  const loaded = await otherBrowser.loadConversation(first.id);
  assert.equal(JSON.stringify(loaded.history), JSON.stringify(history));
  assert.equal(JSON.stringify(loaded.documents), JSON.stringify(documents));
  await otherBrowser.saveConversation(next, history, documents);
  assert.equal(f.uploads(), count, "loaded image references remain reusable");
});

test("lost save acknowledgment retries the same mutation without another conversation version", async (t) => {
  const f = fixture(t);
  const page = f.page();
  const first = summary();
  const history = [{ role: "user", content: "One" }];
  f.loseAck();
  await assert.rejects(page.saveConversation(first, history, []), /retry saving/);
  const saved = await page.saveConversation(first, history, []);
  assert.equal(saved.revision, 1);
  assert.equal(f.store.list().length, 1);
});

test("chat import retries skip originals even after server deletion, and divergent originals conflict", async (t) => {
  const f = fixture(t);
  const first = summary("legacy-mapped");
  const history = [{ role: "user", content: "Original", images: ["AAAA"] }];
  await f.page().saveConversation(first, history, [], "chat:legacy");
  const count = f.uploads();
  assert.equal((await f.page().saveConversation(first, history, [], "chat:legacy")).imported, "skipped");
  assert.equal(f.uploads(), count);
  await assert.rejects(f.page().saveConversation(first, [{ ...history[0], content: "Changed" }], [], "chat:legacy"), /differs/);
  f.store.deleteConversation(first.id, { revision: 1, mutationId: randomUUID() });
  assert.equal((await f.page().saveConversation(first, history, [], "chat:legacy")).imported, "skipped");
  assert.equal(f.store.list().length, 0);
});

test("one maximum-render-size synthetic PDF survives bounded chunk storage without inference", async (t) => {
  const f = fixture(t);
  const first = summary();
  const image = Buffer.alloc(40 * 1024 * 1024).toString("base64");
  const documents = [{ id: "pdf", name: "Synthetic.pdf", pages: [{ number: 1, text: "Synthetic", image }] }];
  await f.page().saveConversation(first, [{ role: "user", content: "Q", documentIds: ["pdf"] }], documents);
  assert.equal(f.uploads(), Math.ceil(image.length / (4 * 1024 * 1024)));
  assert.equal(f.store.list()[0].title, "Synthetic");
  const start = performance.now();
  f.reopen();
  t.diagnostic(`Synthetic 40 MiB rendered image: database reopen/integrity check ${Math.round(performance.now() - start)} ms on this host.`);
  const reopened = await f.page().loadConversation(first.id);
  assert.equal(reopened.documents[0].pages[0].image.length, image.length);
  assert.equal(reopened.documents[0].pages[0].image, image);
});

test("storage request timeout remains active while a response body is stalled", async () => {
  const window = {};
  let expire;
  let cleared = false;
  vm.runInNewContext(source, { window, crypto: { randomUUID }, AbortController,
    setTimeout: (callback) => { expire = callback; return 1; }, clearTimeout: () => { cleared = true; },
    fetch: async (_url, options) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      if (options.signal.aborted) reject(new Error("aborted"));
      else options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }) }),
  });
  const pending = window.hypermaniaStorage.request("preferences");
  await Promise.resolve();
  assert.equal(cleared, false);
  expire();
  await assert.rejects(pending, /retry saving/);
  assert.equal(cleared, true);
});
