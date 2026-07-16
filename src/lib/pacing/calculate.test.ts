import { describe, expect, it } from "vitest";
import { calculateCurriculumPace, findCrowdedOutSubjects, type CurriculumPaceInput } from "./calculate";

function input(overrides: Partial<CurriculumPaceInput> = {}): CurriculumPaceInput {
  return {
    asOfDate: "2026-01-16",
    term: {
      startsOn: "2026-01-05",
      endsOn: "2026-01-30",
      instructionalWeekdays: [1, 2, 3, 4, 5],
    },
    goalStatus: "active",
    target: {
      startsOn: "2026-01-05",
      targetCompletionDate: "2026-01-30",
      startSequence: 1,
      targetSequence: 20,
      weeklyCadence: 5,
      weeklyEffortMinutes: 200,
      status: "active",
    },
    assignments: [],
    dailyCapacityMinutes: 180,
    ...overrides,
  };
}

function completed(count: number, evidence = false) {
  return Array.from({ length: count }, (_, index) => ({
    id: `assignment-${index + 1}`,
    sequenceNumber: index + 1,
    status: "completed" as const,
    estimatedMinutes: 40,
    finalizedApprovedEvidence: evidence,
  }));
}

describe("calculateCurriculumPace", () => {
  it("classifies current work as ahead, on pace, or at risk deterministically", () => {
    expect(calculateCurriculumPace(input({ assignments: completed(13) })).state).toBe("ahead");
    expect(calculateCurriculumPace(input({ assignments: completed(10) })).state).toBe("on_pace");
    expect(calculateCurriculumPace(input({ assignments: completed(5) })).state).toBe("at_risk");
  });

  it("distinguishes explicit blocking from ordinary pace risk", () => {
    expect(calculateCurriculumPace(input({ goalStatus: "blocked" })).state).toBe("blocked");
    expect(calculateCurriculumPace(input({ assignments: completed(2) })).state).toBe("at_risk");
  });

  it("marks a finished target complete", () => {
    const result = calculateCurriculumPace(input({ assignments: completed(20, true) }));
    expect(result).toMatchObject({ state: "complete", remainingValue: 0, basis: "approved_evidence" });
  });

  it("uses term exceptions and override capacity", () => {
    const result = calculateCurriculumPace(input({
      term: {
        startsOn: "2026-01-05",
        endsOn: "2026-01-10",
        instructionalWeekdays: [1, 2, 3, 4, 5],
        overrides: [
          { date: "2026-01-07", isInstructional: false },
          { date: "2026-01-10", isInstructional: true, availableMinutes: 60 },
        ],
      },
      asOfDate: "2026-01-06",
      target: { ...input().target, targetCompletionDate: "2026-01-10", targetSequence: 5 },
    }));
    expect(result.instructionalDaysTotal).toBe(5);
    expect(result.capacityMinutesRemaining).toBe(420);
  });

  it("reports due, overdue, and feasibility from bounded records", () => {
    const assignments = [
      ...completed(8),
      { id: "late", sequenceNumber: 9, status: "planned" as const, scheduledDate: "2026-01-15", estimatedMinutes: 40 },
      { id: "today", sequenceNumber: 10, status: "doing" as const, dueAt: "2026-01-16T18:00:00Z", estimatedMinutes: 40 },
    ];
    const result = calculateCurriculumPace(input({ assignments, dailyCapacityMinutes: 10 }));
    expect(result.overdueAssignmentIds).toEqual(["late"]);
    expect(result.dueAssignmentIds).toEqual(["today"]);
    expect(result.feasible).toBe(false);
  });

  it("labels conclusions by planned versus approved evidence provenance", () => {
    expect(calculateCurriculumPace(input({ assignments: completed(10) })).basis).toBe("plan");
    expect(calculateCurriculumPace(input({ assignments: [...completed(5, true), ...completed(10).slice(5)] })).basis).toBe("mixed");
  });

  it("compares the current weekly review with the prior checkpoint", () => {
    const result = calculateCurriculumPace(input({
      assignments: completed(10),
      previousCheckpoint: {
        asOfDate: "2026-01-09",
        expectedValue: 5,
        actualValue: 4,
        state: "on_pace",
        feasible: true,
        overdueCount: 2,
      },
    }));
    expect(result.change).toEqual({
      since: "2026-01-09",
      actualDelta: 6,
      expectedDelta: 5,
      overdueDelta: -2,
      stateChanged: false,
      feasibilityChanged: false,
    });
  });

  it("handles a target with no instructional days without division errors", () => {
    const result = calculateCurriculumPace(input({
      term: { startsOn: "2026-01-05", endsOn: "2026-01-06", instructionalWeekdays: [0] },
      target: { ...input().target, targetCompletionDate: "2026-01-06" },
    }));
    expect(result.expectedValue).toBe(0);
    expect(result.state).toBe("blocked");
  });
});

describe("findCrowdedOutSubjects", () => {
  it("ranks subject shortfalls only when learner capacity is already consumed", () => {
    expect(findCrowdedOutSubjects([
      { subject: "Science", expectedWeeklyMinutes: 180, scheduledWeeklyMinutes: 60, learnerCapacityConsumedRatio: 0.95 },
      { subject: "Art", expectedWeeklyMinutes: 90, scheduledWeeklyMinutes: 30, learnerCapacityConsumedRatio: 0.5 },
      { subject: "Math", expectedWeeklyMinutes: 200, scheduledWeeklyMinutes: 180, learnerCapacityConsumedRatio: 0.95 },
    ]).map((subject) => subject.subject)).toEqual(["Science", "Math"]);
  });
});
