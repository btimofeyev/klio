export const ATTENTION_MODES = ["unspecified", "parent_led", "independent", "flexible"] as const;

export type AttentionMode = (typeof ATTENTION_MODES)[number];
export type AttentionSource = "assignment" | "curriculum" | "fallback";

export type ResolvedAttentionRequirement = {
  mode: AttentionMode;
  lessonMinutes: number;
  parentMinutes: number;
  inherited: boolean;
  source: AttentionSource;
};

export type MinuteInterval = { start: number; end: number };

export type TimedAttentionWork = {
  id: string;
  studentId: string;
  scheduledStart: number | string | null;
  requirement: ResolvedAttentionRequirement;
};

export function validateAttentionMode(value: unknown): AttentionMode {
  if (typeof value === "string" && ATTENTION_MODES.includes(value as AttentionMode)) return value as AttentionMode;
  throw new TypeError("Choose a valid parent support type.");
}

export function resolveAttentionRequirement(input: {
  assignmentMode?: unknown;
  assignmentParentMinutes?: unknown;
  curriculumMode?: unknown;
  curriculumParentMinutes?: unknown;
  lessonMinutes?: unknown;
}): ResolvedAttentionRequirement {
  const lessonMinutes = normalizeLessonMinutes(input.lessonMinutes);
  const hasAssignmentOverride = input.assignmentMode !== null && input.assignmentMode !== undefined;
  const hasCurriculumDefault = input.curriculumMode !== null && input.curriculumMode !== undefined;
  const mode = hasAssignmentOverride
    ? validateAttentionMode(input.assignmentMode)
    : hasCurriculumDefault
      ? validateAttentionMode(input.curriculumMode)
      : "unspecified";
  const source: AttentionSource = hasAssignmentOverride ? "assignment" : hasCurriculumDefault ? "curriculum" : "fallback";
  const configuredMinutes = source === "assignment" ? input.assignmentParentMinutes : source === "curriculum" ? input.curriculumParentMinutes : null;

  let parentMinutes: number;
  if (mode === "independent") parentMinutes = 0;
  else if (mode === "parent_led" || mode === "unspecified") parentMinutes = lessonMinutes;
  else parentMinutes = flexibleMinutes(configuredMinutes, lessonMinutes);

  return { mode, lessonMinutes, parentMinutes, inherited: source !== "assignment", source };
}

export function lessonInterval(start: number | string | null | undefined, lessonMinutes: number): MinuteInterval | null {
  const parsed = startMinutes(start);
  if (parsed === null || !Number.isFinite(lessonMinutes) || lessonMinutes <= 0) return null;
  return { start: parsed, end: parsed + Math.floor(lessonMinutes) };
}

export function parentAttentionInterval(start: number | string | null | undefined, requirement: ResolvedAttentionRequirement): MinuteInterval | null {
  if (requirement.parentMinutes <= 0) return null;
  return lessonInterval(start, requirement.parentMinutes);
}

export function intervalsOverlap(a: MinuteInterval | null | undefined, b: MinuteInterval | null | undefined) {
  return Boolean(a && b && a.start < b.end && b.start < a.end);
}

export function calculateDailyParentMinutes(requirements: readonly ResolvedAttentionRequirement[]) {
  return requirements.reduce((total, requirement) => total + requirement.parentMinutes, 0);
}

export function calculateSharedParentAvailableMinutes(availabilities: ReadonlyArray<{
  availableMinutes: number;
  teachingWindow?: { start: string; end: string } | null;
  blockedIntervals?: readonly MinuteInterval[];
}>) {
  const explicit = availabilities.filter((item) => item.teachingWindow);
  if (!explicit.length) return availabilities.reduce((total, item) => total + Math.max(0, item.availableMinutes), 0);
  const intervals = explicit.flatMap((item) => {
    const start = startMinutes(item.teachingWindow!.start);
    const end = startMinutes(item.teachingWindow!.end);
    if (start === null || end === null || end <= start || item.availableMinutes <= 0) return [];
    const segments: MinuteInterval[] = [];
    let cursor = start;
    for (const blocked of [...(item.blockedIntervals ?? [])].sort((a, b) => a.start - b.start)) {
      if (blocked.start > cursor) segments.push({ start: cursor, end: Math.min(blocked.start, end) });
      cursor = Math.max(cursor, blocked.end);
    }
    if (cursor < end) segments.push({ start: cursor, end });
    return segments;
  });
  return mergedMinutes(intervals) + availabilities.filter((item) => !item.teachingWindow).reduce((total, item) => total + Math.max(0, item.availableMinutes), 0);
}

export function findParentAttentionConflicts(work: readonly TimedAttentionWork[]) {
  const timed = work.flatMap((item) => {
    const interval = parentAttentionInterval(item.scheduledStart, item.requirement);
    return interval ? [{ ...item, interval }] : [];
  });
  const conflicts: Array<{ firstId: string; secondId: string; firstStudentId: string; secondStudentId: string; overlap: MinuteInterval }> = [];
  for (let index = 0; index < timed.length; index += 1) {
    for (let other = index + 1; other < timed.length; other += 1) {
      const first = timed[index];
      const second = timed[other];
      if (!intervalsOverlap(first.interval, second.interval)) continue;
      conflicts.push({
        firstId: first.id,
        secondId: second.id,
        firstStudentId: first.studentId,
        secondStudentId: second.studentId,
        overlap: { start: Math.max(first.interval.start, second.interval.start), end: Math.min(first.interval.end, second.interval.end) },
      });
    }
  }
  return conflicts;
}

export function calculateConcurrentIndependentMinutes(work: readonly TimedAttentionWork[]) {
  const parentIntervals = work.flatMap((item) => {
    const interval = parentAttentionInterval(item.scheduledStart, item.requirement);
    return interval ? [{ studentId: item.studentId, interval }] : [];
  });
  return work.reduce((total, item) => {
    if (item.requirement.mode !== "independent") return total;
    const independent = lessonInterval(item.scheduledStart, item.requirement.lessonMinutes);
    if (!independent) return total;
    const overlaps = parentIntervals
      .filter((parent) => parent.studentId !== item.studentId)
      .map((parent) => intersection(independent, parent.interval))
      .filter((value): value is MinuteInterval => Boolean(value));
    return total + mergedMinutes(overlaps);
  }, 0);
}

function normalizeLessonMinutes(value: unknown) {
  if (value === null || value === undefined) return 0;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 480) throw new RangeError("Lesson length must be between 0 and 480 minutes.");
  return Math.floor(minutes);
}

function flexibleMinutes(value: unknown, lessonMinutes: number) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 480) throw new RangeError("Minutes together must be between 1 and 480.");
  if (lessonMinutes <= 0) throw new RangeError("Add a lesson length before choosing Start together.");
  if (minutes > lessonMinutes) throw new RangeError("Minutes together cannot be longer than the lesson.");
  return minutes;
}

function startMinutes(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value < 1440 ? value : null;
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function intersection(a: MinuteInterval, b: MinuteInterval) {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

function mergedMinutes(intervals: readonly MinuteInterval[]) {
  const ordered = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MinuteInterval[] = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval.start >= previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged.reduce((total, interval) => total + interval.end - interval.start, 0);
}
