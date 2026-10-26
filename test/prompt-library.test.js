const test = require("node:test");
const assert = require("node:assert/strict");
const { createLibrary } = require("../public/prompt-library.js");

function setup() {
  let raw = null;
  let fail = false;
  let nextId = 0;
  const storage = {
    getItem: () => raw,
    setItem: (_key, value) => {
      if (fail) throw new Error("Quota exceeded");
      raw = value;
    },
  };
  const library = createLibrary(storage, () => String(++nextId));
  library.load();
  return { library, storage, fail: (value) => { fail = value; }, corrupt: (value) => { raw = value; } };
}

test("prompts persist through reloads with dated name and text revisions", () => {
  const { library, storage } = setup();
  const [created] = library.save(null, " Review ", "Keep spacing.\n  <script>literal</script>");
  const [updated] = library.save(created.id, "Code review", "Updated text");
  assert.equal(updated.versions.length, 2);
  assert.equal(updated.versions[0].title, "Review");
  assert.equal(updated.versions[0].content, "Keep spacing.\n  <script>literal</script>");
  assert.ok(updated.versions.every((version) => Number.isFinite(Date.parse(version.savedAt))));
  assert.deepEqual(createLibrary(storage).load(), [updated]);
  assert.equal(library.save(created.id, "Code review", "Updated text")[0].versions.length, 2);
});

test("deleting a prompt removes all its versions and preserves other prompts", () => {
  const { library, storage } = setup();
  const [first] = library.save(null, "First", "One");
  library.save(first.id, "First", "Two");
  const second = library.save(null, "Second", "Three")[1];
  assert.deepEqual(library.remove(first.id), [second]);
  assert.deepEqual(createLibrary(storage).load(), [second]);
});

test("blank or oversized fields and missing edit targets cannot change storage", () => {
  const { library, storage } = setup();
  for (const [title, content] of [[" ", "text"], ["name", "\n"], ["a".repeat(121), "x"], ["name", "x".repeat(50001)]]) {
    assert.throws(() => library.save(null, title, content), /Enter a name/);
  }
  assert.throws(() => library.save("missing", "Name", "Text"), /no longer exists/);
  assert.equal(storage.getItem(), null);
});

test("failed writes leave saved history intact and allow retry", () => {
  const { library, storage, fail } = setup();
  const [first] = library.save(null, "Name", "Original");
  fail(true);
  assert.throws(() => library.save(first.id, "Name", "Changed"), /Quota/);
  assert.throws(() => library.remove(first.id), /Quota/);
  assert.deepEqual(createLibrary(storage).load(), [first]);
  fail(false);
  assert.equal(library.save(first.id, "Name", "Changed")[0].versions.length, 2);
});

test("stale editors cannot overwrite another tab's edits or deletions", () => {
  const { library, storage } = setup();
  const [first] = library.save(null, "Name", "Original");
  const otherTab = createLibrary(storage);
  otherTab.load();
  otherTab.save(first.id, "Name", "Other tab");
  assert.throws(() => library.save(first.id, "Name", "Stale"), /another tab/);
  assert.throws(() => library.remove(first.id), /another tab/);
  library.load();
  library.remove(first.id);
  assert.throws(() => otherTab.save(first.id, "Name", "Stale"), /another tab/);
});

test("malformed persisted data is rejected without erasing it", () => {
  const { library, storage, corrupt } = setup();
  for (const raw of ["invalid JSON", "{}", "[null]", '[{"id":"one","versions":[]}]',
    '[{"id":"one","versions":[{"title":"Name","content":"Text","savedAt":"invalid"}]}]']) {
    corrupt(raw);
    assert.throws(() => library.load());
    assert.equal(storage.getItem(), raw);
  }
});

test("returned snapshots cannot mutate saved history", () => {
  const { library } = setup();
  const [item] = library.save(null, "Name", "Original");
  item.versions[0].content = "Mutated";
  assert.equal(library.load()[0].versions[0].content, "Original");
});
