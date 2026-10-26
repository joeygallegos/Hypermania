const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectDirectory = __dirname;
const html = fs.readFileSync(path.join(projectDirectory, "public", "index.html"), "utf8");
const settingsHtml = fs.readFileSync(path.join(projectDirectory, "public", "settings.html"), "utf8");
const app = fs.readFileSync(path.join(projectDirectory, "public", "app.js"), "utf8");
const documentContext = fs.readFileSync(path.join(projectDirectory, "public", "document-context.js"), "utf8");
const settings = fs.readFileSync(path.join(projectDirectory, "public", "settings.js"), "utf8");
const scss = fs.readFileSync(path.join(projectDirectory, "public", "style.scss"), "utf8");

test("prompt management has its own blue page and preserves chat in another tab", () => {
  const prompts = fs.readFileSync(path.join(projectDirectory, "public", "prompts.html"), "utf8");
  assert.match(html, /href="\/prompts.html" target="_blank" rel="noopener"/);
  assert.doesNotMatch(html, /savedPromptsDialog|src="\/saved-prompts.js"/);
  assert.match(prompts, /<body class="prompts-page">/);
  assert.match(prompts, /id="savedPromptForm"/);
  assert.match(prompts, /id="savedPromptHistory"/);
  assert.match(prompts, /id="copySavedPrompt"/);
  assert.match(prompts, /src="\/prompt-library.js"[\s\S]*src="\/saved-prompts.js"/);
  assert.match(scss, /\.prompts-page\s*\{[\s\S]*?--accent: #79baff;/);
});

test("mobile surface keeps the conversation primary and history reachable", () => {
  // These source contracts complement eventual browser geometry checks: they
  // protect the deliberate mobile reading order without claiming to emulate a
  // layout engine in the dependency-free Node test suite.
  assert.match(html, /<section class="panel chat" aria-labelledby="activeChatTitle">/);
  assert.match(html, /class="secondary nav-link mobile-history-link" href="#chatHistoryTitle"/);
  assert.match(scss, /@media \(max-width: 820px\)[\s\S]*?\.chat\s*\{[\s\S]*?order:\s*-1;[\s\S]*?height:\s*calc\(100svh - 110px\);/);
  assert.match(scss, /@media \(max-width: 820px\)[\s\S]*?\.chat-history\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/);
  assert.match(scss, /@media \(max-width: 820px\)[\s\S]*?\.conversation-list\s*\{[\s\S]*?overflow-y:\s*visible;/);
  assert.match(scss, /@media \(max-width: 560px\)[\s\S]*?\.header-navigation\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
});

test("app header holds navigation while conversation header holds model controls", () => {
  const header = html.match(/<header class="hero chat-hero">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.match(header, /<nav class="header-navigation" aria-label="Main navigation">[\s\S]*?href="\/prompts.html"[\s\S]*?href="\/settings.html"[\s\S]*?<\/nav>/);
  assert.doesNotMatch(header, /id="model"|id="thinkMode"|id="modelCapabilitiesButton"/);
  const conversationHead = html.match(/<div class="chat-head">([\s\S]*?)<select id="contextSize"/)?.[1];
  assert.ok(conversationHead);
  for (const id of ["model", "thinkMode", "modelCapabilitiesButton", "modelMeta"]) {
    assert.ok(conversationHead.includes(`id="${id}"`));
    assert.equal(html.split(`id="${id}"`).length - 1, 1);
  }
  assert.match(app, /summary.className = "model-meta-summary visually-hidden"/);
  assert.equal((html.match(/href="\/prompts.html"/g) || []).length, 1);
  assert.match(scss, /\.conversation-model-controls[\s\S]*?min-width: 0;/);
});

test("attachment inventory exposes removable named items and aggregate state", () => {
  assert.match(app, /el\("preview"\)\.setAttribute\("role", "list"\)/);
  assert.match(app, /figure\.setAttribute\("role", "listitem"\)/);
  assert.match(app, /name\.textContent = attachment\.name/);
  assert.match(app, /remove\.setAttribute\("aria-label", `Remove \$\{attachment\.name\}`\)/);
  assert.match(app, /collection\.splice\(index, 1\)/);
  assert.match(app, /`\+ \$\{summary\} attached`/);
});

test("send progress and recovery controls preserve a retryable draft", () => {
  assert.match(app, /function hasDraft\(\)[\s\S]*?prompt[\s\S]*?state\.images\.length[\s\S]*?state\.pdfs\.length/);
  assert.match(app, /el\("send"\)\.disabled = state\.requestInProgress \|\| !hasDraft\(\)/);
  assert.match(app, /Preparing PDF \$\{index \+ 1\} of \$\{pendingPdfs\.length\}…/);
  assert.match(app, /setBusy\(true, "Waiting for model…"\)/);
  assert.match(app, /setBusy\(true, "Receiving response…"\)/);
  assert.match(app, /setBusy\(true, "Saving chat\.\.\."\)/);
  assert.match(app, /retry\.textContent = "Retry request"/);
  assert.match(app, /copy\.textContent = "Copy reference"/);
  assert.match(app, /navigator\.clipboard\.writeText\(referenceId\)/);
  assert.match(app, /Reference ID: \$\{referenceId\}/);
  assert.match(app, /const draftText = el\("prompt"\)\.value;\s+const prompt = draftText\.trim\(\);/);
  assert.match(app, /const renderedUserMessage = addMessage\([\s\S]*?el\("prompt"\)\.value = "";\s+setBusy\(true/);
  assert.match(app, /catch \(error\) \{[\s\S]*?el\("prompt"\)\.value = draftText;[\s\S]*?endGenerationMonitor\("Request failed\. Your message is ready to retry\."\)/);
  assert.match(app, /Keep raw File objects untouched until persistence succeeds/);
  assert.match(app, /const historyStartIndex = state\.history\.length/);
  assert.match(app, /state\.history\.splice\(historyStartIndex\)/);
});

test("dynamic updates use focused alerts instead of announcing the whole transcript", () => {
  assert.match(app, /el\("messages"\)\.setAttribute\("aria-live", "off"\)/);
  assert.match(app, /el\("errorBox"\)\.setAttribute\("role", "alert"\)/);
  assert.match(app, /el\("errorBox"\)\.setAttribute\("aria-atomic", "true"\)/);
  assert.match(app, /el\("errorBox"\)\.setAttribute\("tabindex", "-1"\)/);
  assert.match(app, /box\.focus\(\)/);
});

test("saved chat deletion uses a compact accessible icon control", () => {
  assert.match(app, /deleteButton\.setAttribute\("aria-label", `Delete \$\{conversation\.title\}`\)/);
  assert.match(app, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/);
  assert.match(app, /deleteIcon\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(app, /deleteIcon\.setAttribute\("focusable", "false"\)/);
  assert.match(app, /deleteButton\.addEventListener\("click", \(\) => deleteConversation\(conversation\)\)/);
  assert.doesNotMatch(app, /deleteButton\.textContent = "Delete"/);
  assert.match(scss, /\.conversation-item\s*\{[\s\S]*?position:\s*relative;/);
  assert.match(scss, /\.conversation-open\s*\{[\s\S]*?padding:\s*11px 60px 11px 12px;/);
  assert.match(scss, /\.conversation-delete\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
});

test("model switching keeps context clear, attributable, and accessible", () => {
  assert.match(html, /<span class="section-kicker">Active model<\/span>/);
  assert.match(html, /id="modelMeta" class="model-meta" aria-live="polite" aria-atomic="true"/);
  assert.match(app, /Previous messages in this chat will be included as context\./);
  assert.match(app, /This model can't continue this chat\./);
  assert.match(app, /state\.history\.push\(\{ role: "assistant", content: reply, thinking, model \}\)/);
  assert.match(app, /messages: documentContext\.mode === "none"[\s\S]*?buildDocumentMessages\(/);
  assert.match(documentContext, /const selectedPages = selectDocumentPages/);
  assert.doesNotMatch(app, /createMessage\("assistant", message, "preflight check"\)/);
});

test("model capability details use an accessible dialog and reported Ollama data", () => {
  assert.match(html, /id="modelCapabilitiesButton"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-controls="modelCapabilitiesDialog"/);
  assert.match(html, /<dialog id="modelCapabilitiesDialog"[\s\S]*?aria-labelledby="modelCapabilitiesTitle"/);
  assert.match(app, /const MODEL_CAPABILITY_DETAILS = \{/);
  assert.match(app, /Array\.isArray\(info\.capabilities\) \? info\.capabilities : \[\]/);
  assert.match(app, /Hypermania does not currently provide callable tools\./);
  assert.match(app, /modelInfoLoading: new Set\(\)/);
  assert.match(app, /showModal\(\)/);
  assert.match(app, /addEventListener\("close", \(\) => el\("modelCapabilitiesButton"\)\.focus\(\)\)/);
  assert.match(app, /if \(event\.target === el\("modelCapabilitiesDialog"\)\)/);
  assert.match(scss, /\.model-capabilities-dialog::backdrop/);
});

test("thinking controls appear only for capable models and preserve reported levels", () => {
  assert.match(html, /id="thinkingControl" class="thinking-picker" for="thinkMode" hidden/);
  assert.match(html, /<span class="section-kicker">Thinking level<\/span>/);
  assert.match(app, /function supportsThinking\(info\)/);
  assert.match(app, /capabilities\.includes\("thinking"\)/);
  assert.match(app, /control\.hidden = !supported/);
  assert.match(app, /Array\.isArray\(info\?\.thinking\?\.values\)/);
  assert.match(app, /if \(!supportsThinking\(info\)\) return undefined/);
  assert.match(scss, /\.model-control\.has-thinking\s*\{[\s\S]*?grid-template-columns:/);
});

test("system instruction is editable, persisted, and included in future requests", () => {
  assert.match(settingsHtml, /<label for="systemInstruction">System instruction<\/label>/);
  assert.match(settingsHtml, /id="systemInstruction"[\s\S]*?aria-describedby="systemInstructionHint"/);
  assert.match(settingsHtml, /Leave blank to send no system instruction\./);
  assert.match(settings, /preferences\.setSystemInstruction\(instruction\)/);
  assert.match(app, /const systemInstruction = window\.hypermaniaPreferences\.getSystemInstruction\(\)/);
  assert.match(app, /buildDocumentMessages\([\s\S]*?systemInstruction/);
});

test("thinking diagnostics report the start of reasoning only once per stream", () => {
  assert.match(app, /let reportedThinkingStart = false;/);
  assert.match(app, /if \(!reportedThinkingStart\) \{\s+reportedThinkingStart = true;\s+debugLog\("stream_thinking_seen"/);
  assert.doesNotMatch(app, /if \(!sawFirstChunk\) \{\s+debugLog\("stream_thinking_seen"/);
});
