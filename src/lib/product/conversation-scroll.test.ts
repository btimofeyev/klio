import { describe, expect, it } from "vitest";
import { completedConversationScrollTarget } from "./conversation-scroll";

describe("completedConversationScrollTarget", () => {
  it("reveals the beginning of a long completed answer", () => {
    expect(completedConversationScrollTarget({ scrollHeight: 767, clientHeight: 596, latestOffsetTop: 193, latestHeight: 594 })).toBe(181);
  });

  it("keeps a short reply aligned with the latest conversation", () => {
    expect(completedConversationScrollTarget({ scrollHeight: 596, clientHeight: 596, latestOffsetTop: 280, latestHeight: 120 })).toBe(596);
  });
});
