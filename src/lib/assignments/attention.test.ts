import { describe, expect, it } from "vitest";
import { unfinishedAssignmentsBefore, type AssignmentForAttention } from "./attention";

const assignment = (overrides: Partial<AssignmentForAttention>): AssignmentForAttention => ({
  id: crypto.randomUUID(),
  title: "Math · Lesson 1",
  status: "planned",
  scheduledDate: "2026-07-13",
  scheduledTime: null,
  ...overrides,
});

describe("unfinished assignment attention", () => {
  it("returns planned and in-progress work from earlier days", () => {
    const items = [
      assignment({ id: "planned" }),
      assignment({ id: "doing", status: "doing", scheduledTime: "09:00:00" }),
      assignment({ id: "today", scheduledDate: "2026-07-14" }),
      assignment({ id: "future", scheduledDate: "2026-07-15" }),
    ];

    expect(unfinishedAssignmentsBefore(items, "2026-07-14").map((item) => item.id)).toEqual(["planned", "doing"]);
  });

  it("does not treat finished, skipped, submitted, or review-ready work as unfinished", () => {
    const items = ["completed", "skipped", "submitted", "needs_review"].map((status) => assignment({ status }));
    expect(unfinishedAssignmentsBefore(items, "2026-07-14")).toEqual([]);
  });

  it("puts the oldest scheduled work first", () => {
    const items = [
      assignment({ id: "later", scheduledDate: "2026-07-13" }),
      assignment({ id: "oldest", scheduledDate: "2026-07-10" }),
    ];
    expect(unfinishedAssignmentsBefore(items, "2026-07-14")[0]?.id).toBe("oldest");
  });
});
