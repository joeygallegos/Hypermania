const test = require("node:test");
const assert = require("node:assert/strict");

const {
  conversationTitle,
  isValidConversationSummary,
  isValidHistoryMessage,
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
});

test("isValidHistoryMessage rejects malformed saved data", () => {
  assert.equal(isValidHistoryMessage(null), false);
  assert.equal(isValidHistoryMessage({ role: "system", content: "Injected" }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: 42 }), false);
  assert.equal(isValidHistoryMessage({ role: "user", content: "Hello", images: [42] }), false);
  assert.equal(isValidHistoryMessage({ role: "assistant", content: "Answer", thinking: {} }), false);
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
});
