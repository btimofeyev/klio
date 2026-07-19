export type CalendarMonthDay = { date: string; inMonth: boolean };

export function monthGrid(anchorDate: string): CalendarMonthDay[] {
  const anchor = parseLocalDate(anchorDate);
  if (!anchor) throw new Error("Invalid calendar date.");
  const first = new Date(Date.UTC(anchor.year, anchor.month - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(1 - leading);
  const last = new Date(Date.UTC(anchor.year, anchor.month, 0));
  const trailing = (7 - ((last.getUTCDay() + 6) % 7) - 1) % 7;
  const count = leading + last.getUTCDate() + trailing;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return { date: formatDate(date), inMonth: date.getUTCMonth() === first.getUTCMonth() };
  });
}

export function shiftMonth(anchorDate: string, amount: number) {
  const anchor = parseLocalDate(anchorDate);
  if (!anchor) throw new Error("Invalid calendar date.");
  const date = new Date(Date.UTC(anchor.year, anchor.month - 1 + amount, 1));
  return formatDate(date);
}

export function sameLocalDate(a: string, b: string) { return a === b; }

export function monthLabel(anchorDate: string) {
  const anchor = parseLocalDate(anchorDate);
  if (!anchor) throw new Error("Invalid calendar date.");
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(anchor.year, anchor.month - 1, 1)));
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function formatDate(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}
