const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "preferences.js"), "utf8");

function loadPreferences(initialEntries = {}) {
  const entries = new Map(Object.entries(initialEntries));
  const context = {
    window: {},
    localStorage: {
      getItem: (key) => entries.has(key) ? entries.get(key) : null,
      setItem: (key, value) => entries.set(key, String(value)),
    },
  };
  vm.runInNewContext(source, context);
  return { preferences: context.window.hypermaniaPreferences, entries };
}

test("system instruction defaults to English guidance", () => {
  const { preferences } = loadPreferences();

  assert.equal(
    preferences.getSystemInstruction(),
    "Always respond in English unless the user asks for another language."
  );
});

test("system instruction persists custom and intentionally blank values", () => {
  const { preferences, entries } = loadPreferences();

  preferences.setSystemInstruction("Use concise answers.");
  assert.equal(entries.get("hypermania.systemInstruction"), "Use concise answers.");
  assert.equal(preferences.getSystemInstruction(), "Use concise answers.");

  preferences.setSystemInstruction("");
  assert.equal(preferences.getSystemInstruction(), "");
});

test("Keep working defaults on, remembers both choices, and tolerates unavailable storage", () => {
  const { preferences, entries } = loadPreferences();
  assert.equal(preferences.getKeepWorking(), true);
  preferences.setKeepWorking(false);
  assert.equal(entries.get("hypermania.keepWorking"), "false");
  assert.equal(loadPreferences(Object.fromEntries(entries)).preferences.getKeepWorking(), false);
  preferences.setKeepWorking(true);
  assert.equal(loadPreferences(Object.fromEntries(entries)).preferences.getKeepWorking(), true);
  const context = { window: {}, localStorage: {
    getItem() { throw new Error("unavailable"); },
    setItem() { throw new Error("unavailable"); },
  } };
  vm.runInNewContext(source, context);
  assert.equal(context.window.hypermaniaPreferences.getKeepWorking(), true);
  assert.doesNotThrow(() => context.window.hypermaniaPreferences.setKeepWorking(false));
});
