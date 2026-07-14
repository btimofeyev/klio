export function nextLearningDate(current: string | null, availableDays: string[], timezone: string, now = new Date()) {
  const start = current ? new Date(`${current}T12:00:00Z`) : new Date(`${dateInTimezone(now, timezone)}T12:00:00Z`);
  const allowed = new Set(availableDays.map((day) => day.toLowerCase()));
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = new Date(start);
    candidate.setUTCDate(start.getUTCDate() + offset);
    const weekday = candidate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
    if (!allowed.size || allowed.has(weekday)) return candidate.toISOString().slice(0, 10);
  }
  return new Date(start.getTime() + 86_400_000).toISOString().slice(0, 10);
}

export function dateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
