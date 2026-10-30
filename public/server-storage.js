(() => {
  const CHUNK_CHARS = 4 * 1024 * 1024;
  const MAX_BLOB_CHARS = 64 * 1024 * 1024;
  function makeId() {
    return typeof crypto.randomUUID === "function" ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
        const random = Math.floor(Math.random() * 16);
        return (letter === "x" ? random : (random & 3) | 8).toString(16);
      });
  }
  async function request(route, method = "GET", body) {
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      response = await fetch(`/api/storage/${route}`, { method, cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Hypermania-Storage": "1" },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "Server storage could not complete the request.");
        error.status = response.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.status) throw error;
      throw new Error("Could not reach server storage. Your work is still in this page; retry saving.");
    } finally { clearTimeout(timeout); }
  }
  // Caches are page-local only. The browser is never a second durable store.
  const blobCache = new Map();
  const pendingSaves = new Map();
  let cachedOwner = null;
  function useOwner(owner) {
    if (cachedOwner === owner) return;
    // Retain only the current chat's image strings; browsing large histories
    // must not keep every previously opened conversation alive in mobile RAM.
    blobCache.clear();
    pendingSaves.clear();
    cachedOwner = owner;
  }
  async function prepare(owner, history, documents, imported = false) {
    useOwner(owner);
    let sequence = 0;
    const lengths = {};
    const digests = {};
    const uploads = [];
    async function upload(content) {
      if (!content) return "";
      if (content.length > MAX_BLOB_CHARS) throw new Error("An attachment exceeds the 64 MiB encoded image limit. No data was truncated.");
      const key = `${owner}:${sequence++}`;
      let cached = blobCache.get(key);
      if (imported || !cached || cached.content !== content) {
        const id = imported ? `import-${sequence}` : makeId();
        const hashes = [];
        for (let offset = 0, part = 0; offset < content.length; offset += CHUNK_CHARS, part++) {
          const chunk = content.slice(offset, offset + CHUNK_CHARS);
          // Imports fingerprint originals before writing so an already imported
          // record stays skipped even when its server copy has since been deleted.
          const result = imported ? await request("hash", "POST", { content: chunk })
            : await request(`chunks/${owner}/${id}/${part}`, "PUT", { content: chunk });
          if (imported) uploads.push({ id, part, content: chunk });
          hashes.push(result.hash);
        }
        cached = { id, content, hashes };
        blobCache.set(key, cached);
      }
      lengths[cached.id] = content.length;
      digests[cached.id] = cached.hashes;
      return cached.id;
    }
    const messages = [];
    for (const message of history) {
      const next = { ...message };
      if (message.images) {
        next.images = [];
        for (const image of message.images) next.images.push(await upload(image));
      }
      messages.push(next);
    }
    const savedDocuments = [];
    for (const document of documents) {
      const pages = [];
      for (const page of document.pages) pages.push({ ...page, image: await upload(page.image) });
      savedDocuments.push({ ...document, pages });
    }
    return { history: messages, documents: savedDocuments, blobLengths: lengths, digests, uploads };
  }
  async function loadConversation(id) {
    useOwner(id);
    const record = await request(`conversations/${id}`);
    let sequence = 0;
    async function download(blob) {
      if (!blob) return "";
      const key = `${id}:${sequence++}`;
      const length = record.blobLengths[blob];
      const cached = blobCache.get(key);
      if (cached?.id === blob) return cached.content;
      const chunks = [];
      for (let part = 0; part < Math.ceil(length / CHUNK_CHARS); part++) {
        chunks.push((await request(`chunks/${id}/${blob}/${part}`)).content);
      }
      const content = chunks.join("");
      if (content.length !== length) throw new Error("This saved attachment is incomplete.");
      blobCache.set(key, { id: blob, content, hashes: [] });
      return content;
    }
    for (const message of record.history) if (message.images) {
      const images = [];
      for (const image of message.images) images.push(await download(image));
      message.images = images;
    }
    for (const document of record.documents) for (const page of document.pages) page.image = await download(page.image);
    return record;
  }
  async function saveConversation(summary, history, documents, importSource) {
    const prepared = await prepare(summary.id, history, documents, Boolean(importSource));
    const { digests, uploads, ...context } = prepared;
    const payload = { summary, revision: summary.revision || 0, schemaVersion: 2, ...context };
    if (importSource) {
      payload.importSource = importSource;
      payload.importFingerprint = (await request("hash", "POST", {
        content: JSON.stringify({ summary, ...context, digests }),
      })).hash;
      const existing = await request("import/check", "POST", { source: importSource, fingerprint: payload.importFingerprint });
      if (existing.skipped) return { id: summary.id, imported: "skipped" };
      for (const upload of uploads) await request(`chunks/${summary.id}/${upload.id}/${upload.part}`, "PUT", { content: upload.content });
    }
    const serialized = JSON.stringify(payload);
    let pending = pendingSaves.get(summary.id);
    if (!pending || pending.serialized !== serialized) {
      pending = { serialized, payload: { ...payload, mutationId: makeId() } };
      pendingSaves.set(summary.id, pending);
    }
    const result = await request(`conversations/${summary.id}`, "PUT", pending.payload);
    pendingSaves.delete(summary.id);
    return result;
  }
  window.hypermaniaStorage = { request, makeId, loadConversation, saveConversation };
})();
