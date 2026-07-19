export type WeeklyBriefingSchedule = {
  localDate: string;
  localHour: number;
  localMinute: number;
  weekStart: string;
  weekEnd: string;
  due: boolean;
  idempotencyKey: string;
};

export function weeklyBriefingSchedule(now: Date, timeZone: string): WeeklyBriefingSchedule | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    const localDate = `${value("year")}-${value("month")}-${value("day")}`;
    const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[value("weekday")];
    const localHour = Number(value("hour"));
    const localMinute = Number(value("minute"));
    if (!weekday || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isInteger(localHour) || !Number.isInteger(localMinute)) return null;
    const weekStart = addLocalDays(localDate, -(weekday - 1));
    const weekEnd = addLocalDays(weekStart, 6);
    const due = weekday > 1 || localHour > 5 || (localHour === 5 && localMinute >= 0);
    return { localDate, localHour, localMinute, weekStart, weekEnd, due, idempotencyKey: `weekly-briefing:${weekStart}` };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function shouldEnqueueWeeklyBriefing(now: Date, timeZone: string, existingIdempotencyKeys: readonly string[] = []) {
  const schedule = weeklyBriefingSchedule(now, timeZone);
  return Boolean(schedule?.due && !existingIdempotencyKeys.includes(schedule.idempotencyKey));
}

export function addLocalDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
