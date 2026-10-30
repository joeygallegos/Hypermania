const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { isValidHistoryMessage, isValidConversationSummary } = require("./public/chat-history");
const { isValidDocumentContext } = require("./public/document-context");
const { isValidPromptCollection } = require("./public/prompt-library");

const DEFAULT_PREFERENCES = {
  model: "", thinkMode: "auto", contextSize: "8192",
  systemInstruction: "Always respond in English unless the user asks for another language.", keepWorking: "true",
};
const CHUNK_CHARS = 4 * 1024 * 1024;
// A rendered PDF can contain 40 MiB of image bytes before base64 expansion.
// These explicit encoded-size ceilings preserve that input without treating
// arbitrary browser-supplied image strings as unlimited server storage.
const MAX_BLOB_CHARS = 64 * 1024 * 1024;
const MAX_CONVERSATION_CHARS = 2 * 1024 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

class StorageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function check(condition, message = "Invalid storage request.", status = 400) {
  if (!condition) throw new StorageError(status, message);
}
function validId(value) { return typeof value === "string" && ID_PATTERN.test(value); }
function validRevision(value) { return Number.isSafeInteger(value) && value >= 0; }
function onlyKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}
function validPreferences(values) {
  return values && typeof values === "object" && !Array.isArray(values)
    && Object.keys(values).every((key) => Object.hasOwn(DEFAULT_PREFERENCES, key))
    && Object.entries(values).every(([key, value]) => typeof value === "string" && (
      key === "model" ? value.length <= 255
        : key === "systemInstruction" ? value.length <= 4000
          : key === "thinkMode" ? ["auto", "off", "on", "low", "medium", "high"].includes(value)
            : key === "contextSize" ? ["4096", "8192", "16384", "32768"].includes(value)
              : ["true", "false"].includes(value)));
}

function openStorage(filename) {
  check(path.isAbsolute(filename), "Storage path must be absolute.");
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    // Never recreate an unreadable database. SQLite owns crash recovery, while
    // schema versions prevent a newer store from being opened by older code.
    db.exec("PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
    check(db.prepare("PRAGMA quick_check").get().quick_check === "ok", "Storage integrity check failed.", 503);
    const version = db.prepare("PRAGMA user_version").get().user_version;
    check(version === 0 || version === 1, "Unsupported storage version.", 503);
    if (version === 0) check(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get(),
      "This file belongs to another database; it was not changed.", 503);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
        summary TEXT NOT NULL, context TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blobs (owner TEXT NOT NULL, id TEXT NOT NULL, part INTEGER NOT NULL,
        content TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(owner,id,part));
      CREATE TABLE IF NOT EXISTS blob_refs (owner TEXT NOT NULL, id TEXT NOT NULL,
        PRIMARY KEY(owner,id), FOREIGN KEY(owner) REFERENCES conversations(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mutations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS imports (source TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
    // DELETE journaling keeps the stopped-service backup procedure simple and
    // avoids WAL files being omitted by an operator copying a live database.
    fs.chmodSync(filename, 0o600);
  } catch (error) { db.close(); throw error; }

  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = action(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function mutate(payload, action, settingsName) {
    check(validId(payload?.mutationId), "A mutation ID is required.");
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    return transaction(() => {
      const prior = db.prepare("SELECT * FROM mutations WHERE id=?").get(payload.mutationId);
      if (prior) {
        check(prior.fingerprint === fingerprint, "This retry differs from its original request.", 409);
        const receipt = JSON.parse(prior.result);
        return receipt.setting ? settings(receipt.setting) : receipt;
      }
      const result = action();
      // Settings receipts need no duplicate copy of every prompt version. A
      // replay returns the current committed snapshot without applying again.
      db.prepare("INSERT INTO mutations VALUES (?,?,?)").run(payload.mutationId, fingerprint,
        JSON.stringify(settingsName ? { setting: settingsName } : result));
      return result;
    });
  }
  function settings(name) {
    const row = db.prepare("SELECT revision,value FROM settings WHERE name=?").get(name);
    return row ? { revision: row.revision, value: JSON.parse(row.value) }
      : { revision: 0, value: name === "preferences" ? { ...DEFAULT_PREFERENCES } : [] };
  }
  function saveSettings(name, payload) {
    check(onlyKeys(payload, ["revision", "value", "mutationId"]));
    check(validRevision(payload?.revision));
    check(name === "preferences" ? validPreferences(payload.value) : isValidPromptCollection(payload.value));
    return mutate({ ...payload, operation: name }, () => {
      const current = settings(name);
      check(current.revision === payload.revision, "Saved data changed in another browser. Copy your edits and reload before saving.", 409);
      const value = name === "preferences" ? { ...current.value, ...payload.value } : payload.value;
      // An unchanged save must not advance revisions or add misleading versions.
      if (JSON.stringify(current.value) === JSON.stringify(value)) return current;
      const result = { revision: current.revision + 1, value };
      db.prepare("INSERT INTO settings VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,value=excluded.value")
        .run(name, result.revision, JSON.stringify(value));
      return result;
    }, name);
  }
  function getConversation(id) {
    check(validId(id));
    const row = db.prepare("SELECT summary,context FROM conversations WHERE id=?").get(id);
    check(row, "This chat no longer exists.", 404);
    return { summary: JSON.parse(row.summary), ...JSON.parse(row.context) };
  }
  function putChunk(owner, id, part, content) {
    check(validId(owner) && validId(id) && Number.isInteger(part) && part >= 0 && part < MAX_BLOB_CHARS / CHUNK_CHARS);
    check(typeof content === "string" && content.length > 0 && content.length <= CHUNK_CHARS);
    return transaction(() => {
      check(!db.prepare("SELECT 1 FROM deleted WHERE id=?").get(owner), "This chat was deleted.", 409);
      const previous = db.prepare("SELECT content FROM blobs WHERE owner=? AND id=? AND part=?").get(owner, id, part);
      if (previous) { check(previous.content === content, "An attachment cannot be changed.", 409); return { hash: createHash("sha256").update(content).digest("hex") }; }
      check(!db.prepare("SELECT 1 FROM blob_refs WHERE owner=? AND id=?").get(owner, id), "An attachment cannot be changed.", 409);
      const size = db.prepare("SELECT coalesce(sum(length(content)),0) AS size FROM blobs WHERE owner=?").get(owner).size;
      check(size + content.length <= MAX_CONVERSATION_CHARS, "This chat exceeds the 2 GiB attachment limit.", 413);
      db.prepare("INSERT INTO blobs VALUES (?,?,?,?,?)").run(owner, id, part, content, Date.now());
      return { hash: createHash("sha256").update(content).digest("hex") };
    });
  }
  function saveConversation(id, payload) {
    check(onlyKeys(payload, ["summary", "revision", "schemaVersion", "history", "documents", "blobLengths", "mutationId", "importSource", "importFingerprint"]));
    check(validId(id) && validRevision(payload?.revision));
    const summary = payload.summary;
    check(onlyKeys(summary, ["id", "threadId", "title", "createdAt", "updatedAt", "model", "revision"])
      && summary.id === id && isValidConversationSummary({ ...summary, revision: 1 })
      && summary.title.length <= 200 && summary.model.length <= 255
      && Number.isFinite(Date.parse(summary.createdAt)) && Number.isFinite(Date.parse(summary.updatedAt)));
    check(payload.schemaVersion === 2 && Array.isArray(payload.history)
      && payload.history.every(isValidHistoryMessage) && isValidDocumentContext(payload.history, payload.documents));
    // The existing context validators also accept strings for images. Here those
    // strings are immutable blob IDs; only this server resolves them to payloads.
    const references = new Set(payload.history.flatMap((message) => message.images || []));
    for (const document of payload.documents) for (const page of document.pages) if (page.image) references.add(page.image);
    check([...references].every(validId));
    check(onlyKeys(payload.blobLengths, [...references]) && [...references].every((blob) =>
      Number.isInteger(payload.blobLengths[blob]) && payload.blobLengths[blob] > 0 && payload.blobLengths[blob] <= MAX_BLOB_CHARS));
    return mutate({ ...payload, id, operation: "conversation" }, () => {
      if (payload.importSource) {
        const previous = checkImport(payload.importSource, payload.importFingerprint);
        if (previous) return { id, imported: "skipped" };
      }
      const current = db.prepare("SELECT revision FROM conversations WHERE id=?").get(id);
      check(!db.prepare("SELECT 1 FROM deleted WHERE id=?").get(id)
        && (current?.revision || 0) === payload.revision, "This chat changed or was deleted in another browser. Copy the response before reloading.", 409);
      for (const blob of references) {
        const parts = db.prepare("SELECT part,length(content) AS size FROM blobs WHERE owner=? AND id=? ORDER BY part").all(id, blob);
        check(parts.length && parts.every((item, index) => item.part === index
          && (index === parts.length - 1 || item.size === CHUNK_CHARS)), "An attachment upload is incomplete.");
        check(payload.blobLengths?.[blob] === parts.reduce((sum, item) => sum + item.size, 0), "An attachment upload is incomplete.");
      }
      const next = { ...summary, revision: payload.revision + 1 };
      const context = { schemaVersion: 2, history: payload.history, documents: payload.documents, blobLengths: payload.blobLengths };
      db.prepare("INSERT INTO conversations VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,summary=excluded.summary,context=excluded.context")
        .run(id, next.revision, JSON.stringify(next), JSON.stringify(context));
      db.prepare("DELETE FROM blob_refs WHERE owner=?").run(id);
      const insert = db.prepare("INSERT INTO blob_refs VALUES (?,?)");
      for (const blob of references) insert.run(id, blob);
      db.prepare("DELETE FROM blobs WHERE owner=? AND id NOT IN (SELECT id FROM blob_refs WHERE owner=?)").run(id, id);
      if (payload.importSource) db.prepare("INSERT INTO imports VALUES (?,?)").run(payload.importSource, payload.importFingerprint);
      return next;
    });
  }
  function deleteConversation(id, payload) {
    check(onlyKeys(payload, ["revision", "mutationId"]));
    check(validId(id) && validRevision(payload?.revision));
    return mutate({ ...payload, id, operation: "delete" }, () => {
      const row = db.prepare("SELECT revision FROM conversations WHERE id=?").get(id);
      check(row && row.revision === payload.revision, "This chat changed or was deleted. Reload before deleting.", 409);
      db.prepare("DELETE FROM conversations WHERE id=?").run(id);
      db.prepare("DELETE FROM blobs WHERE owner=?").run(id);
      // Tombstones prevent stale create/import requests resurrecting deleted chats.
      db.prepare("INSERT OR IGNORE INTO deleted VALUES (?)").run(id);
      return {};
    });
  }
  function checkImport(source, fingerprint) {
    check(typeof source === "string" && source.length > 0 && source.length <= 512
      && typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint));
    const previous = db.prepare("SELECT fingerprint FROM imports WHERE source=?").get(source);
    if (previous) check(previous.fingerprint === fingerprint, "This browser record differs from its previous import; it was not overwritten.", 409);
    return Boolean(previous);
  }
  function importPrompt(payload) {
    check(isValidPromptCollection([payload?.record]));
    return mutate({ ...payload, operation: "importPrompt" }, () => {
      if (checkImport(payload.source, payload.fingerprint)) return { skipped: true };
      const current = settings("prompts");
      check(!current.value.some((item) => item.id === payload.record.id), "A prompt with this ID already exists; it was not overwritten.", 409);
      const next = [...current.value, payload.record];
      check(isValidPromptCollection(next));
      db.prepare("INSERT INTO settings VALUES ('prompts',?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,value=excluded.value")
        .run(current.revision + 1, JSON.stringify(next));
      db.prepare("INSERT INTO imports VALUES (?,?)").run(payload.source, payload.fingerprint);
      return { skipped: false };
    });
  }
  // Only unreferenced uploads expire. Committed payloads never depend on a timer.
  function cleanup() {
    db.prepare("DELETE FROM blobs WHERE created < ? AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.owner=blobs.owner AND r.id=blobs.id)")
      .run(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  function cleanupSafely() {
    // Contention/disk errors may defer staging cleanup; they must not terminate
    // the server or remove referenced content. The next hourly pass retries.
    try { cleanup(); } catch { /* Storage operations report their own failures. */ }
  }
  cleanupSafely();
  const cleanupTimer = setInterval(cleanupSafely, 60 * 60 * 1000);
  cleanupTimer.unref();
  return { close: () => { clearInterval(cleanupTimer); db.close(); }, settings, saveSettings, getConversation, saveConversation,
    deleteConversation, putChunk, cleanup, checkImport, importPrompt,
    list: () => db.prepare("SELECT summary FROM conversations ORDER BY json_extract(summary,'$.updatedAt') DESC").all().map((row) => JSON.parse(row.summary)),
    getChunk(owner, id, part) {
      check(validId(owner) && validId(id) && Number.isInteger(part) && part >= 0);
      const row = db.prepare("SELECT content FROM blobs WHERE owner=? AND id=? AND part=? AND EXISTS (SELECT 1 FROM blob_refs WHERE owner=? AND id=?)").get(owner, id, part, owner, id);
      check(row, "Attachment not found.", 404); return row;
    },
  };
}
module.exports = { openStorage, StorageError, DEFAULT_PREFERENCES, CHUNK_CHARS, MAX_BLOB_CHARS };
