(() => {
  const get = (id) => document.getElementById(id);
  const api = window.hypermaniaStorage;
  function resultOf(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Legacy browser chats could not be read."));
    });
  }
  async function readChats() {
    if (typeof indexedDB === "undefined") return null;
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("hypermania-chats", 1);
      let absent = false;
      // Opening a missing legacy database must not create a replacement store.
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onerror = () => absent ? resolve(null) : reject(new Error("Legacy browser chats could not be read."));
      request.onblocked = () => reject(new Error("Close other Hypermania tabs before importing chats."));
      request.onsuccess = () => resolve(request.result);
    });
    if (!database) return null;
    if (!database.objectStoreNames.contains("conversations") || !database.objectStoreNames.contains("conversationData")) {
      database.close(); throw new Error("Legacy browser chat storage is incomplete; it was left untouched.");
    }
    return database;
  }
  get("importBrowserData").addEventListener("click", async () => {
    const button = get("importBrowserData");
    const status = get("browserImportStatus");
    button.disabled = true;
    let database;
    try {
      database = await readChats();
      const chats = database ? await resultOf(database.transaction("conversations").objectStore("conversations").getAll()) : [];
      let prompts = [];
      let promptWarning = "";
      try {
        const raw = window.localStorage.getItem("hypermania.prompts.v1");
        prompts = raw === null ? [] : JSON.parse(raw);
        if (!Array.isArray(prompts)) throw new Error("Invalid library.");
      } catch { promptWarning = "Legacy browser prompts are unavailable or damaged; their originals were preserved."; prompts = []; }
      if (!window.confirm(`Import ${chats.length} chats and ${prompts.length} prompts into shared server storage? Everyone using this server can access them. Existing browser data will remain.`)) return;
      let imported = 0, skipped = 0, failed = promptWarning ? 1 : 0;
      const failures = promptWarning ? [promptWarning] : [];
      for (const summary of chats) {
        try {
          const record = await resultOf(database.transaction("conversationData").objectStore("conversationData").get(summary.id));
          const documents = record?.schemaVersion === 2 ? record.documents : [];
          if (!window.hypermaniaChatHistory.isValidConversationSummary(summary)
            || ![1, 2].includes(record?.schemaVersion)
            || !window.hypermaniaDocumentContext.isValidDocumentContext(record.history, documents)) {
            throw new Error("Invalid legacy chat.");
          }
          const source = `chat:${summary.id}`;
          const id = (await api.request("hash", "POST", { content: source })).hash;
          // A stable mapped thread ID keeps repeated schema-v1 imports identical.
          const originalThread = summary.threadId || summary.id;
          const stableThread = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(originalThread)
            ? originalThread : `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
          const result = await api.saveConversation({ ...summary, id, threadId: stableThread, revision: 0 }, record.history, documents, source);
          if (result.imported === "skipped") skipped++; else imported++;
        } catch (error) { failed++; failures.push(`Chat: ${error.message}`); }
        status.textContent = `${imported} imported, ${skipped} already imported, ${failed} need attention.`;
      }
      for (const prompt of prompts) {
        try {
          if (!window.hypermaniaPromptLibrary.isValidPromptCollection([prompt])) throw new Error("Invalid legacy prompt; its original was preserved.");
          const source = `prompt:${prompt.id}`;
          const id = (await api.request("hash", "POST", { content: source })).hash;
          const record = { ...prompt, id };
          const fingerprint = (await api.request("hash", "POST", { content: JSON.stringify(record) })).hash;
          const result = await api.request("import/prompt", "POST", { source, fingerprint, record, mutationId: api.makeId() });
          if (result.skipped) skipped++; else imported++;
        } catch (error) { failed++; failures.push(`Prompt: ${error.message}`); }
      }
      if (get("importPreferences").checked) {
        // Preference import uses the revision loaded when Settings opened. It
        // cannot overwrite changes made by another browser since that time.
        const preferences = window.hypermaniaPreferences;
        for (const key of ["model", "thinkMode", "contextSize", "systemInstruction", "keepWorking"]) {
          const value = window.localStorage.getItem(`hypermania.${key}`);
          if (value === null) continue;
          const setter = preferences[`set${key[0].toUpperCase()}${key.slice(1)}`];
          if (await setter(key === "keepWorking" ? value !== "false" : value)) imported++;
          else { failed++; failures.push("preference"); }
        }
      }
      status.textContent = `${imported} imported, ${skipped} already imported, ${failed} need attention. Browser originals remain untouched.${failed ? ` ${failures.slice(0, 5).join(" ")} Conflicting records were not replaced; copy or reconcile the originals manually.` : " Reload chats or prompts to see imported records."}`;
    } catch (error) { status.textContent = error.message; }
    finally { database?.close(); button.disabled = false; }
  });
})();
