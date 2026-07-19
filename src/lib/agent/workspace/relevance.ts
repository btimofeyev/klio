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

export function summarizeDailyWorkloads(input: {
  assignments: Array<{ student_id: string; scheduled_date: string | null; estimated_minutes: number | null; status: string; source_kind: string }>;
  students: Array<{ id: string; daily_capacity_minutes: number }>;
}) {
  const capacityByStudent = new Map(input.students.map((student) => [student.id, student.daily_capacity_minutes]));
  const groups = new Map<string, { studentId: string; scheduledDate: string; totalMinutes: number; curriculumMinutes: number; practiceMinutes: number; assignmentCount: number }>();
  for (const assignment of input.assignments) {
    if (!assignment.scheduled_date || assignment.status === "skipped") continue;
    const key = `${assignment.student_id}:${assignment.scheduled_date}`;
    const current = groups.get(key) ?? {
      studentId: assignment.student_id, scheduledDate: assignment.scheduled_date,
      totalMinutes: 0, curriculumMinutes: 0, practiceMinutes: 0, assignmentCount: 0,
    };
    const minutes = assignment.estimated_minutes ?? 0;
    current.totalMinutes += minutes;
    current.assignmentCount += 1;
    if (assignment.source_kind === "practice") current.practiceMinutes += minutes;
    else current.curriculumMinutes += minutes;
    groups.set(key, current);
  }
  return [...groups.values()].map((workload) => {
    const capacityMinutes = capacityByStudent.get(workload.studentId) ?? 0;
    return {
      ...workload,
      capacityMinutes,
      remainingMinutes: capacityMinutes - workload.totalMinutes,
      overCapacity: workload.totalMinutes > capacityMinutes,
    };
  }).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.studentId.localeCompare(b.studentId));
}

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
