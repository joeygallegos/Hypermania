const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { openStorage } = require("../storage");
const source = fs.readFileSync(path.join(__dirname, "../public/preferences.js"), "utf8");

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hypermania-preferences-"));
  const store = openStorage(path.join(directory, "test.sqlite"));
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  let fail = false;
  function page() {
    const events = [];
    const window = {
      dispatchEvent: (event) => events.push(event),
      hypermaniaStorage: { makeId: randomUUID, request: async (_route, method, payload) => {
        if (fail) throw new Error("Storage unavailable");
        return method === "PUT" ? store.saveSettings("preferences", payload) : store.settings("preferences");
      } },
    };
    vm.runInNewContext(source, { window, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } });
    return { preferences: window.hypermaniaPreferences, events };
  }
  return { page, fail: (value) => { fail = value; } };
}

test("server preferences load before use and preserve custom and intentionally blank instructions", async (t) => {
  const f = setup(t);
  const first = f.page().preferences;
  await first.ready;
  assert.match(first.getSystemInstruction(), /Always respond in English/);
  assert.equal(await first.setSystemInstruction("Use concise answers."), true);
  const second = f.page().preferences;
  await second.ready;
  assert.equal(second.getSystemInstruction(), "Use concise answers.");
  await second.setSystemInstruction("");
  assert.equal(second.getSystemInstruction(), "");
  assert.equal(await first.setSystemInstruction("stale"), false);
  assert.match(first.error, /another browser/);
  await first.reload();
  assert.equal(first.getSystemInstruction(), "");
});

test("Keep working remembers both choices across pages and failed saves remain visibly unsaved", async (t) => {
  const f = setup(t);
  const { preferences, events } = f.page();
  await preferences.ready;
  assert.equal(preferences.getKeepWorking(), true);
  await preferences.setKeepWorking(false);
  const second = f.page().preferences;
  await second.ready;
  assert.equal(second.getKeepWorking(), false);
  f.fail(true);
  assert.equal(await second.setKeepWorking(true), false);
  assert.equal(second.getKeepWorking(), false);
  f.fail(false);
  assert.equal(await second.setKeepWorking(true), true);
  await preferences.reload();
  assert.equal(preferences.getKeepWorking(), true);
  assert.equal(events.length, 0);
});

test("failed initial load uses defaults without silently saving them and can recover", async (t) => {
  const f = setup(t);
  f.fail(true);
  const { preferences, events } = f.page();
  assert.equal(await preferences.ready, false);
  assert.equal(preferences.getKeepWorking(), true);
  assert.equal(await preferences.setModel("test"), false);
  assert.equal(events.at(-1).type, "preference-error");
  f.fail(false);
  assert.equal(await preferences.reload(), true);
  assert.equal(await preferences.setModel("test"), true);
});

test("a delayed reload cannot replace a preference write acknowledged after that reload began", async () => {
  let revision = 0;
  let value = { systemInstruction: "Old", keepWorking: "true" };
  let defer = false;
  let release;
  const window = { dispatchEvent() {}, hypermaniaStorage: { makeId: randomUUID,
    request: async (_route, method, payload) => {
      if (method === "PUT") {
        assert.equal(payload.revision, revision);
        value = { ...value, ...payload.value }; revision++;
        return { revision, value };
      }
      const snapshot = { revision, value: { ...value } };
      if (defer) return new Promise((resolve) => { release = () => resolve(snapshot); });
      return snapshot;
    },
  } };
  vm.runInNewContext(source, { window, CustomEvent: class {} });
  const preferences = window.hypermaniaPreferences;
  await preferences.ready;
  defer = true;
  const reload = preferences.reload();
  await preferences.setSystemInstruction("Newer");
  release();
  assert.equal(await reload, false);
  assert.equal(preferences.getSystemInstruction(), "Newer");
  assert.equal(await preferences.setKeepWorking(false), true);
});
