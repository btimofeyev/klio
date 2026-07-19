import { describe, expect, it } from "vitest";
import { buildScheduleDecisionPresentation, planningProposalNeedsDecision, scheduleDecisionIsRepresentedElsewhere, scheduleDecisionProposalState, scheduleDecisionTurnState } from "./workspace-insight-presentation";

const students = [{ id: "student-noah", displayName: "Noah" }];
const assignments = [
  { id: "lesson-8", studentId: "student-noah", title: "Earth & Life Science 2 · Lesson 8", subject: "Science", estimatedMinutes: 25 },
  { id: "lesson-19", studentId: "student-noah", title: "Grade 2 Reading · Lesson 19", subject: "Reading", estimatedMinutes: 20 },
];

describe("workspace insight presentation", () => {
  it("names the learner and exact lesson for a single schedule decision", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: [{ type: "assignment", id: "lesson-8" }] },
      assignments,
      students,
    );

    expect(presentation?.title).toBe("Noah’s Earth & Life Science 2 · Lesson 8 needs another day");
    expect(presentation?.summary).toContain("without exceeding Noah’s daily limit");
    expect(presentation?.assignments.map((assignment) => assignment.id)).toEqual(["lesson-8"]);
  });

  it("keeps multiple affected lessons visible and creates a bounded editable request", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    );

    expect(presentation?.title).toBe("Noah has 2 lessons that need another day");
    expect(presentation?.assignments).toHaveLength(2);
    expect(presentation?.request).toContain("Earth & Life Science 2 · Lesson 8; Grade 2 Reading · Lesson 19");
    expect(presentation?.request).toContain("stay within Noah’s daily capacity");
    expect(presentation?.request).toContain("do not apply anything automatically");
  });

  it("does not offer an ambiguous learner-wide action when its records cannot be resolved", () => {
    expect(buildScheduleDecisionPresentation(
      { studentId: "missing", kind: "needs_detail", evidenceRefs: [{ type: "assignment", id: "lesson-8" }] },
      assignments,
      students,
    )).toBeNull();
  });

  it("does not mix another learner's work into the decision", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: [{ type: "assignment", id: "lesson-8" }, { type: "assignment", id: "maya-lesson" }] },
      [...assignments, { id: "maya-lesson", studentId: "student-maya", title: "Biology · Lesson 4", subject: "Science", estimatedMinutes: 35 }],
      [...students, { id: "student-maya", displayName: "Maya" }],
    );

    expect(presentation?.assignments.map((assignment) => assignment.id)).toEqual(["lesson-8"]);
    expect(presentation?.request).not.toContain("Biology · Lesson 4");
  });

  it("does not reinterpret other insight kinds as schedule decisions", () => {
    expect(buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "noticed", evidenceRefs: [{ type: "assignment", id: "lesson-8" }] },
      assignments,
      students,
    )).toBeNull();
  });

  it("removes completed and manually rescheduled lessons from an old schedule question", () => {
    const presentation = buildScheduleDecisionPresentation(
      {
        studentId: "student-noah",
        kind: "needs_detail",
        evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })),
        actionRef: { type: "week", date: "2026-07-17" },
      },
      [
        { ...assignments[0], status: "completed", scheduledDate: "2026-07-17" },
        { ...assignments[1], status: "planned", scheduledDate: "2026-07-18" },
      ],
      students,
    );

    expect(presentation).toBeNull();
  });

  it("keeps only the unresolved lessons when part of a schedule question is handled", () => {
    const presentation = buildScheduleDecisionPresentation(
      {
        studentId: "student-noah",
        kind: "needs_detail",
        evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })),
        actionRef: { type: "week", date: "2026-07-17" },
      },
      [
        { ...assignments[0], status: "completed", scheduledDate: "2026-07-17" },
        { ...assignments[1], status: "planned", scheduledDate: "2026-07-17" },
      ],
      students,
    );

    expect(presentation?.title).toBe("Noah’s Grade 2 Reading · Lesson 19 needs another day");
    expect(presentation?.assignments.map((assignment) => assignment.id)).toEqual(["lesson-19"]);
  });

  it("links the exact active handoff to its schedule decision", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    );

    expect(presentation).not.toBeNull();
    expect(scheduleDecisionTurnState(presentation!, {
      status: "running",
      request: presentation!.request,
      studentId: "student-noah",
    })).toBe("working");
    expect(presentation?.workingTitle).toBe("Klio is making room for Noah’s 2 lessons");
  });

  it("does not mark unrelated or finished work as this decision's active handoff", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    )!;

    expect(scheduleDecisionTurnState(presentation, {
      status: "running",
      request: "Review Noah’s recent learning records.",
      studentId: "student-noah",
    })).toBeNull();
    expect(scheduleDecisionTurnState(presentation, {
      status: "completed",
      request: presentation.request,
      studentId: "student-noah",
    })).toBeNull();
  });

  it("keeps a matching clarification distinct from active processing", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: [{ type: "assignment", id: "lesson-8" }] },
      assignments,
      students,
    )!;

    expect(scheduleDecisionTurnState(presentation, {
      status: "awaiting_parent",
      request: presentation.request,
      studentId: "student-noah",
    })).toBe("needs_input");
  });

  it("recognizes a ready proposal that covers all affected lessons", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    )!;

    expect(scheduleDecisionProposalState(presentation, [{
      id: "proposal-1",
      studentId: "student-noah",
      status: "proposed",
      summary: "Shorten both lessons so they fit Friday.",
      changes: { assignmentIds: ["lesson-8", "lesson-19"], changes: [] },
      targetAssignmentId: null,
    }])).toEqual({ id: "proposal-1", status: "proposed", summary: "Shorten both lessons so they fit Friday." });
  });

  it("treats a ready proposal or matching active turn as the same parent decision", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    )!;
    const proposal = {
      id: "proposal-1",
      studentId: "student-noah",
      status: "proposed",
      summary: "Shorten both lessons so they fit Friday.",
      changes: { assignmentIds: ["lesson-8", "lesson-19"], changes: [] },
      targetAssignmentId: null,
    };

    expect(scheduleDecisionIsRepresentedElsewhere(presentation, [proposal], [])).toBe(true);
    expect(scheduleDecisionIsRepresentedElsewhere(presentation, [], [{ status: "running", request: presentation.request, studentId: "student-noah" }])).toBe(true);
    expect(scheduleDecisionIsRepresentedElsewhere(presentation, [], [])).toBe(false);
  });

  it("marks an applied matching proposal as the terminal state", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    )!;

    expect(scheduleDecisionProposalState(presentation, [{
      id: "proposal-applied",
      studentId: "student-noah",
      status: "applied",
      summary: "The week now fits.",
      changes: { assignmentIds: ["lesson-8", "lesson-19"] },
      targetAssignmentId: null,
    }])?.status).toBe("applied");
  });

  it("does not resolve a decision from a partial or cross-learner proposal", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    )!;

    expect(scheduleDecisionProposalState(presentation, [{
      id: "proposal-partial",
      studentId: "student-noah",
      status: "applied",
      summary: "Only one lesson changed.",
      changes: { assignmentIds: ["lesson-8"] },
      targetAssignmentId: null,
    }])).toBeNull();
    expect(scheduleDecisionProposalState(presentation, [{
      id: "proposal-other-family-learner",
      studentId: "student-maya",
      status: "applied",
      summary: "Another learner changed.",
      changes: { assignmentIds: ["lesson-8", "lesson-19"] },
      targetAssignmentId: null,
    }])).toBeNull();
  });

  it("does not let an older applied proposal hide a newer schedule decision", () => {
    const presentation = buildScheduleDecisionPresentation(
      { studentId: "student-noah", kind: "needs_detail", createdAt: "2026-07-17T14:00:00.000Z", evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })) },
      assignments,
      students,
    )!;

    expect(scheduleDecisionProposalState(presentation, [{
      id: "proposal-old",
      studentId: "student-noah",
      status: "applied",
      summary: "An earlier change.",
      changes: { assignmentIds: ["lesson-8", "lesson-19"] },
      targetAssignmentId: null,
      createdAt: "2026-07-16T14:00:00.000Z",
    }])).toBeNull();
  });

  it("does not ask for a decision when a resize is already satisfied", () => {
    const resize = {
      id: "resize-reading",
      studentId: "student-noah",
      status: "proposed",
      summary: "Shorten reading.",
      changes: { before: 25, after: 20 },
      targetAssignmentId: "lesson-19",
      actionName: "resize_schedule_work",
    };

    expect(planningProposalNeedsDecision(resize, assignments)).toBe(false);
    expect(planningProposalNeedsDecision({ ...resize, changes: { before: 25, after: 15 } }, assignments)).toBe(true);
  });

  it("keeps only schedule proposals whose requested state is still outstanding", () => {
    const proposal = {
      id: "week-change",
      studentId: "student-noah",
      status: "proposed",
      summary: "Move and resize work.",
      changes: { changes: [{ assignmentId: "lesson-8", scheduledDate: "2026-07-20", estimatedMinutes: 25 }] },
      targetAssignmentId: null,
      actionName: "prepare_week",
    };
    const current = assignments.map((assignment) => assignment.id === "lesson-8" ? { ...assignment, scheduledDate: "2026-07-20" } : assignment);

    expect(planningProposalNeedsDecision(proposal, current)).toBe(false);
    expect(planningProposalNeedsDecision(proposal, assignments)).toBe(true);
    expect(planningProposalNeedsDecision({ ...proposal, changes: { assignmentIds: ["lesson-8"] } }, current)).toBe(true);
  });

  it("keeps non-schedule proposals in the decision queue", () => {
    expect(planningProposalNeedsDecision({
      id: "goal-1",
      studentId: "student-noah",
      status: "proposed",
      summary: "Set a term goal.",
      changes: { title: "Finish reading" },
      targetAssignmentId: null,
      actionName: "create_goal",
    }, assignments)).toBe(true);
  });
});
