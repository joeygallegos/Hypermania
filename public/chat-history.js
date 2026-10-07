// Keep the saved-chat data contract usable in both the browser and Node so the
// production validation rules—not a test-only copy—receive regression coverage.
(function exposeChatHistoryHelpers(root, factory) {
  const helpers = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = helpers;
  } else {
    root.hypermaniaChatHistory = helpers;
  }
}(typeof globalThis === "object" ? globalThis : this, () => {
  function isValidHistoryMessage(message) {
    // Saved data is untrusted input: browser extensions, older app versions, or
    // manual storage edits must not inject unexpected values into Ollama requests.
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") return false;
    if (message.images !== undefined && (!Array.isArray(message.images) || message.images.some((image) => typeof image !== "string"))) return false;
    return message.thinking === undefined || typeof message.thinking === "string";
  }

  function isValidConversationSummary(conversation) {
    return conversation
      && typeof conversation.id === "string"
      // threadId was added after saved-chat history shipped, so omitted values
      // remain valid and receive a UUID when that legacy chat is next opened.
      && (conversation.threadId === undefined
        || /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(conversation.threadId))
      && typeof conversation.title === "string"
      && typeof conversation.createdAt === "string"
      && typeof conversation.updatedAt === "string"
      && typeof conversation.model === "string"
      && Number.isInteger(conversation.revision)
      && conversation.revision > 0;
  }

  function conversationTitle(messages) {
    const firstUserMessage = messages.find((message) => message.role === "user");
    const normalized = firstUserMessage?.content?.replace(/\s+/g, " ").trim() || "Attachment conversation";
    return normalized.length > 58 ? `${normalized.slice(0, 57)}…` : normalized;
  }

  return {
    conversationTitle,
    isValidConversationSummary,
    isValidHistoryMessage,
  };
}));
