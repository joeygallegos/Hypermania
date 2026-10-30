// Optional browser verification using an existing Playwright installation.
// All services, browser profiles, and data are isolated; no real Ollama/PDF tools run.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require(process.env.HYPERMANIA_PLAYWRIGHT || "playwright");
const { openStorage } = require("../storage");
const root = path.resolve(__dirname, "..");
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hypermania-browser-"));
  const database = path.join(directory, "test.sqlite");
  const upstream = http.createServer((req, res) => {
    req.resume();
    if (req.url === "/api/tags") res.end(JSON.stringify({ models: [{ name: "synthetic-model" }] }));
    else if (req.url === "/api/show") res.end(JSON.stringify({ details: { family: "synthetic" }, capabilities: ["completion"] }));
    else {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.end(`${JSON.stringify({ message: { role: "assistant", content: "Synthetic saved answer." }, done: false })}\n${JSON.stringify({ done: true })}\n`);
    }
  });
  let child, browser;
  try {
    const upstreamPort = await listen(upstream);
    const portProbe = http.createServer();
    const port = await listen(portProbe);
    await new Promise((resolve) => portProbe.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env,
      PORT: String(port), OLLAMA_BASE: `http://127.0.0.1:${upstreamPort}`,
      HYPERMANIA_DATA_FILE: database, HYPERMANIA_LOG_FILE: path.join(directory, "test.log"), HYPERMANIA_ORIGIN: "",
    }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
      try { if ((await fetch(base)).ok) break; } catch { /* Wait for isolated startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const first = await browser.newContext({ viewport: { width: 1149, height: 773 } });
    const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await first.newPage();
    const mobile = await second.newPage();
    const errors = [];
    for (const tab of [page, mobile]) tab.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.locator("#prompt").fill("Synthetic question");
    await page.locator("#send").click();
    await page.waitForFunction(() => document.querySelectorAll(".conversation-open").length === 1);
    await mobile.goto(base);
    await mobile.waitForFunction(() => document.querySelector("#messages").textContent.includes("Synthetic saved answer."));
    console.log("PASS: real chat save and second-browser/mobile reload");

    await page.goto(`${base}/prompts.html`);
    await page.waitForFunction(() => Boolean(window.hypermaniaPromptsReady));
    await page.evaluate(() => window.hypermaniaPromptsReady);
    await page.locator("#savedPromptTitle").fill("Shared prompt");
    await page.locator("#savedPromptContent").fill("Original prompt text");
    await page.locator("#savedPromptForm button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#savedPromptsStatus").textContent === "Prompt saved.");
    await mobile.goto(`${base}/prompts.html`);
    await mobile.locator("#savedPromptList button").click();
    assert.equal(await mobile.locator("#savedPromptContent").inputValue(), "Original prompt text");
    await page.locator("#savedPromptContent").fill("Newer version");
    await page.locator("#savedPromptForm button[type=submit]").click();
    await page.waitForFunction(() => document.querySelectorAll("#savedPromptVersions details").length === 2);
    await mobile.locator("#savedPromptContent").fill("Stale edit");
    await mobile.locator("#savedPromptForm button[type=submit]").click();
    await mobile.waitForFunction(() => document.querySelector("#savedPromptsStatus").textContent.includes("another browser"));
    assert.equal(await mobile.locator("#savedPromptContent").inputValue(), "Stale edit");
    mobile.on("dialog", (dialog) => dialog.accept());
    await mobile.locator("#reloadSavedPrompts").click();
    await mobile.locator("#savedPromptList button").click();
    await mobile.locator("#savedPromptContent").fill("Stale edit");
    await mobile.locator("#savedPromptForm button[type=submit]").click();
    await mobile.waitForFunction(() => document.querySelector("#savedPromptsStatus").textContent === "Prompt saved.");
    console.log("PASS: shared prompt versions, stale conflict, and reload/reapply recovery");

    await page.goto(`${base}/settings.html`);
    await page.waitForFunction(() => document.querySelector("#systemInstruction").value.length > 0);
    await page.locator("#systemInstruction").fill("Shared server instruction");
    await page.locator("#saveSystemInstruction").click();
    await page.waitForFunction(() => document.querySelector("#instructionSaveState").textContent === "Saved");
    await mobile.goto(`${base}/settings.html`);
    await mobile.waitForFunction(() => document.querySelector("#systemInstruction").value === "Shared server instruction");
    console.log("PASS: preferences shared across independent browser contexts");

    await page.evaluate(async () => {
      const request = indexedDB.open("hypermania-chats", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("conversations", { keyPath: "id" });
        request.result.createObjectStore("conversationData", { keyPath: "id" });
      };
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      const tx = db.transaction(["conversations", "conversationData"], "readwrite");
      for (const [id, schemaVersion] of [["old-key", 1], ["pdf-key", 2]]) {
        tx.objectStore("conversations").put({ id, title: `Imported ${id}`, model: "synthetic-model", revision: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01" });
        tx.objectStore("conversationData").put({ id, schemaVersion,
          history: [{ role: "user", content: "Legacy question", ...(schemaVersion === 2 ? { documentIds: ["pdf"] } : {}) }],
          ...(schemaVersion === 2 ? { documents: [{ id: "pdf", name: "Synthetic.pdf", pages: [{ number: 1, text: "Native text", image: "AAAA" }] }] } : {}),
        });
      }
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
      db.close();
      localStorage.setItem("hypermania.prompts.v1", JSON.stringify([{ id: "old-prompt", versions: [{ title: "Legacy prompt", content: "Legacy text", savedAt: "2025-01-01" }] }]));
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("#importBrowserData").click();
    await page.waitForFunction(() => document.querySelector("#browserImportStatus").textContent.includes("3 imported, 0 already imported, 0 need attention"));
    await page.locator("#importBrowserData").click();
    await page.waitForFunction(() => document.querySelector("#browserImportStatus").textContent.includes("0 imported, 3 already imported, 0 need attention"));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("hypermania.prompts.v1"))[0].versions[0].content), "Legacy text");
    await mobile.goto(base);
    await mobile.waitForFunction(() => document.querySelectorAll(".conversation-open").length === 3);
    console.log("PASS: schema-v1/v2 browser import, dated prompts, repeat-import deduplication, originals retained");
    assert.deepEqual(errors, []);
    await browser.close(); browser = null;
    const exited = once(child, "exit"); child.kill(); await exited; child = null;
    const restored = openStorage(database);
    assert.equal(restored.list().length, 3);
    assert.equal(restored.settings("preferences").value.systemInstruction, "Shared server instruction");
    restored.close();
    console.log("PASS: process-stop reopen preserves shared data; zero browser page errors");
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
