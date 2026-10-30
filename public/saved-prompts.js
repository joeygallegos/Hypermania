(() => {
  const get = (id) => document.getElementById(id);
  let revision = 0;
  let busy = false;
  let loaded = false;
  let pendingCommit = null;
  let prompts = [];
  let selectedId = null;
  let baseline = { title: "", content: "" };

  function report(message, failed = false) {
    get("savedPromptsStatus").textContent = message;
    get("savedPromptsStatus").setAttribute("role", failed ? "alert" : "status");
  }

  async function attempt(action) {
    if (busy) return;
    busy = true;
    get("savedPromptTitle").disabled = true;
    get("savedPromptContent").disabled = true;
    try { await action(); }
    catch (error) {
      report(error.message || "Could not read or save prompts. Your edits are still here.", true);
    } finally {
      busy = false;
      get("savedPromptTitle").disabled = false;
      get("savedPromptContent").disabled = false;
    }
  }

  function hasEdits() {
    return get("savedPromptTitle").value !== baseline.title || get("savedPromptContent").value !== baseline.content;
  }

  function canDiscard() {
    return !busy && (!hasEdits() || window.confirm("Discard unsaved prompt changes?"));
  }

  function edit(item) {
    selectedId = item?.id || null;
    const current = item?.versions.at(-1);
    baseline = { title: current?.title || "", content: current?.content || "" };
    get("savedPromptTitle").value = baseline.title;
    get("savedPromptContent").value = baseline.content;
    get("deleteSavedPrompt").disabled = !item;
    get("savedPromptVersions").replaceChildren();
    // Render stored text literally. Prompts may contain HTML, code, or untrusted instructions.
    for (const [index, version] of Array.from((item?.versions || []).entries()).reverse()) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `Version ${index + 1} · ${new Date(version.savedAt).toLocaleString()} · ${version.title}`;
      const text = document.createElement("pre");
      text.textContent = version.content;
      details.append(summary, text);
      get("savedPromptVersions").append(details);
    }
    get("savedPromptHistory").hidden = !item;
    renderList();
  }

  function renderList() {
    get("savedPromptList").replaceChildren();
    get("emptySavedPrompts").hidden = prompts.length > 0;
    for (const item of prompts) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = item.versions.at(-1).title;
      if (item.id === selectedId) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => {
        if (canDiscard()) { edit(item); report(""); }
      });
      row.append(button);
      get("savedPromptList").append(row);
    }
  }

  async function loadLibrary() {
    return attempt(async () => {
      const result = await window.hypermaniaStorage.request("prompts");
      if (!window.hypermaniaPromptLibrary.isValidPromptCollection(result.value)) throw new Error("Saved prompts could not be read.");
      revision = result.revision;
      prompts = result.value;
      loaded = true;
      pendingCommit = null;
      edit(null);
      report("");
      get("savedPromptTitle").focus();
    });
  }
  async function commit(next) {
    if (!loaded) throw new Error("Reload prompts before saving. Your edits are still here.");
    const key = JSON.stringify({ selectedId, title: get("savedPromptTitle").value, content: get("savedPromptContent").value, deleting: !next.some((item) => item.id === selectedId) });
    // A retry after a lost response must submit the original version timestamp,
    // ID, and revision so the server can return its durable mutation receipt.
    if (!pendingCommit || pendingCommit.key !== key) pendingCommit = {
      key, payload: { revision, value: next, mutationId: window.hypermaniaStorage.makeId() },
    };
    const result = await window.hypermaniaStorage.request("prompts", "PUT", pendingCommit.payload);
    pendingCommit = null;
    revision = result.revision;
    prompts = result.value;
  }
  get("reloadSavedPrompts").addEventListener("click", () => { if (canDiscard()) return loadLibrary(); });
  // Navigation, refresh, and closing the page must not silently discard editor changes.
  window.addEventListener("beforeunload", (event) => {
    if (!busy && !hasEdits()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  get("newSavedPrompt").addEventListener("click", () => {
    if (canDiscard()) { edit(null); report(""); get("savedPromptTitle").focus(); }
  });
  get("savedPromptForm").addEventListener("submit", (event) => {
    event.preventDefault();
    // Native required fields allow whitespace; explain this case without reporting a storage failure.
    if (!get("savedPromptTitle").value.trim() || !get("savedPromptContent").value.trim()) {
      report("Enter a prompt name and prompt text.", true);
      return;
    }
    return attempt(async () => {
      const title = get("savedPromptTitle").value.trim();
      const content = get("savedPromptContent").value;
      const current = prompts.find((item) => item.id === selectedId);
      const previous = current?.versions.at(-1);
      if (previous?.title === title && previous.content === content) { report("Prompt unchanged."); return; }
      const version = { title, content, savedAt: new Date().toISOString() };
      const next = current
        ? prompts.map((item) => item.id === selectedId ? { ...item, versions: [...item.versions, version] } : item)
        : [...prompts, { id: window.hypermaniaStorage.makeId(), versions: [version] }];
      if (!window.hypermaniaPromptLibrary.isValidPromptCollection(next)) throw new Error("Enter a name up to 120 characters and prompt text up to 50,000 characters.");
      await commit(next);
      edit(prompts.find((item) => item.id === selectedId) || prompts.at(-1));
      report("Prompt saved.");
    });
  });
  get("deleteSavedPrompt").addEventListener("click", () => {
    if (busy || !selectedId || !window.confirm("Delete this saved prompt and all its versions? This cannot be undone.")) return;
    return attempt(async () => {
      await commit(prompts.filter((item) => item.id !== selectedId));
      edit(null);
      report("Prompt deleted.");
    });
  });
  get("copySavedPrompt").addEventListener("click", async () => {
    const text = get("savedPromptContent").value;
    if (!text.trim()) { report("Enter prompt text first.", true); return; }
    try {
      await navigator.clipboard.writeText(text);
      report("Prompt copied. Paste it into chat when ready.");
    } catch {
      // Clipboard access can be blocked on HTTP network hosts; retain a manual copy path.
      get("savedPromptContent").focus();
      get("savedPromptContent").select();
      report("Automatic copy is unavailable. The prompt text is selected; copy it manually.", true);
    }
  });
  window.hypermaniaPromptsReady = loadLibrary();
})();
