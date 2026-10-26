// Share persistence rules with Node tests without requiring a browser or a new dependency.
(function exposePromptLibrary(root, factory) {
  const helpers = factory();
  if (typeof module === "object" && module.exports) module.exports = helpers;
  else root.hypermaniaPromptLibrary = helpers;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const KEY = "hypermania.prompts.v1";

  function createLibrary(storage, makeId) {
    let snapshot;
    let prompts;

    function load() {
      const raw = storage.getItem(KEY);
      const data = raw === null ? [] : JSON.parse(raw);
      // Reject damaged records rather than silently dropping a user's saved history.
      if (!Array.isArray(data) || new Set(data.map((item) => item?.id)).size !== data.length
        || data.some((item) => !item || typeof item.id !== "string" || !item.id
          || !Array.isArray(item.versions) || !item.versions.length
          || item.versions.some((version) => !version || typeof version.title !== "string"
            || !version.title.trim() || version.title.length > 120
            || typeof version.content !== "string" || !version.content.trim()
            || version.content.length > 50000 || typeof version.savedAt !== "string"
            || !Number.isFinite(Date.parse(version.savedAt))))) {
        throw new Error("Saved prompts could not be read.");
      }
      snapshot = raw;
      prompts = data;
      return structuredClone(prompts);
    }

    function commit(next) {
      // Recheck before writing so an older open editor cannot replace another tab's edits.
      // localStorage has no cross-tab transaction; simultaneous writes remain best effort.
      if (storage.getItem(KEY) !== snapshot) {
        throw new Error("Saved prompts changed in another tab. Copy any unsaved edits, then choose Reload prompts before trying again.");
      }
      const raw = JSON.stringify(next);
      storage.setItem(KEY, raw);
      // Publish in-memory changes only after persistence succeeds (including quota checks).
      snapshot = raw;
      prompts = next;
      return structuredClone(prompts);
    }

    function save(id, title, content) {
      title = title.trim();
      if (!title || title.length > 120 || !content.trim() || content.length > 50000) {
        throw new Error("Enter a name (up to 120 characters) and prompt text (up to 50,000 characters).");
      }
      const existing = prompts.find((item) => item.id === id);
      if (id && !existing) throw new Error("This prompt no longer exists. Reload prompts.");
      const previous = existing?.versions.at(-1);
      // Saving unchanged text must not create misleading history entries.
      if (previous?.title === title && previous.content === content) return structuredClone(prompts);
      const version = { title, content, savedAt: new Date().toISOString() };
      return commit(existing
        ? prompts.map((item) => item.id === id ? { ...item, versions: [...item.versions, version] } : item)
        : [...prompts, { id: makeId(), versions: [version] }]);
    }

    function remove(id) {
      return commit(prompts.filter((item) => item.id !== id));
    }

    return { load, save, remove };
  }

  return { createLibrary };
}));
