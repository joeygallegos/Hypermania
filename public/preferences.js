const HYPERMANIA_PREFERENCES = {
  model: "hypermania.model",
  thinkMode: "hypermania.thinkMode",
  contextSize: "hypermania.contextSize",
  systemInstruction: "hypermania.systemInstruction",
};

const DEFAULT_SYSTEM_INSTRUCTION = "Always respond in English unless the user asks for another language.";

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

function readOptionalPreference(key, fallback) {
  // Unlike select preferences, an intentionally blank system instruction is a
  // valid choice and must not be replaced with the default on the next page.
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

window.hypermaniaPreferences = {
  getModel: () => readPreference(HYPERMANIA_PREFERENCES.model, ""),
  setModel: (value) => writePreference(HYPERMANIA_PREFERENCES.model, value),
  getThinkMode: () => readPreference(HYPERMANIA_PREFERENCES.thinkMode, "auto"),
  setThinkMode: (value) => writePreference(HYPERMANIA_PREFERENCES.thinkMode, value),
  getContextSize: () => readPreference(HYPERMANIA_PREFERENCES.contextSize, "8192"),
  setContextSize: (value) => writePreference(HYPERMANIA_PREFERENCES.contextSize, value),
  getSystemInstruction: () => readOptionalPreference(
    HYPERMANIA_PREFERENCES.systemInstruction,
    DEFAULT_SYSTEM_INSTRUCTION
  ),
  setSystemInstruction: (value) => writePreference(HYPERMANIA_PREFERENCES.systemInstruction, value),
};
