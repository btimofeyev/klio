import { describe, expect, it } from "vitest";
import { selectLatestWorkspaceTurn } from "./turn-selection";

describe("latest workspace turn selection", () => {
  it("keeps the newest completed background handoff for its in-place receipt", () => {
    const background = { id: "background", status: "completed", conversation_id: null };
    const conversation = { id: "conversation", status: "completed", conversation_id: "conversation-1" };
    expect(selectLatestWorkspaceTurn(background, conversation)).toBe(background);
  });

  it("keeps an active turn even when it belongs to a conversation", () => {
    const active = { id: "active", status: "running", conversation_id: "conversation-2" };
    const previous = { id: "previous", status: "completed", conversation_id: "conversation-1" };
    expect(selectLatestWorkspaceTurn(active, previous)).toBe(active);
  });

  it("uses the latest conversation receipt when the newest global turn is a completed conversation", () => {
    const latest = { id: "latest", status: "completed", conversation_id: "conversation-2" };
    const latestConversation = { id: "latest-conversation", status: "completed", conversation_id: "conversation-2" };
    expect(selectLatestWorkspaceTurn(latest, latestConversation)).toBe(latestConversation);
  });
});
