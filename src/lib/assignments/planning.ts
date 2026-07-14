export type AssignmentForPlanning = {
  id: string;
  title: string;
  subject: string;
  scheduledDate: string | null;
  estimatedMinutes: number | null;
  status: "planned" | "doing" | "submitted" | "completed" | "skipped" | "needs_review";
  curriculumUnitId?: string | null;
  sequenceNumber?: number | null;
};

export type AdjustmentActionDraft = {
  assignmentId: string | null;
  actionType: "move" | "add_practice";
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
};

export function dailyLoad(assignments: AssignmentForPlanning[], date: string) {
  return assignments
    .filter((item) => item.scheduledDate === date && item.status !== "skipped")
    .reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
}

export function buildMoveForwardProposal(input: {
  assignmentId: string;
  assignments: AssignmentForPlanning[];
  learningDays: string[];
  dailyCapacityMinutes: number;
}) {
  return buildMoveForwardProposalForAssignments({ ...input, assignmentIds: [input.assignmentId] });
}

export function buildMoveForwardProposalForAssignments(input: {
  assignmentIds: string[];
  assignments: AssignmentForPlanning[];
  learningDays: string[];
  dailyCapacityMinutes: number;
}) {
  const requestedIds = new Set(input.assignmentIds);
  const sources = input.assignments
    .filter((item) => requestedIds.has(item.id) && item.scheduledDate && item.status !== "completed" && item.status !== "skipped")
    .sort(compareAssignments);
  if (!sources.length) return [];

  const groups = new Map<string, { sourceDate: string; sequence: AssignmentForPlanning[] }>();
  for (const source of sources) {
    const key = courseKey(source);
    if (groups.has(key)) continue;
    const sourceDate = source.scheduledDate!;
    groups.set(key, {
      sourceDate,
      sequence: input.assignments
        .filter((item) => item.scheduledDate && item.scheduledDate >= sourceDate && item.status !== "completed" && item.status !== "skipped" && courseKey(item) === key)
        .sort(compareAssignments),
    });
  }

  const orderedGroups = [...groups.values()].sort((a, b) => a.sourceDate.localeCompare(b.sourceDate) || compareAssignments(a.sequence[0], b.sequence[0]));
  const movingIds = new Set(orderedGroups.flatMap((group) => group.sequence.map((item) => item.id)));
  const simulated = input.assignments.filter((item) => !movingIds.has(item.id));
  const actions: AdjustmentActionDraft[] = [];

  for (const group of orderedGroups) {
    let afterDate = group.sourceDate;
    for (const item of group.sequence) {
      const nextDate = findAvailableDate({
        afterDate,
        learningDays: input.learningDays,
        assignments: simulated,
        minutes: item.estimatedMinutes ?? 0,
        capacity: input.dailyCapacityMinutes,
      });
      if (!nextDate) break;
      actions.push({ assignmentId: item.id, actionType: "move", beforeState: { scheduledDate: item.scheduledDate }, afterState: { scheduledDate: nextDate } });
      simulated.push({ ...item, scheduledDate: nextDate });
      afterDate = nextDate;
    }
  }
  return actions;
}

function courseKey(item: AssignmentForPlanning) {
  return item.curriculumUnitId ? `unit:${item.curriculumUnitId}` : `subject:${item.subject.trim().toLowerCase()}`;
}

function compareAssignments(a: AssignmentForPlanning, b: AssignmentForPlanning) {
  return (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "") || (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0) || a.title.localeCompare(b.title);
}

export function buildPracticeProposal(input: {
  assignment: AssignmentForPlanning;
  score: number;
  learningDays: string[];
  assignments: AssignmentForPlanning[];
  dailyCapacityMinutes: number;
}) {
  if (input.score >= 75 || !input.assignment.scheduledDate) return null;
  const scheduledDate = findAvailableDate({
    afterDate: input.assignment.scheduledDate,
    learningDays: input.learningDays,
    assignments: input.assignments,
    minutes: 15,
    capacity: input.dailyCapacityMinutes,
  });
  if (!scheduledDate) return null;
  return {
    assignmentId: input.assignment.id,
    actionType: "add_practice" as const,
    beforeState: {},
    afterState: { scheduledDate, estimatedMinutes: 15, subject: input.assignment.subject, title: `${input.assignment.subject} · focused review` },
  };
}

function findAvailableDate(input: { afterDate: string; learningDays: string[]; assignments: AssignmentForPlanning[]; minutes: number; capacity: number }) {
  for (const date of input.learningDays) {
    if (date <= input.afterDate) continue;
    if (dailyLoad(input.assignments, date) + input.minutes <= input.capacity) return date;
  }
  return null;
}
