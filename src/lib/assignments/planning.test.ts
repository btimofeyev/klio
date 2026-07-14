import { describe, expect, it } from "vitest";
import { buildMoveForwardProposal, buildMoveForwardProposalForAssignments, buildPracticeProposal, dailyLoad, type AssignmentForPlanning } from "./planning";

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

  it("adds focused practice only after an approved low score", () => {
    expect(buildPracticeProposal({ assignment: assignments[0], score: 68, learningDays: days, assignments, dailyCapacityMinutes: 180 })?.afterState).toMatchObject({ scheduledDate: "2026-07-16", estimatedMinutes: 15 });
    expect(buildPracticeProposal({ assignment: assignments[0], score: 88, learningDays: days, assignments, dailyCapacityMinutes: 180 })).toBeNull();
  });
});
