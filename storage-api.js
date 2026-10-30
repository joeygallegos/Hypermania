const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { openStorage, StorageError } = require("./storage");

function createStorageApi({ readBody, log, filename = process.env.HYPERMANIA_DATA_FILE || path.join(__dirname, "data", "hypermania.sqlite"), publicOrigin = process.env.HYPERMANIA_ORIGIN }) {
  if (!path.isAbsolute(filename)) throw new Error("HYPERMANIA_DATA_FILE must be an absolute file path.");
  const resolved = path.resolve(filename);
  function canonical(candidate) {
    let parent = candidate;
    while (!fs.existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
    return path.resolve(fs.realpathSync(parent), path.relative(parent, candidate));
  }
  function within(root, candidate) {
    const relative = path.relative(root, candidate);
    // path.relative honors Windows' case-insensitive path comparison.
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }
  for (const root of [path.join(__dirname, "public"), path.join(__dirname, "node_modules", "katex", "dist")]) {
    if (within(root, resolved) || within(canonical(root), canonical(resolved))) throw new Error("The storage file must be outside static asset directories.");
  }
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error("HYPERMANIA_ORIGIN must be an exact HTTP(S) origin without a trailing slash.");
  if (publicOrigin && !/^https?:\/\//.test(publicOrigin)) throw new Error("HYPERMANIA_ORIGIN must use HTTP(S).");
  let store;
  try { store = openStorage(filename); }
  catch { console.error("Server storage is unavailable. Check the data file and permissions; existing data was preserved."); }

  async function handleStorage(req, res) {
    const reply = (status, payload) => {
      const body = JSON.stringify(payload);
      // Stored content is private to this origin. Do not use the proxy's
      // wildcard-CORS helper, even for errors or preflight responses.
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(body);
    };
    try {
      const origin = req.headers.origin;
      // TLS-terminating proxies must configure their public origin explicitly.
      // Untrusted forwarded headers never establish an allowed browser origin.
      const ownOrigin = publicOrigin || `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
      if ((origin && origin !== ownOrigin) || req.headers["sec-fetch-site"] === "cross-site") {
        throw new StorageError(403, "Storage is available only from this Hypermania address.");
      }
      if (!["GET", "POST", "PUT", "DELETE"].includes(req.method)) throw new StorageError(405, "Method not allowed.");
      // Requiring a non-simple header on reads as well as writes prevents
      // cross-site forms/resources from using endpoints without a preflight.
      if (req.headers["x-hypermania-storage"] !== "1") throw new StorageError(403, "Storage request header is required.");
      if (!store) throw new StorageError(503, "Server storage is unavailable. Check the data file and permissions, then restart Hypermania.");
      const url = new URL(req.url, "http://storage.local");
      const parts = url.pathname.slice("/api/storage/".length).split("/");
      let payload;
      if (req.method !== "GET") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new StorageError(415, "JSON content is required.");
        const limit = parts[0] === "chunks" ? 5 * 1024 * 1024 : 64 * 1024 * 1024;
        try { payload = JSON.parse((await readBody(req, limit)).toString("utf8")); }
        catch (error) { throw new StorageError(error.statusCode || 400, error.statusCode === 413 ? "Storage request is too large." : "Invalid JSON storage request."); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new StorageError(400, "Invalid storage request.");
      }
      let result;
      if (parts.length === 1 && ["preferences", "prompts"].includes(parts[0])) {
        if (req.method === "GET") result = store.settings(parts[0]);
        else if (req.method === "PUT") result = store.saveSettings(parts[0], payload);
      } else if (parts[0] === "conversations" && parts.length <= 2) {
        if (parts.length === 1 && req.method === "GET") result = store.list();
        else if (parts.length === 2 && req.method === "GET") result = store.getConversation(parts[1]);
        else if (parts.length === 2 && req.method === "PUT") result = store.saveConversation(parts[1], payload);
        else if (parts.length === 2 && req.method === "DELETE") result = store.deleteConversation(parts[1], payload);
      } else if (parts[0] === "chunks" && parts.length === 4 && /^\d+$/.test(parts[3])) {
        if (req.method === "PUT") result = store.putChunk(parts[1], parts[2], Number(parts[3]), payload.content);
        else if (req.method === "GET") result = store.getChunk(parts[1], parts[2], Number(parts[3]));
      } else if (parts.join("/") === "import/check" && req.method === "POST") {
        result = { skipped: store.checkImport(payload.source, payload.fingerprint) };
      } else if (parts.join("/") === "import/prompt" && req.method === "POST") {
        result = store.importPrompt(payload);
      } else if (parts.join("/") === "hash" && req.method === "POST" && typeof payload.content === "string") {
        result = { hash: createHash("sha256").update(payload.content).digest("hex") };
      }
      if (result === undefined) throw new StorageError(404, "Storage route not found.");
      reply(200, result);
    } catch (error) {
      const status = error instanceof StorageError ? error.status : 503;
      // SQLite errors can contain file paths or bound data; log only safe codes.
      if (status === 503) await log({ source: "storage", event: "operation_failed", code: String(error.code || "unavailable").slice(0, 80) });
      reply(status, { error: status === 503 ? "Server storage is unavailable. Your work is still in this page; retry saving." : error.message });
    }
  }
  handleStorage.close = () => store?.close();
  return handleStorage;
}
module.exports = { createStorageApi };
