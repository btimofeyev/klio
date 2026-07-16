export function scheduleDates(startDate: string, weekdays: number[], count: number) {
  const allowed = new Set(weekdays.length ? weekdays : [1, 2, 3, 4, 5]);
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  for (let attempts = 0; attempts < 370 && dates.length < count; attempts += 1) {
    if (allowed.has(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function weekDates(date: string, weekdays: number[] = [1, 2, 3, 4, 5]) {
  const current = new Date(`${date}T12:00:00Z`);
  const day = current.getUTCDay();
  current.setUTCDate(current.getUTCDate() - ((day + 6) % 7));
  const start = current.toISOString().slice(0, 10);
  return scheduleDates(start, weekdays, 5);
}

/** Dates in the calendar week that the family has explicitly enabled for learning. */
export function learningWeekDates(date: string, weekdays: number[] = [1, 2, 3, 4, 5]) {
  const current = new Date(`${date}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
  const allowed = new Set(weekdays.length ? weekdays : [1, 2, 3, 4, 5]);
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(current);
    day.setUTCDate(current.getUTCDate() + offset);
    return day;
  }).filter((day) => allowed.has(day.getUTCDay())).map((day) => day.toISOString().slice(0, 10));
}

export function learnerWeekdays(schedulePreferences: unknown, familyDays: unknown) {
  const learnerDays = schedulePreferences && typeof schedulePreferences === "object" && !Array.isArray(schedulePreferences) && "learningDays" in schedulePreferences
    ? schedulePreferences.learningDays
    : null;
  const values = Array.isArray(learnerDays) && learnerDays.length ? learnerDays : familyDays;
  const map: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2,
    wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  };
  const weekdays = Array.isArray(values) ? values.map((day) => map[String(day).toLowerCase()]).filter((day): day is number => day !== undefined) : [];
  return weekdays.length ? [...new Set(weekdays)] : [1, 2, 3, 4, 5];
}
