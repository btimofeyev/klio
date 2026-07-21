import { describe, expect, it } from "vitest";
import { instantConversationReply } from "./instant-conversation";

describe("instantConversationReply", () => {
  it.each(["Hello", "hi!", "Hey there", "Good morning"])('answers the greeting "%s" immediately', (request) => {
    expect(instantConversationReply(request)).toBe("Hello! What would you like help with today?");
  });

  it("answers context-free product questions immediately", () => {
    expect(instantConversationReply("What can you do?"))
      .toContain("organize the week");
    expect(instantConversationReply("Who are you?"))
      .toContain("I’m Klio");
  });

  it.each([
    "What does Jacob have today?",
    "Hello, can you move Jacob's math lesson?",
    "Thanks, now create practice for Maya",
    "How should I teach this lesson?",
  ])('keeps the workspace request "%s" on the agent path', (request) => {
    expect(instantConversationReply(request)).toBeNull();
  });
});
