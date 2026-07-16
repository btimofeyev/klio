import { describe, expect, it } from "vitest";
import { dateInFamilyTimezone, mergeRelevantAssignments, shiftIsoDate } from "./relevance";

const assignment = (id: string, status = "planned", scheduled_date: string | null = null) => ({ id, status, scheduled_date });

describe("mergeRelevantAssignments", () => {
  it("keeps overdue, current, pending, and future work ahead of more than 200 historical records", () => {
    const history = Array.from({ length: 240 }, (_, index) => assignment(`old-${index}`, "completed", `2025-01-${String((index % 28) + 1).padStart(2, "0")}`));
    const result = mergeRelevantAssignments({
      overdue: [assignment("overdue", "planned", "2026-07-10")],
      pendingReview: [assignment("submitted", "submitted", "2026-07-13")],
      currentWindow: [assignment("current", "planned", "2026-07-14"), assignment("future", "planned", "2026-07-28")],
      unscheduled: [assignment("next-curriculum")],
      recentlyCompleted: history,
    });
    expect(result.assignments.slice(0, 5).map((item) => item.id)).toEqual([
      "overdue", "submitted", "current", "future", "next-curriculum",
    ]);
    expect(result.assignments).toHaveLength(200);
    expect(result.metadata).toMatchObject({ candidateCount: 245, truncated: true });
  });

  it("deduplicates assignments that appear in multiple decision cohorts", () => {
    const shared = assignment("shared", "submitted", "2026-07-10");
    const result = mergeRelevantAssignments({
      overdue: [shared], currentWindow: [shared], pendingReview: [shared], unscheduled: [], recentlyCompleted: [],
    });
    expect(result.assignments).toEqual([shared]);
  });
});

describe("family date helpers", () => {
  it("uses the family timezone and shifts dates without local-time drift", () => {
    expect(dateInFamilyTimezone("America/Los_Angeles", new Date("2026-07-14T02:00:00Z"))).toBe("2026-07-13");
    expect(shiftIsoDate("2026-07-14", 42)).toBe("2026-08-25");
  });
});
