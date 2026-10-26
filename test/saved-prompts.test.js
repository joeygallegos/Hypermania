const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createLibrary } = require("../public/prompt-library.js");

function editor() {
  // DOM doubles cover event wiring and literal rendering; they do not claim to test layout.
  class Element {
    constructor() { this.value = ""; this.children = []; this.listeners = {}; this.attributes = {}; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    dispatchEvent(event) { this.listeners[event.type]?.(event); }
    click() { this.dispatchEvent({ type: "click" }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    focus() {}
    select() { this.selected = true; }
  }
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  let raw = null;
  let fail = false;
  let confirm = true;
  let copied = "";
  const events = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/saved-prompts.js"), "utf8"), {
    document: { getElementById: get, createElement: () => new Element() },
    window: {
      addEventListener: (type, handler) => { events[type] = handler; },
      hypermaniaPromptLibrary: { createLibrary },
      localStorage: {
        getItem: () => raw,
        setItem: (_key, value) => { if (fail) throw new Error("Quota"); raw = value; },
      },
      confirm: () => confirm,
    },
    crypto: { randomUUID: () => "test-prompt" },
    navigator: { clipboard: { writeText: async (text) => { if (fail) throw new Error("Denied"); copied = text; } } },
    Event: class { constructor(type) { this.type = type; } },
  });
  return {
    get,
    events,
    copied: () => copied,
    save(title, content) {
      get("savedPromptTitle").value = title;
      get("savedPromptContent").value = content;
      get("savedPromptForm").dispatchEvent({ type: "submit", preventDefault() {} });
    },
    fail: () => { fail = true; },
    decline: () => { confirm = false; },
  };
}

test("editor renders dated versions literally, newest first, and reopens persisted prompts", () => {
  const { get, save } = editor();
  save("Review", "Original");
  save("Review", "<script>literal</script>");
  assert.equal(get("savedPromptVersions").children.length, 2);
  assert.equal(get("savedPromptVersions").children[0].children[1].textContent, "<script>literal</script>");
  get("reloadSavedPrompts").click();
  get("savedPromptList").children[0].children[0].click();
  assert.equal(get("savedPromptContent").value, "<script>literal</script>");
});

test("copy reuses prompt text and offers manual selection when clipboard is blocked", async () => {
  const { get, save, copied, fail } = editor();
  save("Review", "Saved text");
  await get("copySavedPrompt").listeners.click();
  assert.equal(copied(), "Saved text");
  assert.match(get("savedPromptsStatus").textContent, /Prompt copied/);
  fail();
  await get("copySavedPrompt").listeners.click();
  assert.equal(get("savedPromptContent").selected, true);
  assert.match(get("savedPromptsStatus").textContent, /copy it manually/);
});

test("failed saves retain edits and previous history; deletion removes the prompt", () => {
  const { get, save, fail } = editor();
  save("Review", "Original");
  fail();
  save("Review", "Unsaved edits");
  assert.equal(get("savedPromptContent").value, "Unsaved edits");
  assert.equal(get("savedPromptVersions").children.length, 1);
  assert.equal(get("savedPromptsStatus").attributes.role, "alert");
  const other = editor();
  other.save("Review", "Original");
  other.get("deleteSavedPrompt").click();
  assert.equal(other.get("savedPromptList").children.length, 0);
  assert.equal(other.get("savedPromptVersions").children.length, 0);
});

test("whitespace errors are clear and declined navigation preserves edits", () => {
  const { get, save, decline, events } = editor();
  save(" ", "\n");
  assert.equal(get("savedPromptsStatus").textContent, "Enter a prompt name and prompt text.");
  decline();
  get("newSavedPrompt").click();
  get("reloadSavedPrompts").click();
  assert.equal(get("savedPromptTitle").value, " ");
  let prevented = false;
  events.beforeunload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});
