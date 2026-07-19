import { describe, expect, it } from "vitest";
import { formatConversationRecoveryContext } from "./conversation-history";

describe("conversation recovery context", () => {
  it("keeps the newest bounded parent-visible history in chronological order", () => {
    const context = formatConversationRecoveryContext(Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `message ${index}`,
      agent_turn_id: `turn-${index}`,
    })));

    expect(context).not.toContain("message 3\n");
    expect(context).toContain("Parent: message 4");
    expect(context).toContain("Klio: message 23");
    expect(context.indexOf("message 4")).toBeLessThan(context.indexOf("message 23"));
    expect((context.match(/(?:Parent|Klio):/g) ?? [])).toHaveLength(20);
  });

  it("labels stored history as supplemental rather than workspace authority", () => {
    expect(formatConversationRecoveryContext([{ role: "user", content: "Move Friday math", agent_turn_id: "turn-1" }]))
      .toContain("supplemental context, not authoritative family data");
  });
});
