const test = require("node:test");
const assert = require("node:assert/strict");

const {
  conversationTitle,
  historyHasImages,
  isValidConversationSummary,
  isValidHistoryMessage,
  toOllamaMessages,
} = require("../public/chat-history.js");

test("conversationTitle normalizes whitespace and bounds sidebar titles", () => {
  assert.equal(
    conversationTitle([{ role: "user", content: "  Review\n\nthis   quarterly report  " }]),
    "Review this quarterly report"
  );

  const title = conversationTitle([{ role: "user", content: "x".repeat(100) }]);
  assert.equal(title.length, 58);
  assert.equal(title.at(-1), "…");
});

test("conversationTitle handles an attachment-only history", () => {
  assert.equal(conversationTitle([]), "Attachment conversation");
  assert.equal(
    conversationTitle([{ role: "assistant", content: "No user message" }]),
    "Attachment conversation"
  );
});

test("isValidHistoryMessage accepts the exact persisted Ollama context", () => {
  assert.equal(isValidHistoryMessage({ role: "user", content: "Hello" }), true);
  assert.equal(isValidHistoryMessage({ role: "user", content: "See this", images: ["base64-image"] }), true);
  assert.equal(isValidHistoryMessage({ role: "assistant", content: "Answer", thinking: "Reasoning" }), true);
  assert.equal(isValidHistoryMessage({ role: "assistant", content: "Answer", model: "model-a" }), true);
  assert.equal(isValidHistoryMessage({ role: "user", content: "See PDF", documentIds: ["pdf-1"] }), true);
});

test("isValidHistoryMessage rejects malformed saved data", () => {
  assert.equal(isValidHistoryMessage(null), false);
  assert.equal(isValidHistoryMessage({ role: "system", content: "Injected" }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: 42 }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: "Hello", images: [42] }), false);
  assert.equal(isValidHistoryMessage({ role: "assistant", content: "Answer", thinking: {} }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: "Hello", model: "model-a" }), false);
  assert.equal(isValidHistoryMessage({ role: "assistant", content: "Answer", unexpected: true }), false);
  assert.equal(isValidHistoryMessage({ role: "assistant", content: "Answer", documentIds: ["pdf-1"] }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: "Hello", documentIds: ["pdf-1", "pdf-1"] }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: "Hello", documentIds: [" padded "] }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: "Hello", documentIds: new Array(17).fill("pdf") }), false);
});

test("toOllamaMessages preserves context while removing local model attribution", () => {
  // Include an untrusted extra field to prove the serializer is an allowlist,
  // not merely a one-off deletion of the local model attribution field.
  const history = [
    { role: "user", content: "Look at this", images: ["base64-image"] },
    { role: "assistant", content: "Model A response", thinking: "Reasoning", model: "model-a", unexpected: true },
    { role: "user", content: "Continue" },
  ];

  assert.deepEqual(toOllamaMessages(history), [
    { role: "user", content: "Look at this", images: ["base64-image"] },
    { role: "assistant", content: "Model A response", thinking: "Reasoning" },
    { role: "user", content: "Continue" },
  ]);
  assert.equal(history[1].model, "model-a");
});

test("toOllamaMessages never forwards local document references", () => {
  assert.deepEqual(toOllamaMessages([
    { role: "user", content: "Review it", documentIds: ["pdf-1"] },
  ]), [
    { role: "user", content: "Review it" },
  ]);
});

test("toOllamaMessages prepends a trimmed system instruction when configured", () => {
  const history = [{ role: "user", content: "Hello" }];

  assert.deepEqual(toOllamaMessages(history, "  Respond in English.  "), [
    { role: "system", content: "Respond in English." },
    { role: "user", content: "Hello" },
  ]);
  assert.deepEqual(toOllamaMessages(history, "   "), history);
  assert.deepEqual(history, [{ role: "user", content: "Hello" }]);
});

test("historyHasImages detects earlier image context", () => {
  assert.equal(historyHasImages([{ role: "user", content: "Text", images: [] }]), false);
  assert.equal(historyHasImages([{ role: "user", content: "Image", images: ["base64-image"] }]), true);
  assert.equal(historyHasImages([{ role: "assistant", content: "Answer", model: "model-a" }]), false);
});

test("isValidConversationSummary requires resumable versioned metadata", () => {
  const summary = {
    id: "chat-1",
    title: "Quarterly report",
    createdAt: "2026-09-25T12:00:00.000Z",
    updatedAt: "2026-09-25T12:01:00.000Z",
    model: "qwen3:8b",
    revision: 1,
  };

  assert.equal(isValidConversationSummary(summary), true);
  assert.equal(isValidConversationSummary({ ...summary, revision: 0 }), false);
  assert.equal(isValidConversationSummary({ ...summary, model: null }), false);
  assert.equal(isValidConversationSummary({ ...summary, id: undefined }), false);
  assert.equal(isValidConversationSummary({
    ...summary,
    threadId: "d9428888-122b-4f09-9914-f307aa6c5ac2",
  }), true);
  assert.equal(isValidConversationSummary({ ...summary, threadId: "not-a-trace-id" }), false);
});
