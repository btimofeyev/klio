export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type TeachingWindow = { start: string; end: string };
export type TeachingWindows = Partial<Record<Weekday, TeachingWindow>>;

export type ParsedSchedulePreferences = {
  learningDays: Weekday[];
  teachingWindows: TeachingWindows;
};

export type CalendarConflict = {
  id: string;
  studentId: string | null;
  conflictDate: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  note?: string | null;
};

export type ScheduledWork = {
  id: string;
  studentId: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimatedMinutes: number | null;
  status?: string;
  title?: string;
};

const DEFAULT_DAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function isWallClockTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

export function wallClockMinutes(value: string | null | undefined) {
  if (!value || !isWallClockTime(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function normalizeWallClockTime(value: string) {
  const minutes = wallClockMinutes(value);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function validTeachingWindow(value: unknown): value is TeachingWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const start = "start" in value ? value.start : null;
  const end = "end" in value ? value.end : null;
  const startMinutes = typeof start === "string" ? wallClockMinutes(start) : null;
  const endMinutes = typeof end === "string" ? wallClockMinutes(end) : null;
  return startMinutes !== null && endMinutes !== null && endMinutes - startMinutes >= 30;
}

export function parseTeachingWindows(value: unknown, learningDays: readonly Weekday[]) {
  const result: TeachingWindows = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const source = value as Record<string, unknown>;
  for (const day of learningDays) {
    const candidate = source[day];
    if (!validTeachingWindow(candidate)) continue;
    result[day] = {
      start: normalizeWallClockTime(candidate.start)!,
      end: normalizeWallClockTime(candidate.end)!,
    };
  }
  return result;
}

export function parseSchedulePreferences(value: unknown, fallbackLearningDays: unknown = DEFAULT_DAYS): ParsedSchedulePreferences {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fallback = parseLearningDays(fallbackLearningDays);
  const configured = parseLearningDays(source.learningDays);
  const learningDays = configured.length ? configured : fallback.length ? fallback : DEFAULT_DAYS;
  return {
    learningDays,
    teachingWindows: parseTeachingWindows(source.teachingWindows, learningDays),
  };
}

export function mergeSchedulePreferences(
  existing: unknown,
  input: { learningDays: readonly string[]; teachingWindows: unknown },
) {
  const current = existing && typeof existing === "object" && !Array.isArray(existing)
    ? Object.fromEntries(Object.entries(existing).filter(([, value]) => isJsonValue(value)))
    : {};
  const learningDays = parseLearningDays(input.learningDays);
  if (!learningDays.length) throw new Error("Choose at least one learning day.");
  const teachingWindows = parseTeachingWindowsStrict(input.teachingWindows, learningDays);
  return { ...current, learningDays, teachingWindows };
}

export function weekdayForDate(date: string): Weekday | null {
  const parts = parseLocalDate(date);
  if (!parts) return null;
  const sundayFirst = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return WEEKDAYS[(sundayFirst + 6) % 7];
}

export function teachingWindowForDate(schedulePreferences: unknown, date: string, familyLearningDays?: unknown) {
  const day = weekdayForDate(date);
  if (!day) return null;
  return parseSchedulePreferences(schedulePreferences, familyLearningDays).teachingWindows[day] ?? null;
}

export function applicableConflicts(conflicts: readonly CalendarConflict[], studentId: string, date: string) {
  return conflicts.filter((conflict) => conflict.conflictDate === date && (conflict.studentId === null || conflict.studentId === studentId));
}

export function mergeIntervals(intervals: ReadonlyArray<{ start: number; end: number }>) {
  const ordered = intervals.filter((item) => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

export function effectiveAvailability(input: {
  date: string;
  studentId: string;
  dailyCapacityMinutes: number;
  schedulePreferences: unknown;
  familyLearningDays?: unknown;
  conflicts: readonly CalendarConflict[];
}) {
  const preferences = parseSchedulePreferences(input.schedulePreferences, input.familyLearningDays);
  const weekday = weekdayForDate(input.date);
  const applicable = applicableConflicts(input.conflicts, input.studentId, input.date);
  if (!weekday || !preferences.learningDays.includes(weekday)) {
    return availabilityResult(0, 0, 0, null, [], applicable, "not_learning_day" as const);
  }
  const window = preferences.teachingWindows[weekday] ?? null;
  const windowStart = window ? wallClockMinutes(window.start)! : 0;
  const windowEnd = window ? wallClockMinutes(window.end)! : 1440;
  const baseMinutes = Math.max(0, Math.min(input.dailyCapacityMinutes, window ? windowEnd - windowStart : input.dailyCapacityMinutes));
  if (applicable.some((conflict) => conflict.allDay)) {
    return availabilityResult(0, baseMinutes, baseMinutes, window, [{ start: windowStart, end: windowEnd }], applicable, "all_day_conflict" as const);
  }
  const intervals = applicable.flatMap((conflict) => {
    const start = wallClockMinutes(conflict.startsAt);
    const end = wallClockMinutes(conflict.endsAt);
    if (start === null || end === null || end <= start) return [];
    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    return clippedEnd > clippedStart ? [{ start: clippedStart, end: clippedEnd }] : [];
  });
  const blockedIntervals = mergeIntervals(intervals);
  const blockedMinutes = blockedIntervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  const availableMinutes = Math.max(0, baseMinutes - blockedMinutes);
  return availabilityResult(availableMinutes, baseMinutes, blockedMinutes, window, blockedIntervals, applicable, blockedMinutes ? "reduced_by_conflict" as const : "available" as const);
}

export function lessonOverlapsConflict(work: ScheduledWork, conflict: CalendarConflict) {
  if (!work.scheduledDate || work.scheduledDate !== conflict.conflictDate || work.studentId !== conflict.studentId && conflict.studentId !== null) return false;
  if (!work.scheduledTime || !work.estimatedMinutes || work.estimatedMinutes <= 0) return false;
  if (conflict.allDay) return true;
  const lessonStart = wallClockMinutes(work.scheduledTime);
  const conflictStart = wallClockMinutes(conflict.startsAt);
  const conflictEnd = wallClockMinutes(conflict.endsAt);
  if (lessonStart === null || conflictStart === null || conflictEnd === null) return false;
  return lessonStart < conflictEnd && Math.min(1440, lessonStart + work.estimatedMinutes) > conflictStart;
}

export function analyzeDayLoad(input: {
  date: string;
  studentId: string;
  dailyCapacityMinutes: number;
  schedulePreferences: unknown;
  familyLearningDays?: unknown;
  conflicts: readonly CalendarConflict[];
  assignments: readonly ScheduledWork[];
}) {
  const availability = effectiveAvailability(input);
  const planned = input.assignments.filter((item) => item.studentId === input.studentId && item.scheduledDate === input.date && item.status !== "skipped");
  const plannedMinutes = planned.reduce((sum, item) => sum + Math.max(0, item.estimatedMinutes ?? 0), 0);
  const directOverlapIds = planned.filter((item) => input.conflicts.some((conflict) => lessonOverlapsConflict(item, conflict))).map((item) => item.id);
  return { ...availability, plannedMinutes, overCapacity: plannedMinutes > availability.availableMinutes, directOverlapIds };
}

export function availabilityReason(result: ReturnType<typeof effectiveAvailability>) {
  if (result.reason === "not_learning_day") return "This is not one of the learner’s teaching days.";
  if (result.reason === "all_day_conflict") return "An all-day conflict blocks teaching time.";
  if (result.reason === "reduced_by_conflict") return `${result.blockedMinutes} minutes are blocked, leaving ${result.availableMinutes} minutes available.`;
  return `${result.availableMinutes} minutes are available.`;
}

function availabilityResult(
  availableMinutes: number,
  baseMinutes: number,
  blockedMinutes: number,
  teachingWindow: TeachingWindow | null,
  blockedIntervals: Array<{ start: number; end: number }>,
  conflicts: CalendarConflict[],
  reason: "not_learning_day" | "all_day_conflict" | "reduced_by_conflict" | "available",
) {
  return { availableMinutes, baseMinutes, blockedMinutes, teachingWindow, blockedIntervals, conflicts, allDayBlocked: reason === "all_day_conflict", reason };
}

function parseTeachingWindowsStrict(value: unknown, learningDays: readonly Weekday[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(learningDays);
  const result: TeachingWindows = {};
  for (const [rawDay, candidate] of Object.entries(value)) {
    if (!WEEKDAYS.includes(rawDay as Weekday)) throw new Error("Teaching hours include an unknown weekday.");
    if (!allowed.has(rawDay as Weekday)) continue;
    if (candidate === null) continue;
    if (!validTeachingWindow(candidate)) throw new Error(`${rawDay} teaching hours must be valid and at least 30 minutes long.`);
    result[rawDay as Weekday] = { start: normalizeWallClockTime(candidate.start)!, end: normalizeWallClockTime(candidate.end)! };
  }
  return result;
}

function parseLearningDays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((day): day is Weekday => typeof day === "string" && WEEKDAYS.includes(day as Weekday)))];
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value && typeof value === "object" && Object.values(value).every(isJsonValue));
}
