import { describe, expect, it } from "vitest";
import { buildWeeklyFamilyBriefing, type WeeklyBriefingBuilderInput } from "./weekly-briefing";

const familyId = "family-a";
const weekStart = "2026-07-13";

function input(overrides: Partial<WeeklyBriefingBuilderInput> = {}): WeeklyBriefingBuilderInput {
  return {
    familyId,
    weekStart,
    generatedAt: "2026-07-13T09:00:00.000Z",
    students: [
      { familyId, id: "maya", displayName: "Maya", dailyCapacityMinutes: 120, active: true },
      { familyId, id: "noah", displayName: "Noah", dailyCapacityMinutes: 90, active: true },
    ],
    assignments: [
      { familyId, id: "maya-math", studentId: "maya", title: "Math 12", subject: "Math", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 40 },
      { familyId, id: "maya-history", studentId: "maya", title: "History 4", subject: "History", status: "planned", scheduledDate: "2026-07-14", estimatedMinutes: 35 },
      { familyId, id: "noah-reading", studentId: "noah", title: "Reading 8", subject: "Reading", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 30 },
    ],
    submissions: [], pacingCheckpoints: [], crowdedSubjects: [], reviewedEvidence: [],
    ...overrides,
  };
}

describe("weekly family briefing builder", () => {
  it("builds stable schedule totals for a normal multi-learner week", () => {
    const result = buildWeeklyFamilyBriefing(input());
    expect(result.learners).toEqual([
      expect.objectContaining({ displayName: "Maya", plannedCount: 2, plannedMinutes: 75 }),
      expect.objectContaining({ displayName: "Noah", plannedCount: 1, plannedMinutes: 30 }),
    ]);
    expect(result.weekEnd).toBe("2026-07-19");
    expect(result.onTrack).toBe(true);
  });

  it("produces a useful quiet briefing with no assignments", () => {
    const result = buildWeeklyFamilyBriefing(input({ assignments: [] }));
    expect(result.onTrack).toBe(true);
    expect(result.summary).toBe("There is no work on the schedule yet. Klio can help build the week.");
    expect(result.actions).toEqual([]);
  });

  it("handles a family with no active learners", () => {
    const result = buildWeeklyFamilyBriefing(input({ students: [], assignments: [] }));
    expect(result.learners).toEqual([]);
    expect(result.summary).toBe("Add a learner when you are ready to build the family week.");
  });

  it("counts last-week unfinished work separately from completed work", () => {
    const result = buildWeeklyFamilyBriefing(input({ assignments: [
      ...input().assignments,
      { familyId, id: "done", studentId: "maya", title: "Done", subject: "Math", status: "completed", scheduledDate: "2026-07-10", estimatedMinutes: 20 },
      { familyId, id: "open", studentId: "maya", title: "Open", subject: "Math", status: "doing", scheduledDate: "2026-07-09", estimatedMinutes: 20 },
      { familyId, id: "noah-done", studentId: "noah", title: "Done", subject: "Reading", status: "completed", scheduledDate: "2026-07-08", estimatedMinutes: 20 },
    ] }));
    expect(result.previousWeek).toMatchObject({
      completedCount: 2,
      unfinishedCount: 1,
      byLearner: [
        { studentId: "maya", completedCount: 1, unfinishedCount: 1, awaitingReviewCount: 0 },
        { studentId: "noah", completedCount: 1, unfinishedCount: 0, awaitingReviewCount: 0 },
      ],
    });
    expect(result.actions.some((action) => action.kind === "decide_unfinished")).toBe(true);
  });

  it("ranks pending parent reviews first without making a mastery claim", () => {
    const result = buildWeeklyFamilyBriefing(input({ submissions: [{ familyId, id: "submission", assignmentId: "maya-math", studentId: "maya", submittedAt: "2026-07-12T15:00:00Z", awaitingParentReview: true }] }));
    expect(result.previousWeek.awaitingReviewCount).toBe(1);
    expect(result.actions[0]).toMatchObject({ kind: "review_submissions", priority: 100, target: { type: "review_queue" } });
    expect(result.actions[0].explanation).toContain("No mastery conclusion");
  });

  it("finds over-capacity days with their assignment references", () => {
    const result = buildWeeklyFamilyBriefing(input({ assignments: [
      ...input().assignments,
      { familyId, id: "maya-science", studentId: "maya", title: "Science", subject: "Science", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 95 },
    ] }));
    expect(result.learners[0].overCapacityDays[0]).toEqual({ date: "2026-07-13", plannedMinutes: 135, capacityMinutes: 120, assignmentIds: ["maya-math", "maya-science"] });
    expect(result.actions[0].kind).toBe("resolve_capacity");
  });

  it("includes pacing and crowded-subject concerns without inventing them", () => {
    const result = buildWeeklyFamilyBriefing(input({
      pacingCheckpoints: [{ familyId, id: "pace", studentId: "maya", goalId: "goal", goalTitle: "Finish Algebra", state: "at_risk", feasible: true, actualValue: 4, expectedValue: 6 }],
      crowdedSubjects: [{ familyId, studentId: "noah", subject: "Science", scheduledWeeklyMinutes: 20, expectedWeeklyMinutes: 60, shortfallMinutes: 40 }],
    }));
    expect(result.pacing.map((item) => item.kind)).toEqual(["pacing_concern", "crowded_subject"]);
    expect(result.onTrack).toBe(false);
  });

  it("groups many pacing concerns into one parent decision", () => {
    const result = buildWeeklyFamilyBriefing(input({
      pacingCheckpoints: [
        { familyId, id: "pace-math", studentId: "maya", goalId: "goal-math", goalTitle: "Finish Algebra", state: "at_risk", feasible: true, actualValue: 4, expectedValue: 6 },
        { familyId, id: "pace-reading", studentId: "noah", goalId: "goal-reading", goalTitle: "Finish Reading", state: "blocked", feasible: false, actualValue: 3, expectedValue: 6 },
      ],
    }));
    const pacingActions = result.actions.filter((action) => action.kind === "review_pacing");
    expect(pacingActions).toHaveLength(1);
    expect(pacingActions[0]).toMatchObject({ label: "Prepare one pacing adjustment", target: { goalIds: ["goal-math", "goal-reading"] } });
    expect(pacingActions[0].explanation).toContain("one balanced proposal");
  });

  it("uses only approved final evidence in learning trends", () => {
    const base = { familyId, studentId: "maya", subject: "Math", writtenReviewRequired: false, writtenReviewCompleted: false };
    const result = buildWeeklyFamilyBriefing(input({ reviewedEvidence: [
      { ...base, id: "approved-1", score: 70, occurredAt: "2026-07-01T12:00:00Z", approved: true, final: true },
      { ...base, id: "draft", score: 10, occurredAt: "2026-07-02T12:00:00Z", approved: false, final: false },
      { ...base, id: "approved-2", score: 85, occurredAt: "2026-07-03T12:00:00Z", approved: true, final: true },
      { ...base, id: "written-provisional", score: 100, occurredAt: "2026-07-04T12:00:00Z", approved: true, final: true, writtenReviewRequired: true, writtenReviewCompleted: false },
    ] }));
    const trend = result.pacing.find((item) => item.kind === "approved_evidence_trend");
    expect(trend?.explanation).toContain("70 to 85 across 2 reviewed records");
    expect(trend?.evidenceRefs.map((ref) => ref.id)).toEqual(["approved-1", "approved-2"]);
  });

  it("limits actions to three with stable priority ordering", () => {
    const base = input();
    const result = buildWeeklyFamilyBriefing(input({
      assignments: [
        ...base.assignments,
        { familyId, id: "over", studentId: "maya", title: "Long", subject: "Science", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 120 },
        { familyId, id: "old", studentId: "noah", title: "Old", subject: "Reading", status: "planned", scheduledDate: "2026-07-10", estimatedMinutes: 20 },
        { familyId, id: "unscheduled", studentId: "noah", title: "Loose", subject: "Art", status: "planned", scheduledDate: null, estimatedMinutes: 20 },
      ],
      submissions: [{ familyId, id: "review", assignmentId: "maya-math", studentId: "maya", submittedAt: "2026-07-12T15:00:00Z", awaitingParentReview: true }],
      pacingCheckpoints: [{ familyId, id: "pace", studentId: "maya", goalId: "goal", goalTitle: "Finish Algebra", state: "blocked", feasible: false, actualValue: 2, expectedValue: 6 }],
    }));
    expect(result.actions).toHaveLength(3);
    expect(result.actions.map((action) => action.kind)).toEqual(["review_submissions", "resolve_capacity", "decide_unfinished"]);
  });

  it("defensively excludes cross-family records", () => {
    const result = buildWeeklyFamilyBriefing(input({ assignments: [
      ...input().assignments,
      { familyId: "family-b", id: "foreign", studentId: "maya", title: "Foreign", subject: "Math", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 999 },
    ], submissions: [{ familyId: "family-b", id: "foreign-submission", assignmentId: "maya-math", studentId: "maya", submittedAt: "2026-07-12T15:00:00Z", awaitingParentReview: true }] }));
    expect(result.learners[0].plannedMinutes).toBe(75);
    expect(result.previousWeek.awaitingReviewCount).toBe(0);
  });

  it("summarizes direct parent minutes by learner and flags a bounded load problem", () => {
    const schedulePreferences = { learningDays: ["Mon"], teachingWindows: { Mon: { start: "09:00", end: "12:00" } } };
    const result = buildWeeklyFamilyBriefing(input({
      students: [
        { familyId, id: "maya", displayName: "Maya", dailyCapacityMinutes: 180, schedulePreferences, active: true },
        { familyId, id: "noah", displayName: "Noah", dailyCapacityMinutes: 180, schedulePreferences, active: true },
      ],
      assignments: [
        { familyId, id: "maya-math", studentId: "maya", title: "Math", subject: "Math", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 120, attentionMode: "parent_led" },
        { familyId, id: "noah-writing", studentId: "noah", title: "Writing", subject: "Writing", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 90, attentionMode: "parent_led" },
      ],
      conflicts: [{ familyId, id: "appointment", studentId: null, conflictDate: "2026-07-13", allDay: false, startsAt: "11:45", endsAt: "12:00", title: "Dental appointment" }],
    }));
    expect(result.parentAttention.totalMinutes).toBe(210);
    expect(result.parentAttention.byLearner).toEqual([
      { studentId: "maya", displayName: "Maya", minutes: 120 },
      { studentId: "noah", displayName: "Noah", minutes: 90 },
    ]);
    expect(result.parentAttention.days[0]).toMatchObject({ requiredMinutes: 210, availableMinutes: 165, overCapacity: true });
    expect(result.parentAttention.days[0].studentIds).toEqual(["maya", "noah"]);
    expect(result.actions.find((action) => action.kind === "resolve_parent_attention")?.explanation).toContain("a schedule proposal");
  });

  it("warns about fixed parent collisions but not safe independent overlap", () => {
    const assignments: WeeklyBriefingBuilderInput["assignments"] = [
      { familyId, id: "maya-math", studentId: "maya", title: "Math", subject: "Math", status: "planned", scheduledDate: "2026-07-13", scheduledTime: "10:00", estimatedMinutes: 40, attentionMode: "parent_led" },
      { familyId, id: "noah-reading", studentId: "noah", title: "Reading", subject: "Reading", status: "planned", scheduledDate: "2026-07-13", scheduledTime: "10:00", estimatedMinutes: 30, attentionMode: "independent" },
    ];
    const safe = buildWeeklyFamilyBriefing(input({ assignments }));
    expect(safe.parentAttention.days[0].fixedConflicts).toEqual([]);
    expect(safe.actions.some((action) => action.kind === "resolve_parent_attention")).toBe(false);

    const collision = buildWeeklyFamilyBriefing(input({ assignments: assignments.map((assignment) => assignment.id === "noah-reading" ? { ...assignment, attentionMode: "unspecified" } : assignment) }));
    expect(collision.parentAttention.days[0].fixedConflicts).toEqual([
      expect.objectContaining({ firstAssignmentId: "maya-math", secondAssignmentId: "noah-reading", startsAt: "10:00" }),
    ]);
    expect(collision.actions.filter((action) => action.kind === "resolve_parent_attention")).toHaveLength(1);
  });

  it("does not claim an exact clock collision for untimed parent work", () => {
    const result = buildWeeklyFamilyBriefing(input({ assignments: [
      { familyId, id: "maya-math", studentId: "maya", title: "Math", subject: "Math", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 40, attentionMode: "parent_led" },
      { familyId, id: "noah-writing", studentId: "noah", title: "Writing", subject: "Writing", status: "planned", scheduledDate: "2026-07-13", estimatedMinutes: 30, attentionMode: "parent_led" },
    ] }));
    expect(result.parentAttention.days[0].fixedConflicts).toEqual([]);
  });
});
