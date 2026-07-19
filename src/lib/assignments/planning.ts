export type AssignmentForPlanning = {
  id: string;
  title: string;
  subject: string;
  scheduledDate: string | null;
  estimatedMinutes: number | null;
  status: "planned" | "doing" | "submitted" | "completed" | "skipped" | "needs_review";
  curriculumUnitId?: string | null;
  sequenceNumber?: number | null;
  sourceKind?: string | null;
  scheduledTime?: string | null;
};

export type AdjustmentActionDraft = {
  assignmentId: string | null;
  actionType: "move" | "add_practice";
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
};

export type PlanningAvailabilityByDate = Record<string, { availableMinutes: number; blockedIntervals?: Array<{ start: number; end: number }>; teachingWindow?: { start: string; end: string } | null }>;

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
  availabilityByDate?: PlanningAvailabilityByDate;
}) {
  return buildMoveForwardProposalForAssignments({ ...input, assignmentIds: [input.assignmentId] });
}

export function buildMoveForwardProposalForAssignments(input: {
  assignmentIds: string[];
  assignments: AssignmentForPlanning[];
  learningDays: string[];
  dailyCapacityMinutes: number;
  availabilityByDate?: PlanningAvailabilityByDate;
}) {
  const requestedIds = new Set(input.assignmentIds);
  const sources = input.assignments
    .filter((item) => requestedIds.has(item.id) && item.scheduledDate && item.status !== "completed" && item.status !== "skipped")
    .sort(compareAssignments);
  if (!sources.length) return [];

  const groups = new Map<string, { sourceDate: string; minimumSequence: number | null; sequence: AssignmentForPlanning[] }>();
  for (const source of sources) {
    const key = courseKey(source);
    const sourceDate = source.scheduledDate!;
    const existing = groups.get(key);
    const minimumSequence = source.curriculumUnitId && source.sequenceNumber !== null && source.sequenceNumber !== undefined
      ? Math.min(existing?.minimumSequence ?? source.sequenceNumber, source.sequenceNumber)
      : null;
    groups.set(key, { sourceDate: existing ? minDate(existing.sourceDate, sourceDate) : sourceDate, minimumSequence, sequence: [] });
  }
  for (const [key, group] of groups) {
    group.sequence = input.assignments
      .filter((item) => {
        if (!item.scheduledDate || item.status === "completed" || item.status === "skipped" || courseKey(item) !== key) return false;
        if (group.minimumSequence !== null && item.sequenceNumber !== null && item.sequenceNumber !== undefined) {
          return item.sequenceNumber >= group.minimumSequence;
        }
        return item.scheduledDate >= group.sourceDate;
      })
      .sort(group.minimumSequence === null ? compareAssignments : compareCourseSequence);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => a.sourceDate.localeCompare(b.sourceDate) || compareAssignments(a.sequence[0], b.sequence[0]));
  const movingIds = new Set(orderedGroups.flatMap((group) => group.sequence.map((item) => item.id)));
  const simulated = input.assignments.filter((item) => !movingIds.has(item.id));
  const actions: AdjustmentActionDraft[] = [];

  for (const group of orderedGroups) {
    let afterDate = group.sourceDate;
    const groupActions: AdjustmentActionDraft[] = [];
    const groupSimulation = [...simulated];
    for (const item of group.sequence) {
      const nextDate = findAvailableDate({
        afterDate,
        learningDays: input.learningDays,
        assignments: groupSimulation,
        minutes: item.estimatedMinutes ?? 0,
        capacity: input.dailyCapacityMinutes,
        availabilityByDate: input.availabilityByDate,
        work: item,
      });
      // A partial course shift can put a later lesson before an earlier one.
      // Fail the whole bounded plan instead of returning a deceptively safe
      // prefix that corrupts curriculum order.
      if (!nextDate) return [];
      groupActions.push({ assignmentId: item.id, actionType: "move", beforeState: { scheduledDate: item.scheduledDate }, afterState: { scheduledDate: nextDate } });
      groupSimulation.push({ ...item, scheduledDate: nextDate });
      afterDate = nextDate;
    }
    actions.push(...groupActions);
    simulated.push(...groupSimulation.filter((item) => group.sequence.some((moving) => moving.id === item.id)));
  }
  return actions;
}

export function buildCapacityRebalanceProposal(input: {
  targetDate: string;
  assignments: AssignmentForPlanning[];
  learningDays: string[];
  dailyCapacityMinutes: number;
  availabilityByDate?: PlanningAvailabilityByDate;
}) {
  const beforeMinutes = dailyLoad(input.assignments, input.targetDate);
  const targetCapacity = input.availabilityByDate?.[input.targetDate]?.availableMinutes ?? input.dailyCapacityMinutes;
  if (beforeMinutes <= targetCapacity) {
    return { actions: [] as AdjustmentActionDraft[], beforeMinutes, afterMinutes: beforeMinutes, movedFromTarget: 0, shiftedForSequence: 0 };
  }

  const targetWork = input.assignments.filter((item) =>
    item.scheduledDate === input.targetDate && (item.status === "planned" || item.status === "doing"),
  );
  const selected = new Set<string>();

  // Repair any lesson that currently appears before a lower-numbered lesson
  // in the same course. This prevents a capacity fix from preserving an
  // already-invalid curriculum sequence.
  for (const item of targetWork) {
    if (!item.curriculumUnitId || item.sequenceNumber === null || item.sequenceNumber === undefined) continue;
    const lowerLessonIsLater = input.assignments.some((candidate) =>
      candidate.curriculumUnitId === item.curriculumUnitId
      && candidate.status !== "completed" && candidate.status !== "skipped"
      && candidate.sequenceNumber !== null && candidate.sequenceNumber !== undefined
      && candidate.sequenceNumber < item.sequenceNumber!
      && Boolean(candidate.scheduledDate && candidate.scheduledDate > input.targetDate),
    );
    if (lowerLessonIsLater) selected.add(item.id);
  }

  let selectedMinutes = targetWork.filter((item) => selected.has(item.id)).reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
  const overflow = beforeMinutes - targetCapacity;
  const courseBuckets = new Map<string, AssignmentForPlanning[]>();
  for (const item of targetWork.filter((candidate) => !selected.has(candidate.id))) {
    const key = item.sourceKind === "practice" ? `practice:${item.id}` : courseKey(item);
    courseBuckets.set(key, [...(courseBuckets.get(key) ?? []), item]);
  }
  const buckets = [...courseBuckets.values()].map((items) => items.sort(rebalanceCandidateOrder));
  for (let depth = 0; selectedMinutes < overflow; depth += 1) {
    const layer = buckets.flatMap((bucket) => bucket[depth] ? [bucket[depth]] : []).sort(rebalanceCandidateOrder);
    if (!layer.length) break;
    for (const item of layer) {
      selected.add(item.id);
      selectedMinutes += item.estimatedMinutes ?? 0;
      if (selectedMinutes >= overflow) break;
    }
  }
  if (selectedMinutes < overflow) return null;

  const actions = buildMoveForwardProposalForAssignments({
    assignmentIds: [...selected],
    assignments: input.assignments,
    learningDays: input.learningDays,
    dailyCapacityMinutes: input.dailyCapacityMinutes,
    availabilityByDate: input.availabilityByDate,
  });
  if (!actions.length || [...selected].some((id) => !actions.some((action) => action.assignmentId === id))) return null;
  const movedById = new Map(actions.flatMap((action) => action.assignmentId ? [[action.assignmentId, String(action.afterState.scheduledDate)]] : []));
  const simulated = input.assignments.map((item) => movedById.has(item.id) ? { ...item, scheduledDate: movedById.get(item.id)! } : item);
  const afterMinutes = dailyLoad(simulated, input.targetDate);
  const affectedDates = [...new Set(actions.flatMap((action) => [String(action.beforeState.scheduledDate), String(action.afterState.scheduledDate)]))];
  const capacityIsValid = affectedDates.every((date) => dailyLoad(simulated, date) <= (input.availabilityByDate?.[date]?.availableMinutes ?? input.dailyCapacityMinutes));
  const sequenceIsValid = curriculumDatesAreOrdered(simulated);
  if (afterMinutes > targetCapacity || !capacityIsValid || !sequenceIsValid) return null;

  const movedFromTarget = actions.filter((action) => action.beforeState.scheduledDate === input.targetDate && action.afterState.scheduledDate !== input.targetDate).length;
  return { actions, beforeMinutes, afterMinutes, movedFromTarget, shiftedForSequence: Math.max(0, actions.length - movedFromTarget) };
}

function courseKey(item: AssignmentForPlanning) {
  return item.curriculumUnitId ? `unit:${item.curriculumUnitId}` : `subject:${item.subject.trim().toLowerCase()}`;
}

function compareAssignments(a: AssignmentForPlanning, b: AssignmentForPlanning) {
  return (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "") || (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0) || a.title.localeCompare(b.title);
}

function compareCourseSequence(a: AssignmentForPlanning, b: AssignmentForPlanning) {
  return (a.sequenceNumber ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNumber ?? Number.MAX_SAFE_INTEGER) || compareAssignments(a, b);
}

function rebalanceCandidateOrder(a: AssignmentForPlanning, b: AssignmentForPlanning) {
  const practice = Number(b.sourceKind === "practice") - Number(a.sourceKind === "practice");
  if (practice) return practice;
  const time = (b.scheduledTime ?? "").localeCompare(a.scheduledTime ?? "");
  if (time) return time;
  return (b.sequenceNumber ?? -1) - (a.sequenceNumber ?? -1) || a.title.localeCompare(b.title);
}

function curriculumDatesAreOrdered(assignments: AssignmentForPlanning[]) {
  const courses = new Map<string, AssignmentForPlanning[]>();
  for (const item of assignments) {
    if (!item.curriculumUnitId || item.sequenceNumber === null || item.sequenceNumber === undefined || !item.scheduledDate || item.status === "completed" || item.status === "skipped") continue;
    courses.set(item.curriculumUnitId, [...(courses.get(item.curriculumUnitId) ?? []), item]);
  }
  return [...courses.values()].every((items) => items.sort(compareCourseSequence).every((item, index, ordered) => index === 0 || ordered[index - 1].scheduledDate! <= item.scheduledDate!));
}

function minDate(a: string, b: string) { return a < b ? a : b; }

export function buildPracticeProposal(input: {
  assignment: AssignmentForPlanning;
  score: number;
  learningDays: string[];
  assignments: AssignmentForPlanning[];
  dailyCapacityMinutes: number;
  availabilityByDate?: PlanningAvailabilityByDate;
}) {
  if (input.score >= 75 || !input.assignment.scheduledDate) return null;
  const scheduledDate = findAvailableDate({
    afterDate: input.assignment.scheduledDate,
    learningDays: input.learningDays,
    assignments: input.assignments,
    minutes: 15,
    capacity: input.dailyCapacityMinutes,
    availabilityByDate: input.availabilityByDate,
  });
  if (!scheduledDate) return null;
  return {
    assignmentId: input.assignment.id,
    actionType: "add_practice" as const,
    beforeState: {},
    afterState: { scheduledDate, estimatedMinutes: 15, subject: input.assignment.subject, title: `${input.assignment.subject} · focused review` },
  };
}

function findAvailableDate(input: { afterDate: string; learningDays: string[]; assignments: AssignmentForPlanning[]; minutes: number; capacity: number; availabilityByDate?: PlanningAvailabilityByDate; work?: AssignmentForPlanning }) {
  for (const date of input.learningDays) {
    if (date <= input.afterDate) continue;
    const capacity = input.availabilityByDate?.[date]?.availableMinutes ?? input.capacity;
    if (dailyLoad(input.assignments, date) + input.minutes <= capacity && timedWorkFits(date, input.work, input.minutes, input.availabilityByDate)) return date;
  }
  return null;
}

function timedWorkFits(date: string, work: AssignmentForPlanning | undefined, minutes: number, availabilityByDate: PlanningAvailabilityByDate | undefined) {
  if (!work?.scheduledTime) return true;
  const start = parseMinutes(work.scheduledTime);
  if (start === null) return false;
  const end = start + minutes;
  const availability = availabilityByDate?.[date];
  const windowStart = availability?.teachingWindow ? parseMinutes(availability.teachingWindow.start) : 0;
  const windowEnd = availability?.teachingWindow ? parseMinutes(availability.teachingWindow.end) : 1440;
  if (windowStart === null || windowEnd === null || start < windowStart || end > windowEnd) return false;
  return !(availability?.blockedIntervals ?? []).some((interval) => start < interval.end && end > interval.start);
}

function parseMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
