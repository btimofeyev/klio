export type PaceState = "ahead" | "on_pace" | "at_risk" | "blocked" | "complete";
export type PaceBasis = "plan" | "approved_evidence" | "mixed";

export type InstructionalDayOverride = {
  date: string;
  isInstructional: boolean;
  availableMinutes?: number | null;
};

export type PaceAssignment = {
  id: string;
  sequenceNumber: number | null;
  status: "planned" | "doing" | "submitted" | "completed" | "skipped" | "needs_review";
  scheduledDate?: string | null;
  dueAt?: string | null;
  estimatedMinutes?: number | null;
  finalizedApprovedEvidence?: boolean;
};

export type PaceCheckpoint = {
  asOfDate: string;
  expectedValue: number;
  actualValue: number;
  state: PaceState;
  feasible: boolean;
  overdueCount: number;
};

export type CurriculumPaceInput = {
  asOfDate: string;
  term: {
    startsOn: string;
    endsOn: string;
    instructionalWeekdays: number[];
    overrides?: InstructionalDayOverride[];
  };
  goalStatus: "draft" | "active" | "paused" | "blocked" | "completed" | "cancelled";
  target: {
    startsOn: string;
    targetCompletionDate: string;
    startSequence: number;
    targetSequence: number;
    weeklyCadence: number;
    weeklyEffortMinutes: number;
    status: "draft" | "active" | "paused" | "completed" | "cancelled";
  };
  assignments: PaceAssignment[];
  dailyCapacityMinutes: number;
  previousCheckpoint?: PaceCheckpoint | null;
};

export type CurriculumPaceResult = {
  asOfDate: string;
  state: PaceState;
  basis: PaceBasis;
  expectedValue: number;
  actualValue: number;
  targetValue: number;
  remainingValue: number;
  progressRatio: number;
  expectedProgressRatio: number;
  instructionalDaysElapsed: number;
  instructionalDaysTotal: number;
  instructionalDaysRemaining: number;
  overdueAssignmentIds: string[];
  dueAssignmentIds: string[];
  feasible: boolean;
  capacityMinutesRemaining: number;
  requiredMinutesRemaining: number;
  projectedCompletionDate: string | null;
  plannedRecordCount: number;
  approvedEvidenceCount: number;
  change: null | {
    since: string;
    actualDelta: number;
    expectedDelta: number;
    overdueDelta: number;
    stateChanged: boolean;
    feasibilityChanged: boolean;
  };
};

const DAY_MS = 86_400_000;

export function calculateCurriculumPace(input: CurriculumPaceInput): CurriculumPaceResult {
  const asOf = parseDate(input.asOfDate);
  const targetStart = maxDate(parseDate(input.term.startsOn), parseDate(input.target.startsOn));
  const targetEnd = minDate(parseDate(input.term.endsOn), parseDate(input.target.targetCompletionDate));
  const days = instructionalDays(targetStart, targetEnd, input.term.instructionalWeekdays, input.term.overrides ?? []);
  const elapsedDays = days.filter((day) => day.date.getTime() <= asOf.getTime());
  const remainingDays = days.filter((day) => day.date.getTime() > asOf.getTime());
  const targetValue = Math.max(0, input.target.targetSequence - input.target.startSequence + 1);
  const expectedValue = targetValue === 0 || days.length === 0
    ? 0
    : round2(targetValue * clamp(elapsedDays.length / days.length, 0, 1));

  const relevant = input.assignments.filter((assignment) =>
    assignment.sequenceNumber !== null
    && assignment.sequenceNumber >= input.target.startSequence
    && assignment.sequenceNumber <= input.target.targetSequence,
  );
  const completed = dedupeSequences(relevant.filter((assignment) => assignment.status === "completed"));
  const actualValue = Math.min(targetValue, completed.length);
  const remainingValue = Math.max(0, targetValue - actualValue);
  const approvedEvidenceCount = completed.filter((assignment) => assignment.finalizedApprovedEvidence).length;
  const plannedRecordCount = Math.max(0, actualValue - approvedEvidenceCount);
  const basis: PaceBasis = approvedEvidenceCount === 0
    ? "plan"
    : plannedRecordCount === 0
      ? "approved_evidence"
      : "mixed";

  const unfinished = relevant.filter((assignment) => !["completed", "skipped"].includes(assignment.status));
  const overdueAssignmentIds = unfinished
    .filter((assignment) => assignmentDate(assignment) !== null && assignmentDate(assignment)! < input.asOfDate)
    .map((assignment) => assignment.id);
  const dueAssignmentIds = unfinished
    .filter((assignment) => assignmentDate(assignment) === input.asOfDate)
    .map((assignment) => assignment.id);

  const fallbackMinutes = input.target.weeklyEffortMinutes / Math.max(1, input.target.weeklyCadence);
  const knownRemainingMinutes = unfinished.reduce((sum, assignment) => sum + (assignment.estimatedMinutes ?? fallbackMinutes), 0);
  const unknownRemainingCount = Math.max(0, remainingValue - unfinished.length);
  const requiredMinutesRemaining = Math.ceil(knownRemainingMinutes + unknownRemainingCount * fallbackMinutes);
  const capacityMinutesRemaining = Math.floor(remainingDays.reduce(
    (sum, day) => sum + (day.availableMinutes ?? input.dailyCapacityMinutes),
    0,
  ));
  const cadenceSlotsRemaining = remainingDays.length === 0
    ? 0
    : Math.ceil(remainingDays.length / Math.max(1, input.term.instructionalWeekdays.length)) * input.target.weeklyCadence;
  const feasible = remainingValue === 0
    || (remainingValue <= cadenceSlotsRemaining && requiredMinutesRemaining <= capacityMinutesRemaining);

  const tolerance = Math.max(1, targetValue * 0.1);
  const explicitlyBlocked = input.goalStatus === "blocked" || input.target.status === "paused";
  let state: PaceState;
  if (remainingValue === 0 || input.goalStatus === "completed" || input.target.status === "completed") {
    state = "complete";
  } else if (explicitlyBlocked || (remainingDays.length === 0 && remainingValue > 0)) {
    state = "blocked";
  } else if (!feasible || actualValue + tolerance < expectedValue) {
    state = "at_risk";
  } else if (actualValue > expectedValue + tolerance) {
    state = "ahead";
  } else {
    state = "on_pace";
  }

  const projectedCompletionDate = projectCompletionDate({
    asOf,
    targetStart,
    elapsedInstructionalDays: elapsedDays.length,
    actualValue,
    remainingValue,
    remainingDays,
  });
  const previous = input.previousCheckpoint;

  return {
    asOfDate: input.asOfDate,
    state,
    basis,
    expectedValue,
    actualValue,
    targetValue,
    remainingValue,
    progressRatio: targetValue === 0 ? 1 : round4(actualValue / targetValue),
    expectedProgressRatio: targetValue === 0 ? 1 : round4(expectedValue / targetValue),
    instructionalDaysElapsed: elapsedDays.length,
    instructionalDaysTotal: days.length,
    instructionalDaysRemaining: remainingDays.length,
    overdueAssignmentIds,
    dueAssignmentIds,
    feasible,
    capacityMinutesRemaining,
    requiredMinutesRemaining,
    projectedCompletionDate,
    plannedRecordCount,
    approvedEvidenceCount,
    change: previous ? {
      since: previous.asOfDate,
      actualDelta: round2(actualValue - previous.actualValue),
      expectedDelta: round2(expectedValue - previous.expectedValue),
      overdueDelta: overdueAssignmentIds.length - previous.overdueCount,
      stateChanged: state !== previous.state,
      feasibilityChanged: feasible !== previous.feasible,
    } : null,
  };
}

export function findCrowdedOutSubjects(input: Array<{
  subject: string;
  expectedWeeklyMinutes: number;
  scheduledWeeklyMinutes: number;
  learnerCapacityConsumedRatio: number;
}>) {
  return input
    .filter((subject) => subject.expectedWeeklyMinutes > 0)
    .map((subject) => ({
      ...subject,
      shortfallMinutes: Math.max(0, subject.expectedWeeklyMinutes - subject.scheduledWeeklyMinutes),
    }))
    .filter((subject) => subject.shortfallMinutes > 0 && subject.learnerCapacityConsumedRatio >= 0.85)
    .sort((a, b) => b.shortfallMinutes - a.shortfallMinutes || a.subject.localeCompare(b.subject));
}

function instructionalDays(
  startsOn: Date,
  endsOn: Date,
  weekdays: number[],
  overrides: InstructionalDayOverride[],
) {
  if (startsOn > endsOn) return [];
  const weekdaySet = new Set(weekdays);
  const overrideMap = new Map(overrides.map((override) => [override.date, override]));
  const result: Array<{ date: Date; availableMinutes: number | null }> = [];
  for (let cursor = startsOn; cursor <= endsOn; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const key = formatDate(cursor);
    const override = overrideMap.get(key);
    const included = override?.isInstructional ?? weekdaySet.has(cursor.getUTCDay());
    if (included) result.push({ date: cursor, availableMinutes: override?.availableMinutes ?? null });
  }
  return result;
}

function projectCompletionDate(input: {
  asOf: Date;
  targetStart: Date;
  elapsedInstructionalDays: number;
  actualValue: number;
  remainingValue: number;
  remainingDays: Array<{ date: Date }>;
}) {
  if (input.remainingValue === 0) return formatDate(input.asOf);
  if (input.actualValue === 0 || input.elapsedInstructionalDays === 0) return null;
  const unitsPerDay = input.actualValue / input.elapsedInstructionalDays;
  const neededDays = Math.ceil(input.remainingValue / unitsPerDay);
  return input.remainingDays[neededDays - 1] ? formatDate(input.remainingDays[neededDays - 1].date) : null;
}

function dedupeSequences(assignments: PaceAssignment[]) {
  return [...new Map(assignments.map((assignment) => [assignment.sequenceNumber, assignment])).values()];
}

function assignmentDate(assignment: PaceAssignment) {
  if (assignment.dueAt) return assignment.dueAt.slice(0, 10);
  return assignment.scheduledDate ?? null;
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`INVALID_PACING_DATE:${value}`);
  return date;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function minDate(a: Date, b: Date) {
  return a <= b ? a : b;
}

function maxDate(a: Date, b: Date) {
  return a >= b ? a : b;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
