(() => {
  const defaults = {
    model: "", thinkMode: "auto", contextSize: "8192", keepWorking: "true",
    systemInstruction: "Always respond in English unless the user asks for another language.",
  };
  let values = { ...defaults };
  let revision = null;
  let queue = Promise.resolve();
  let activeWrites = 0;
  let pendingWrite = null;
  let writeEpoch = 0;
  const api = window.hypermaniaStorage;
  const preferences = { error: "" };
  function report(error) {
    preferences.error = error.message;
    window.dispatchEvent(new CustomEvent("preference-error", { detail: error.message }));
    return false;
  }
  preferences.reload = async () => {
    // Do not replace the base revision underneath an in-flight local edit.
    if (activeWrites) return false;
    const epoch = writeEpoch;
    try {
      const result = await api.request("preferences");
      // A focus read may finish after a local write; preserve its newer snapshot
      // and retry receipt even if that write did not receive an acknowledgment.
      if (activeWrites || epoch !== writeEpoch || (revision !== null && result.revision < revision)) return false;
      values = { ...defaults, ...result.value };
      revision = result.revision;
      pendingWrite = null;
      preferences.error = "";
      return true;
    } catch (error) { return report(error); }
  };
  function write(key, value) {
    writeEpoch++;
    activeWrites++;
    const saved = queue.then(async () => {
      if (revision === null) throw new Error("Preferences have not loaded. Reload the page before saving settings.");
      if (!pendingWrite || pendingWrite.key !== key || pendingWrite.value !== String(value)) pendingWrite = {
        key, value: String(value), payload: { revision, value: { [key]: String(value) }, mutationId: api.makeId() },
      };
      const result = await api.request("preferences", "PUT", pendingWrite.payload);
      pendingWrite = null;
      values = { ...defaults, ...result.value };
      revision = result.revision;
      preferences.error = "";
      return true;
    }).catch(report).finally(() => { activeWrites--; });
    queue = saved;
    return saved;
  }
  for (const key of Object.keys(defaults)) {
    const suffix = key[0].toUpperCase() + key.slice(1);
    preferences[`get${suffix}`] = () => key === "keepWorking" ? values[key] !== "false" : values[key];
    preferences[`set${suffix}`] = (value) => write(key, key === "keepWorking" ? Boolean(value) : value);
  }
  preferences.ready = preferences.reload();
  window.hypermaniaPreferences = preferences;
})();
