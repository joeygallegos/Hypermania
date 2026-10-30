const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { openStorage, CHUNK_CHARS } = require("../storage");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hypermania-storage-"));
  const filename = path.join(directory, "test.sqlite");
  let store = openStorage(filename);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, filename,
    reopen() { store.close(); store = openStorage(filename); return store; },
    backup(destination) { store.close(); fs.copyFileSync(filename, destination); store = openStorage(filename); } };
}
function chat(id = randomUUID()) {
  return { mutationId: randomUUID(), revision: 0, schemaVersion: 2,
    summary: { id, threadId: randomUUID(), title: "Synthetic chat", model: "test-model", revision: 0,
      createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z" },
    history: [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer", thinking: "Reason", model: "first-model" }],
    documents: [], blobLengths: {} };
}

test("acknowledged data survives restart, preserves context, and supports atomic revisions and tombstones", (t) => {
  const f = fixture(t);
  const payload = chat();
  const id = payload.summary.id;
  const saved = f.store.saveConversation(id, payload);
  assert.equal(saved.revision, 1);
  assert.deepEqual(f.store.saveConversation(id, payload), saved, "lost acknowledgment retry is idempotent");
  assert.equal(f.reopen().getConversation(id).history[1].model, "first-model");
  assert.equal(f.store.list()[0].id, id);
  assert.equal(f.store.list()[0].history, undefined);
  assert.throws(() => f.store.saveConversation(id, { ...payload, mutationId: randomUUID() }), /changed/);
  const deleteRequest = { revision: 1, mutationId: randomUUID() };
  f.store.deleteConversation(id, deleteRequest);
  assert.deepEqual(f.store.deleteConversation(id, deleteRequest), {});
  assert.throws(() => f.store.saveConversation(id, { ...payload, mutationId: randomUUID() }), /deleted/);
  assert.equal(f.reopen().list().length, 0);
});

test("attachment chunks publish with context, stay immutable, and disappear on chat deletion", (t) => {
  const { store } = fixture(t);
  const payload = chat();
  const id = payload.summary.id;
  const blob = randomUUID();
  const image = "A".repeat(CHUNK_CHARS);
  store.putChunk(id, blob, 0, image);
  assert.throws(() => store.getChunk(id, blob, 0), /not found/);
  payload.history[0].images = [blob];
  payload.documents = [{ id: "document", name: "Synthetic.pdf", pages: [{ number: 1, text: "Page text", image: blob }] }];
  payload.history[0].documentIds = ["document"];
  payload.blobLengths[blob] = image.length + 4;
  assert.throws(() => store.saveConversation(id, payload), /incomplete/);
  assert.equal(store.list().length, 0);
  store.putChunk(id, blob, 1, "BBBB");
  store.saveConversation(id, payload);
  assert.equal(store.getChunk(id, blob, 0).content, image);
  assert.throws(() => store.putChunk(id, blob, 1, "CCCC"), /cannot be changed/);
  assert.throws(() => store.putChunk(id, blob, 2, "CCCC"), /cannot be changed/);
  store.deleteConversation(id, { revision: 1, mutationId: randomUUID() });
  assert.throws(() => store.getChunk(id, blob, 0), /not found/);
});

test("shared settings keep blank instructions, reject stale writers, and roll back database failures", (t) => {
  const f = fixture(t);
  const payload = { revision: 0, value: { systemInstruction: "", keepWorking: "false" }, mutationId: randomUUID() };
  f.store.saveSettings("preferences", payload);
  assert.equal(f.reopen().settings("preferences").value.systemInstruction, "");
  assert.throws(() => f.store.saveSettings("preferences", { ...payload, mutationId: randomUUID() }), /another browser/);
  const db = new DatabaseSync(f.filename);
  db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
  assert.throws(() => f.store.saveSettings("preferences", { revision: 1, value: { model: "new" }, mutationId: randomUUID() }), /synthetic failure/);
  assert.equal(f.store.settings("preferences").value.model, "");
  db.close();
});

test("imports preserve prompt versions, skip identical retries, and reject divergent browser originals", (t) => {
  const { store } = fixture(t);
  const record = { id: "mapped-prompt", versions: [{ title: "Old title", content: "First", savedAt: "2025-01-01" }, { title: "New title", content: "Second", savedAt: "2026-01-01" }] };
  const fingerprint = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  const request = { source: "prompt:legacy", fingerprint, record, mutationId: randomUUID() };
  assert.equal(store.importPrompt(request).skipped, false);
  assert.equal(store.importPrompt({ ...request, mutationId: randomUUID() }).skipped, true);
  assert.deepEqual(store.settings("prompts").value[0], record);
  assert.throws(() => store.importPrompt({ ...request, mutationId: randomUUID(), fingerprint: "f".repeat(64) }), /differs/);
});

test("invalid input cannot mutate stored data and a corrupt database is preserved", (t) => {
  const f = fixture(t);
  for (const value of [{ contextSize: "1" }, { keepWorking: "maybe" }, { secret: "unexpected" }, []]) {
    assert.throws(() => f.store.saveSettings("preferences", { revision: 0, value, mutationId: randomUUID() }), /Invalid/);
  }
  assert.throws(() => f.store.getConversation("../private"), /Invalid/);
  const payload = chat(); payload.documents = [{ id: "bad" }];
  assert.throws(() => f.store.saveConversation(payload.summary.id, payload), /Invalid/);
  const corrupt = path.join(path.dirname(f.filename), "corrupt.sqlite");
  fs.writeFileSync(corrupt, "preserve this corrupt file");
  assert.throws(() => openStorage(corrupt));
  assert.equal(fs.readFileSync(corrupt, "utf8"), "preserve this corrupt file");
  const foreign = path.join(path.dirname(f.filename), "foreign.sqlite");
  const other = new DatabaseSync(foreign);
  other.exec("CREATE TABLE other_app (value TEXT); INSERT INTO other_app VALUES ('retain');");
  other.close();
  assert.throws(() => openStorage(foreign), /another database/);
  const preserved = new DatabaseSync(foreign);
  try { assert.equal(preserved.prepare("SELECT value FROM other_app").get().value, "retain"); }
  finally { preserved.close(); }
});

test("a stopped-store backup restores acknowledged conversations and preferences", (t) => {
  const f = fixture(t);
  const payload = chat();
  f.store.saveConversation(payload.summary.id, payload);
  f.store.saveSettings("preferences", { revision: 0, value: { systemInstruction: "Backup instruction" }, mutationId: randomUUID() });
  const backup = path.join(path.dirname(f.filename), "backup.sqlite");
  f.backup(backup);
  f.store.deleteConversation(payload.summary.id, { revision: 1, mutationId: randomUUID() });
  const restored = openStorage(backup);
  try {
    assert.equal(restored.list().length, 1);
    assert.equal(restored.settings("preferences").value.systemInstruction, "Backup instruction");
  } finally { restored.close(); }
});

test("an interrupted database writer rolls back its partial transaction on reopening", { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  const payload = chat();
  f.store.saveConversation(payload.summary.id, payload);
  const child = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE; DELETE FROM conversations;');
    process.stdout.write('transaction-open');
    setInterval(() => {}, 1000);
  `, f.filename], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await Promise.race([once(child.stdout, "data"), once(child, "exit").then(() => { throw new Error("Writer exited before opening its transaction."); })]);
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
  assert.equal(f.reopen().list()[0].id, payload.summary.id);
});
