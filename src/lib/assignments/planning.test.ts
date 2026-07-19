import { describe, expect, it } from "vitest";
import { buildCapacityRebalanceProposal, buildMoveForwardProposal, buildMoveForwardProposalForAssignments, buildPracticeProposal, dailyLoad, type AssignmentForPlanning } from "./planning";

const assignments: AssignmentForPlanning[] = [
  { id: "l8", title: "Algebra · Lesson 8", subject: "Algebra", curriculumUnitId: "algebra", sequenceNumber: 8, scheduledDate: "2026-07-15", estimatedMinutes: 45, status: "planned" },
  { id: "l9", title: "Algebra · Lesson 9", subject: "Algebra", curriculumUnitId: "algebra", sequenceNumber: 9, scheduledDate: "2026-07-16", estimatedMinutes: 45, status: "planned" },
  { id: "history", title: "Primary sources", subject: "History", scheduledDate: "2026-07-16", estimatedMinutes: 80, status: "planned" },
];
const days = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];

describe("capacity-aware planning", () => {
  it("measures active daily load", () => expect(dailyLoad(assignments, "2026-07-16")).toBe(125));

  it("moves an unfinished curriculum chain without creating a collision", () => {
    expect(buildMoveForwardProposal({ assignmentId: "l8", assignments, learningDays: days, dailyCapacityMinutes: 180 })).toEqual([
      { assignmentId: "l8", actionType: "move", beforeState: { scheduledDate: "2026-07-15" }, afterState: { scheduledDate: "2026-07-16" } },
      { assignmentId: "l9", actionType: "move", beforeState: { scheduledDate: "2026-07-16" }, afterState: { scheduledDate: "2026-07-17" } },
    ]);
  });

  it("carries overdue work into the current learning week instead of another past day", () => {
    const overdue: AssignmentForPlanning[] = [
      { id: "missed", title: "Algebra · Lesson 6", subject: "Algebra", curriculumUnitId: "algebra", sequenceNumber: 6, scheduledDate: "2026-07-10", estimatedMinutes: 45, status: "planned" },
      { id: "current", title: "Algebra · Lesson 7", subject: "Algebra", curriculumUnitId: "algebra", sequenceNumber: 7, scheduledDate: "2026-07-14", estimatedMinutes: 45, status: "planned" },
    ];

    expect(buildMoveForwardProposal({ assignmentId: "missed", assignments: overdue, learningDays: ["2026-07-14", "2026-07-15", "2026-07-16"], dailyCapacityMinutes: 180 })).toEqual([
      { assignmentId: "missed", actionType: "move", beforeState: { scheduledDate: "2026-07-10" }, afterState: { scheduledDate: "2026-07-14" } },
      { assignmentId: "current", actionType: "move", beforeState: { scheduledDate: "2026-07-14" }, afterState: { scheduledDate: "2026-07-15" } },
    ]);
  });

  it("coordinates every overdue subject in one capacity-aware proposal", () => {
    const overdue: AssignmentForPlanning[] = [
      { id: "math-1", title: "Math · Lesson 1", subject: "Math", scheduledDate: "2026-07-13", estimatedMinutes: 20, status: "planned" },
      { id: "phonics-1", title: "Phonics · Lesson 1", subject: "Phonics", scheduledDate: "2026-07-13", estimatedMinutes: 20, status: "planned" },
      { id: "spelling-1", title: "Spelling · Lesson 1", subject: "Spelling", scheduledDate: "2026-07-13", estimatedMinutes: 20, status: "planned" },
      { id: "math-2", title: "Math · Lesson 2", subject: "Math", scheduledDate: "2026-07-14", estimatedMinutes: 20, status: "planned" },
    ];

    expect(buildMoveForwardProposalForAssignments({
      assignmentIds: ["math-1", "phonics-1", "spelling-1"],
      assignments: overdue,
      learningDays: ["2026-07-14", "2026-07-15", "2026-07-16"],
      dailyCapacityMinutes: 40,
    })).toEqual([
      { assignmentId: "math-1", actionType: "move", beforeState: { scheduledDate: "2026-07-13" }, afterState: { scheduledDate: "2026-07-14" } },
      { assignmentId: "math-2", actionType: "move", beforeState: { scheduledDate: "2026-07-14" }, afterState: { scheduledDate: "2026-07-15" } },
      { assignmentId: "phonics-1", actionType: "move", beforeState: { scheduledDate: "2026-07-13" }, afterState: { scheduledDate: "2026-07-14" } },
      { assignmentId: "spelling-1", actionType: "move", beforeState: { scheduledDate: "2026-07-13" }, afterState: { scheduledDate: "2026-07-15" } },
    ]);
  });

  it("rebalances the complete authoritative day and repairs curriculum order", () => {
    const overloaded: AssignmentForPlanning[] = [
      { id: "math-22", title: "Algebra 22", subject: "Math", curriculumUnitId: "math", sequenceNumber: 22, scheduledDate: "2026-07-17", scheduledTime: "10:10:00", estimatedMinutes: 45, status: "planned", sourceKind: "curriculum" },
      { id: "math-23", title: "Algebra 23", subject: "Math", curriculumUnitId: "math", sequenceNumber: 23, scheduledDate: "2026-07-17", scheduledTime: "08:30:00", estimatedMinutes: 45, status: "planned", sourceKind: "curriculum" },
      { id: "math-24", title: "Algebra 24", subject: "Math", curriculumUnitId: "math", sequenceNumber: 24, scheduledDate: "2026-07-20", estimatedMinutes: 45, status: "planned", sourceKind: "curriculum" },
      { id: "history-12", title: "History 12", subject: "History", curriculumUnitId: "history", sequenceNumber: 12, scheduledDate: "2026-07-17", estimatedMinutes: 40, status: "planned", sourceKind: "curriculum" },
      { id: "history-15", title: "History 15", subject: "History", curriculumUnitId: "history", sequenceNumber: 15, scheduledDate: "2026-07-17", scheduledTime: "10:00:00", estimatedMinutes: 40, status: "planned", sourceKind: "curriculum" },
      { id: "history-13", title: "History 13", subject: "History", curriculumUnitId: "history", sequenceNumber: 13, scheduledDate: "2026-07-20", estimatedMinutes: 40, status: "planned", sourceKind: "curriculum" },
      { id: "literature-17", title: "Literature 17", subject: "Literature", curriculumUnitId: "literature", sequenceNumber: 17, scheduledDate: "2026-07-17", estimatedMinutes: 40, status: "planned", sourceKind: "curriculum" },
      { id: "writing-13", title: "Writing 13", subject: "Writing", curriculumUnitId: "writing", sequenceNumber: 13, scheduledDate: "2026-07-17", estimatedMinutes: 35, status: "planned", sourceKind: "curriculum" },
      { id: "writing-14", title: "Writing 14", subject: "Writing", curriculumUnitId: "writing", sequenceNumber: 14, scheduledDate: "2026-07-17", scheduledTime: "11:50:00", estimatedMinutes: 35, status: "planned", sourceKind: "curriculum" },
      { id: "practice", title: "Osmosis practice", subject: "Science", scheduledDate: "2026-07-17", estimatedMinutes: 20, status: "planned", sourceKind: "practice" },
    ];
    const result = buildCapacityRebalanceProposal({
      targetDate: "2026-07-17",
      assignments: overloaded,
      learningDays: ["2026-07-17", "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-27", "2026-07-28"],
      dailyCapacityMinutes: 240,
    });

    expect(result).not.toBeNull();
    expect(result?.beforeMinutes).toBe(300);
    expect(result?.afterMinutes).toBeLessThanOrEqual(240);
    expect(result?.actions.some((action) => action.assignmentId === "history-15")).toBe(true);
    expect(result?.actions.some((action) => action.assignmentId === "practice")).toBe(true);
    const dates = new Map(result?.actions.map((action) => [action.assignmentId, action.afterState.scheduledDate]));
    expect(String(dates.get("history-15")) >= "2026-07-20").toBe(true);
  });

  it("returns no plan instead of a partial sequence shift when future capacity is insufficient", () => {
    const work: AssignmentForPlanning[] = [
      { id: "math-1", title: "Math 1", subject: "Math", curriculumUnitId: "math", sequenceNumber: 1, scheduledDate: "2026-07-17", estimatedMinutes: 60, status: "planned" },
      { id: "math-2", title: "Math 2", subject: "Math", curriculumUnitId: "math", sequenceNumber: 2, scheduledDate: "2026-07-20", estimatedMinutes: 60, status: "planned" },
      { id: "other", title: "Other", subject: "Reading", scheduledDate: "2026-07-20", estimatedMinutes: 60, status: "planned" },
    ];
    expect(buildMoveForwardProposalForAssignments({ assignmentIds: ["math-1"], assignments: work, learningDays: ["2026-07-17", "2026-07-20"], dailyCapacityMinutes: 60 })).toEqual([]);
  });

  it("rescheduling skips all-day blocks and reduced-capacity dates", () => {
    const work: AssignmentForPlanning[] = [{ id: "math", title: "Math", subject: "Math", scheduledDate: "2026-07-14", estimatedMinutes: 45, status: "planned" }];
    expect(buildMoveForwardProposal({
      assignmentId: "math", assignments: work, learningDays: ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"], dailyCapacityMinutes: 180,
      availabilityByDate: { "2026-07-15": { availableMinutes: 0 }, "2026-07-16": { availableMinutes: 30 }, "2026-07-17": { availableMinutes: 180 } },
    })[0]?.afterState.scheduledDate).toBe("2026-07-17");
  });

  it("rescheduling timed work avoids blocked intervals", () => {
    const work: AssignmentForPlanning[] = [{ id: "math", title: "Math", subject: "Math", scheduledDate: "2026-07-14", scheduledTime: "10:00", estimatedMinutes: 45, status: "planned" }];
    expect(buildMoveForwardProposal({
      assignmentId: "math", assignments: work, learningDays: ["2026-07-14", "2026-07-15", "2026-07-16"], dailyCapacityMinutes: 180,
      availabilityByDate: { "2026-07-15": { availableMinutes: 120, blockedIntervals: [{ start: 570, end: 660 }] }, "2026-07-16": { availableMinutes: 180 } },
    })[0]?.afterState.scheduledDate).toBe("2026-07-16");
  });

  it("adds focused practice only after an approved low score", () => {
    expect(buildPracticeProposal({ assignment: assignments[0], score: 68, learningDays: days, assignments, dailyCapacityMinutes: 180 })?.afterState).toMatchObject({ scheduledDate: "2026-07-16", estimatedMinutes: 15 });
    expect(buildPracticeProposal({ assignment: assignments[0], score: 88, learningDays: days, assignments, dailyCapacityMinutes: 180 })).toBeNull();
  });
});
