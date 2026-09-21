const HYPERMANIA_PREFERENCES = {
  model: "hypermania.model",
  thinkMode: "hypermania.thinkMode",
  contextSize: "hypermania.contextSize",
};

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Preferences are optional when browser storage is unavailable.
  }
}

window.hypermaniaPreferences = {
  getModel: () => readPreference(HYPERMANIA_PREFERENCES.model, ""),
  setModel: (value) => writePreference(HYPERMANIA_PREFERENCES.model, value),
  getThinkMode: () => readPreference(HYPERMANIA_PREFERENCES.thinkMode, "auto"),
  setThinkMode: (value) => writePreference(HYPERMANIA_PREFERENCES.thinkMode, value),
  getContextSize: () => readPreference(HYPERMANIA_PREFERENCES.contextSize, "8192"),
  setContextSize: (value) => writePreference(HYPERMANIA_PREFERENCES.contextSize, value),
};
