export type RelevantAssignment = {
  id: string;
  status: string;
  scheduled_date: string | null;
  due_at?: string | null;
  updated_at?: string | null;
};

export type AssignmentCohorts<T extends RelevantAssignment> = {
  overdue: T[];
  currentWindow: T[];
  pendingReview: T[];
  unscheduled: T[];
  recentlyCompleted: T[];
};

const priority = ["overdue", "pendingReview", "currentWindow", "unscheduled", "recentlyCompleted"] as const;

export function mergeRelevantAssignments<T extends RelevantAssignment>(
  cohorts: AssignmentCohorts<T>,
  limit = 200,
) {
  const selected: T[] = [];
  const ids = new Set<string>();
  const includedByCohort: Record<(typeof priority)[number], number> = {
    overdue: 0,
    pendingReview: 0,
    currentWindow: 0,
    unscheduled: 0,
    recentlyCompleted: 0,
  };
  for (const name of priority) {
    for (const assignment of cohorts[name]) {
      if (selected.length >= limit) break;
      if (ids.has(assignment.id)) continue;
      ids.add(assignment.id);
      selected.push(assignment);
      includedByCohort[name] += 1;
    }
  }
  const candidateCount = new Set(priority.flatMap((name) => cohorts[name].map((item) => item.id))).size;
  return {
    assignments: selected,
    metadata: {
      limit,
      candidateCount,
      includedCount: selected.length,
      truncated: candidateCount > selected.length,
      includedByCohort,
    },
  };
}

export function dateInFamilyTimezone(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
