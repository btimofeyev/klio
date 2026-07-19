import { describe, expect, it } from "vitest";
import { dateInFamilyTimezone, mergeRelevantAssignments, shiftIsoDate, summarizeDailyWorkloads } from "./relevance";

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

describe("authoritative daily workload summaries", () => {
  it("keeps learners isolated and distinguishes curriculum from practice", () => {
    const result = summarizeDailyWorkloads({
      students: [
        { id: "jacob", daily_capacity_minutes: 240 },
        { id: "maya", daily_capacity_minutes: 210 },
      ],
      assignments: [
        { student_id: "jacob", scheduled_date: "2026-07-17", estimated_minutes: 230, status: "planned", source_kind: "curriculum" },
        { student_id: "jacob", scheduled_date: "2026-07-17", estimated_minutes: 20, status: "planned", source_kind: "practice" },
        { student_id: "maya", scheduled_date: "2026-07-17", estimated_minutes: 180, status: "planned", source_kind: "curriculum" },
        { student_id: "maya", scheduled_date: "2026-07-17", estimated_minutes: 90, status: "skipped", source_kind: "practice" },
      ],
    });
    expect(result).toEqual([
      { studentId: "jacob", scheduledDate: "2026-07-17", totalMinutes: 250, curriculumMinutes: 230, practiceMinutes: 20, assignmentCount: 2, capacityMinutes: 240, remainingMinutes: -10, overCapacity: true },
      { studentId: "maya", scheduledDate: "2026-07-17", totalMinutes: 180, curriculumMinutes: 180, practiceMinutes: 0, assignmentCount: 1, capacityMinutes: 210, remainingMinutes: 30, overCapacity: false },
    ]);
  });
});
