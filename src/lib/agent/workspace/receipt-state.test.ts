import { describe, expect, it } from "vitest";
import { deriveReceiptState } from "./receipt-state";

describe("worker heartbeat receipts", () => {
  const now = new Date("2026-07-14T16:00:00Z").getTime();

  it("shows recent running heartbeats as active", () => {
    expect(deriveReceiptState({ status: "running", createdAt: "2026-07-14T15:55:00Z", lastHeartbeatAt: "2026-07-14T15:59:40Z", now })).toBe("running");
  });

  it("stops claiming work is active when the heartbeat expires", () => {
    expect(deriveReceiptState({ status: "running", createdAt: "2026-07-14T15:55:00Z", lastHeartbeatAt: "2026-07-14T15:58:00Z", now })).toBe("paused");
  });

  it("distinguishes a queued job from a stale queue", () => {
    expect(deriveReceiptState({ status: "queued", createdAt: "2026-07-14T15:59:30Z", lastHeartbeatAt: null, now })).toBe("queued");
    expect(deriveReceiptState({ status: "queued", createdAt: "2026-07-14T15:57:00Z", lastHeartbeatAt: null, now })).toBe("paused");
  });
});
