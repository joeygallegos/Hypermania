(() => {
  const get = (id) => document.getElementById(id);
  let library;
  let prompts = [];
  let selectedId = null;
  let baseline = { title: "", content: "" };

  function report(message, failed = false) {
    get("savedPromptsStatus").textContent = message;
    get("savedPromptsStatus").setAttribute("role", failed ? "alert" : "status");
  }

  function attempt(action) {
    try { action(); }
    catch (error) {
      // Storage exceptions may contain browser-specific details; show a safe recovery message.
      report(error.message.startsWith("Saved prompts changed") ? error.message
        : "Could not read or save prompts. Browser storage may be unavailable, full, or damaged. Your edits are still here.", true);
    }
  }

  function hasEdits() {
    return get("savedPromptTitle").value !== baseline.title || get("savedPromptContent").value !== baseline.content;
  }

  function canDiscard() {
    return !hasEdits() || window.confirm("Discard unsaved prompt changes?");
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

  function loadLibrary() {
    report("");
    library = null;
    attempt(() => {
      library = window.hypermaniaPromptLibrary.createLibrary(window.localStorage, () => {
        // Prompt IDs need local uniqueness, including on trusted-network HTTP origins.
        return typeof crypto.randomUUID === "function" ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      });
      prompts = library.load();
      edit(null);
      get("savedPromptTitle").focus();
    });
  }
  get("reloadSavedPrompts").addEventListener("click", () => { if (canDiscard()) loadLibrary(); });
  // Navigation, refresh, and closing the page must not silently discard editor changes.
  window.addEventListener("beforeunload", (event) => {
    if (!hasEdits()) return;
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
    attempt(() => {
      prompts = library.save(selectedId, get("savedPromptTitle").value, get("savedPromptContent").value);
      edit(prompts.find((item) => item.id === selectedId) || prompts.at(-1));
      report("Prompt saved.");
    });
  });
  get("deleteSavedPrompt").addEventListener("click", () => {
    if (!selectedId || !window.confirm("Delete this saved prompt and all its versions? This cannot be undone.")) return;
    attempt(() => {
      prompts = library.remove(selectedId);
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
  loadLibrary();
})();
