const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStorageApi } = require("../storage-api");

test("an explicit HTTPS public origin works behind an HTTP proxy without trusting forwarded headers", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hypermania-api-"));
  const handle = createStorageApi({ filename: path.join(directory, "test.sqlite"),
    publicOrigin: "https://chat.example.com", readBody: async () => Buffer.from("{}"), log: async () => {} });
  t.after(() => { handle.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function request(origin) {
    const result = {};
    await handle({ method: "GET", url: "/api/storage/preferences", socket: { encrypted: false },
      headers: { host: "127.0.0.1:3111", origin, "x-hypermania-storage": "1", "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" },
    }, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = JSON.parse(body); } });
    return result;
  }
  assert.equal((await request("https://chat.example.com")).status, 200);
  assert.equal((await request("https://evil.example")).status, 403);
  assert.equal((await request("http://127.0.0.1:3111")).status, 403);
});

test("storage rejects static paths, Windows case aliases, and ambiguous origins before opening files", () => {
  const options = { readBody: async () => {}, log: async () => {} };
  const filenames = [path.resolve(__dirname, "../public/private.sqlite"), path.resolve(__dirname, "../node_modules/katex/dist/private.sqlite")];
  if (process.platform === "win32") filenames.push(path.resolve(__dirname, "../PUBLIC/private.sqlite"));
  for (const filename of filenames) assert.throws(() => createStorageApi({ ...options, filename }), /outside static/);
  assert.throws(() => createStorageApi({ ...options, filename: "relative.sqlite" }), /absolute/);
  assert.throws(() => createStorageApi({ ...options, publicOrigin: "https://example.com/" }), /exact/);
});
