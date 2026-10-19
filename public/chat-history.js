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
  const HISTORY_MESSAGE_KEYS = new Set(["role", "content", "images", "thinking", "model"]);

  function isValidHistoryMessage(message) {
    // Saved data is untrusted input: browser extensions, older app versions, or
    // manual storage edits must not inject unexpected values into Ollama requests.
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") return false;
    if (Object.keys(message).some((key) => !HISTORY_MESSAGE_KEYS.has(key))) return false;
    if (message.images !== undefined && (!Array.isArray(message.images) || message.images.some((image) => typeof image !== "string"))) return false;
    if (message.images !== undefined && message.role !== "user") return false;
    if (message.thinking !== undefined && (message.role !== "assistant" || typeof message.thinking !== "string")) return false;
    return message.model === undefined
      || (message.role === "assistant" && typeof message.model === "string" && Boolean(message.model.trim()));
  }

  function toOllamaMessages(messages, systemInstruction = "") {
    // Model attribution is local presentation metadata. Rebuild every outbound
    // message so it and any unexpected stored fields never cross into Ollama.
    const outboundMessages = messages.map((message) => {
      const outbound = { role: message.role, content: message.content };
      if (message.images !== undefined) outbound.images = [...message.images];
      if (message.thinking !== undefined) outbound.thinking = message.thinking;
      return outbound;
    });

    // Keep the browser-level instruction out of persisted conversation history
    // so changing it affects future requests without rewriting saved chats.
    const instruction = String(systemInstruction).trim();
    return instruction
      ? [{ role: "system", content: instruction }, ...outboundMessages]
      : outboundMessages;
  }

  function historyHasImages(messages) {
    return messages.some((message) => Array.isArray(message.images) && message.images.length > 0);
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
    historyHasImages,
    isValidConversationSummary,
    isValidHistoryMessage,
    toOllamaMessages,
  };
}));
