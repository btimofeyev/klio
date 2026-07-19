import {
  intervalsOverlap,
  lessonInterval,
  parentAttentionInterval,
  type MinuteInterval,
  type ResolvedAttentionRequirement,
} from "./parent-attention";

export type FamilyDayAssignment = {
  id: string;
  studentId: string;
  curriculumUnitId?: string | null;
  sequenceNumber?: number | null;
  scheduledTime?: string | null;
  fixed?: boolean;
  preserveExistingTime?: boolean;
  explicitPriority?: number;
  requirement: ResolvedAttentionRequirement;
};

export type FamilyDayAvailability = {
  availableMinutes: number;
  teachingWindow?: { start: string; end: string } | null;
  blockedIntervals?: MinuteInterval[];
  allDayBlocked?: boolean;
};

export type FamilyDayPlacement = {
  assignmentId: string;
  studentId: string;
  scheduledTime: string;
  start: number;
  end: number;
  parentInterval: MinuteInterval | null;
  independentInterval: MinuteInterval | null;
  preserved: boolean;
};

export type FamilyDayFailureReason =
  | "insufficient_learner_time"
  | "insufficient_parent_time"
  | "blocked_by_conflicts"
  | "fixed_time_collision"
  | "curriculum_sequence";

export type ArrangeFamilyDayResult = {
  ok: boolean;
  date: string;
  placements: FamilyDayPlacement[];
  proposedScheduledTimes: Array<{ assignmentId: string; scheduledTime: string }>;
  parentAttentionIntervals: Array<MinuteInterval & { assignmentId: string; studentId: string }>;
  independentWorkIntervals: Array<MinuteInterval & { assignmentId: string; studentId: string }>;
  unresolved: Array<{ assignmentId: string; reason: FamilyDayFailureReason }>;
  reason: FamilyDayFailureReason | null;
  conflictDetails: Array<{ firstId: string; secondId?: string; kind: "learner" | "parent" | "availability" | "capacity" }>;
  totalParentMinutes: number;
  totalLearnerMinutes: number;
  preservedExistingTimes: boolean;
};

export function arrangeFamilyDay(input: {
  date: string;
  assignments: readonly FamilyDayAssignment[];
  availability: Record<string, FamilyDayAvailability>;
  existingTimedAssignments?: readonly FamilyDayAssignment[];
  dayStart?: string | number;
  incrementMinutes?: number;
}): ArrangeFamilyDayResult {
  const dayStart = parseStart(input.dayStart ?? "09:00") ?? 540;
  const increment = Math.max(1, Math.min(30, Math.floor(input.incrementMinutes ?? 5)));
  const requested = input.assignments.filter((item) => item.requirement.lessonMinutes > 0);
  const existing = (input.existingTimedAssignments ?? []).filter((item) => item.requirement.lessonMinutes > 0 && item.scheduledTime);
  const totalLearnerMinutes = requested.reduce((total, item) => total + item.requirement.lessonMinutes, 0);
  const totalParentMinutes = requested.reduce((total, item) => total + item.requirement.parentMinutes, 0);
  const conflictDetails: ArrangeFamilyDayResult["conflictDetails"] = [];

  for (const [studentId, work] of groupByStudent(requested)) {
    const availability = input.availability[studentId];
    const minutes = work.reduce((total, item) => total + item.requirement.lessonMinutes, 0);
    if (!availability || availability.allDayBlocked || availability.availableMinutes <= 0) {
      return failure("blocked_by_conflicts", work, conflictDetails.concat(work.map((item) => ({ firstId: item.id, kind: "availability" as const }))), totalParentMinutes, totalLearnerMinutes, input.date);
    }
    if (minutes > availability.availableMinutes) {
      return failure("insufficient_learner_time", work, conflictDetails.concat(work.map((item) => ({ firstId: item.id, kind: "capacity" as const }))), totalParentMinutes, totalLearnerMinutes, input.date);
    }
  }

  const placements: FamilyDayPlacement[] = [];
  const fixed = [...existing, ...requested.filter((item) => item.fixed)]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort(compareStable);
  for (const item of fixed) {
    const start = parseStart(item.scheduledTime);
    const placement = start === null ? null : makePlacement(item, start, true);
    const invalid = !placement || placementConflict(placement, item, placements, input.availability[item.studentId]);
    if (invalid) {
      if (invalid && typeof invalid === "object") conflictDetails.push(invalid);
      return failure("fixed_time_collision", requested, conflictDetails, totalParentMinutes, totalLearnerMinutes, input.date);
    }
    placements.push(placement);
  }

  const preservable = requested.filter((item) => !item.fixed && item.preserveExistingTime && item.scheduledTime).sort(compareStable);
  for (const item of preservable) {
    const start = parseStart(item.scheduledTime);
    if (start === null) continue;
    const placement = makePlacement(item, start, true);
    if (!placementConflict(placement, item, placements, input.availability[item.studentId])) placements.push(placement);
  }

  const pending = requested.filter((item) => !placements.some((placement) => placement.assignmentId === item.id));
  while (pending.length) {
    const ready = pending.filter((item) => !hasEarlierPending(item, pending)).sort(compareSchedulingPriority);
    if (!ready.length) return failure("curriculum_sequence", pending, conflictDetails, totalParentMinutes, totalLearnerMinutes, input.date);
    const item = ready[0];
    const availability = input.availability[item.studentId];
    const bounds = windowBounds(availability, dayStart);
    let placed: FamilyDayPlacement | null = null;
    for (let start = bounds.start; start + item.requirement.lessonMinutes <= bounds.end; start += increment) {
      const candidate = makePlacement(item, start, false);
      if (!placementConflict(candidate, item, placements, availability)) {
        placed = candidate;
        break;
      }
    }
    if (!placed) {
      const parentOnlyBlocked = item.requirement.parentMinutes > 0 && hasLessonSlotIgnoringParent(item, placements, availability, bounds, increment);
      return failure(parentOnlyBlocked ? "insufficient_parent_time" : "blocked_by_conflicts", pending, conflictDetails, totalParentMinutes, totalLearnerMinutes, input.date);
    }
    placements.push(placed);
    pending.splice(pending.indexOf(item), 1);
  }

  const requestedPlacements = placements.filter((placement) => requested.some((item) => item.id === placement.assignmentId)).sort((a, b) => a.start - b.start || a.assignmentId.localeCompare(b.assignmentId));
  return {
    ok: true,
    date: input.date,
    placements: requestedPlacements,
    proposedScheduledTimes: requestedPlacements.filter((placement) => !placement.preserved).map((placement) => ({ assignmentId: placement.assignmentId, scheduledTime: placement.scheduledTime })),
    parentAttentionIntervals: requestedPlacements.flatMap((placement) => placement.parentInterval ? [{ ...placement.parentInterval, assignmentId: placement.assignmentId, studentId: placement.studentId }] : []),
    independentWorkIntervals: requestedPlacements.flatMap((placement) => placement.independentInterval ? [{ ...placement.independentInterval, assignmentId: placement.assignmentId, studentId: placement.studentId }] : []),
    unresolved: [], reason: null, conflictDetails, totalParentMinutes, totalLearnerMinutes,
    preservedExistingTimes: requestedPlacements.filter((placement) => requested.find((item) => item.id === placement.assignmentId)?.scheduledTime).every((placement) => placement.preserved),
  };
}

function placementConflict(placement: FamilyDayPlacement, item: FamilyDayAssignment, placements: readonly FamilyDayPlacement[], availability: FamilyDayAvailability | undefined) {
  if (!availability || !insideAvailability({ start: placement.start, end: placement.end }, availability)) return { firstId: item.id, kind: "availability" as const };
  const learner = placements.find((existing) => existing.studentId === item.studentId && intervalsOverlap(existing, placement));
  if (learner) return { firstId: item.id, secondId: learner.assignmentId, kind: "learner" as const };
  if (placement.parentInterval) {
    const parent = placements.find((existing) => intervalsOverlap(existing.parentInterval, placement.parentInterval));
    if (parent) return { firstId: item.id, secondId: parent.assignmentId, kind: "parent" as const };
  }
  return null;
}

function hasLessonSlotIgnoringParent(item: FamilyDayAssignment, placements: readonly FamilyDayPlacement[], availability: FamilyDayAvailability, bounds: MinuteInterval, increment: number) {
  for (let start = bounds.start; start + item.requirement.lessonMinutes <= bounds.end; start += increment) {
    const interval = { start, end: start + item.requirement.lessonMinutes };
    if (!insideAvailability(interval, availability)) continue;
    if (!placements.some((placement) => placement.studentId === item.studentId && intervalsOverlap(placement, interval))) return true;
  }
  return false;
}

function insideAvailability(interval: MinuteInterval, availability: FamilyDayAvailability) {
  if (availability.allDayBlocked) return false;
  const bounds = windowBounds(availability, interval.start);
  return interval.start >= bounds.start && interval.end <= bounds.end
    && !(availability.blockedIntervals ?? []).some((blocked) => intervalsOverlap(interval, blocked));
}

function windowBounds(availability: FamilyDayAvailability, dayStart: number): MinuteInterval {
  if (availability.teachingWindow) {
    return { start: parseStart(availability.teachingWindow.start) ?? dayStart, end: parseStart(availability.teachingWindow.end) ?? Math.min(1440, dayStart + availability.availableMinutes) };
  }
  // With no parent-defined clock window, daily capacity limits how much the
  // learner may do, not the exact span in which that work may be placed.
  return { start: dayStart, end: Math.min(1440, dayStart + 480 + blockedMinutesAfter(dayStart, availability.blockedIntervals ?? [])) };
}

function blockedMinutesAfter(start: number, blocked: readonly MinuteInterval[]) {
  return blocked.reduce((total, interval) => total + (interval.end > start ? Math.max(0, interval.end - Math.max(start, interval.start)) : 0), 0);
}

function makePlacement(item: FamilyDayAssignment, start: number, preserved: boolean): FamilyDayPlacement {
  const lesson = lessonInterval(start, item.requirement.lessonMinutes)!;
  const parent = parentAttentionInterval(start, item.requirement);
  return {
    assignmentId: item.id, studentId: item.studentId, scheduledTime: formatStart(start), start: lesson.start, end: lesson.end,
    parentInterval: parent,
    independentInterval: item.requirement.lessonMinutes > item.requirement.parentMinutes
      ? { start: start + item.requirement.parentMinutes, end: lesson.end }
      : null,
    preserved,
  };
}

function hasEarlierPending(item: FamilyDayAssignment, pending: readonly FamilyDayAssignment[]) {
  return Boolean(item.curriculumUnitId && item.sequenceNumber !== null && item.sequenceNumber !== undefined && pending.some((candidate) =>
    candidate.curriculumUnitId === item.curriculumUnitId && candidate.sequenceNumber !== null && candidate.sequenceNumber !== undefined && candidate.sequenceNumber < item.sequenceNumber!,
  ));
}

function compareSchedulingPriority(a: FamilyDayAssignment, b: FamilyDayAssignment) {
  return attentionRank(a.requirement.mode) - attentionRank(b.requirement.mode)
    || (b.explicitPriority ?? 0) - (a.explicitPriority ?? 0)
    || (a.curriculumUnitId ?? "").localeCompare(b.curriculumUnitId ?? "")
    || (a.sequenceNumber ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNumber ?? Number.MAX_SAFE_INTEGER)
    || a.id.localeCompare(b.id);
}

function compareStable(a: FamilyDayAssignment, b: FamilyDayAssignment) {
  return (parseStart(a.scheduledTime) ?? Number.MAX_SAFE_INTEGER) - (parseStart(b.scheduledTime) ?? Number.MAX_SAFE_INTEGER)
    || (a.sequenceNumber ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNumber ?? Number.MAX_SAFE_INTEGER)
    || a.id.localeCompare(b.id);
}

function attentionRank(mode: ResolvedAttentionRequirement["mode"]) {
  if (mode === "parent_led" || mode === "unspecified") return 0;
  if (mode === "flexible") return 1;
  return 2;
}

function groupByStudent(items: readonly FamilyDayAssignment[]) {
  const groups = new Map<string, FamilyDayAssignment[]>();
  for (const item of items) groups.set(item.studentId, [...(groups.get(item.studentId) ?? []), item]);
  return groups;
}

function failure(reason: FamilyDayFailureReason, unresolved: readonly FamilyDayAssignment[], conflictDetails: ArrangeFamilyDayResult["conflictDetails"], totalParentMinutes: number, totalLearnerMinutes: number, date: string): ArrangeFamilyDayResult {
  return { ok: false, date, placements: [], proposedScheduledTimes: [], parentAttentionIntervals: [], independentWorkIntervals: [], unresolved: unresolved.map((item) => ({ assignmentId: item.id, reason })), reason, conflictDetails, totalParentMinutes, totalLearnerMinutes, preservedExistingTimes: true };
}

function parseStart(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value < 1440 ? value : null;
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function formatStart(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
