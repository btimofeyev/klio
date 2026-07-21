import { buildFirstWeekAssignments, type FirstWeekAssignment, type FirstWeekCandidate } from "@/lib/assignments/first-week";
import { learnerWeekdays, scheduleDates } from "@/lib/assignments/dates";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dateInTimezone } from "@/lib/schedule/dates";
import { effectiveAvailability, type CalendarConflict } from "@/lib/schedule/availability";
import { arrangeFamilyDay, type FamilyDayAvailability } from "@/lib/schedule/arrange-family-day";
import { resolveAttentionRequirement } from "@/lib/schedule/parent-attention";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

type LearnerPlan = {
  studentId: string;
  displayName: string;
  dates: string[];
  subjectCount: number;
  existingCount: number;
  plan: FirstWeekAssignment[];
};

export type FamilyWeekPlanResult = {
  learners: Array<{
    studentId: string;
    displayName: string;
    weekStart: string;
    assignmentCount: number;
    totalAssignmentCount: number;
    subjectCount: number;
    adjustedMinutes: number | null;
    alreadyPlanned: boolean;
  }>;
  needsSetup: Array<{ studentId: string; displayName: string }>;
  weekStart: string;
  assignmentCount: number;
  totalAssignmentCount: number;
  subjectCount: number;
};

export class FamilyWeekPlanError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FamilyWeekPlanError";
  }
}

/**
 * Deterministically fills the current or next usable learning week.
 * Authorization must be established by the caller; every read and write remains family scoped.
 */
export async function planFamilyWeek(input: {
  supabase: ServerSupabase;
  familyId: string;
  parentId: string;
  anchorDate?: string;
  actorType?: "parent" | "agent";
}): Promise<FamilyWeekPlanResult> {
  const [family, students, units] = await Promise.all([
    input.supabase.from("families").select("id,available_days,timezone").eq("id", input.familyId).maybeSingle(),
    input.supabase.from("students").select("id,display_name,daily_capacity_minutes,schedule_preferences").eq("family_id", input.familyId).eq("active", true).order("created_at"),
    input.supabase.from("curriculum_units").select("id,student_id,subject,default_minutes,schedule_rule,curriculum_url,attention_mode,parent_attention_minutes").eq("family_id", input.familyId).eq("status", "active").order("subject"),
  ]);
  if (!family.data) throw new FamilyWeekPlanError("You do not have access to this family.", "FAMILY_NOT_FOUND", 403);
  if (students.error) throw students.error;
  if (units.error) throw units.error;
  if (!students.data.length) throw new FamilyWeekPlanError("Add a learner before Klio builds the family week.", "NO_LEARNERS", 409);
  const familyDays = family.data.available_days;
  const anchorDate = input.anchorDate ?? dateInTimezone(new Date(), family.data.timezone);

  const learnerDates = new Map(students.data.map((student) => [
    student.id,
    currentOrNextLearningWeek(anchorDate, learnerWeekdays(student.schedule_preferences, familyDays)),
  ]));
  const allDates = [...learnerDates.values()].flat().sort();
  const [existing, conflictRows] = await Promise.all([
    input.supabase.from("assignments")
      .select("id,student_id,curriculum_unit_id,scheduled_date,scheduled_time,estimated_minutes,status,attention_mode,parent_attention_minutes")
      .eq("family_id", input.familyId)
      .gte("scheduled_date", allDates[0]).lte("scheduled_date", allDates.at(-1)!),
    input.supabase.from("calendar_conflicts")
      .select("id,student_id,conflict_date,all_day,starts_at,ends_at,title,note")
      .eq("family_id", input.familyId)
      .gte("conflict_date", allDates[0]).lte("conflict_date", allDates.at(-1)!),
  ]);
  if (existing.error ?? conflictRows.error) throw existing.error ?? conflictRows.error;
  const conflicts: CalendarConflict[] = conflictRows.data.map((item) => ({ id: item.id, studentId: item.student_id, conflictDate: item.conflict_date, allDay: item.all_day, startsAt: item.starts_at, endsAt: item.ends_at, title: item.title, note: item.note }));
  const candidateQueries = await Promise.all(units.data.map((unit) => input.supabase.from("assignments")
    .select("id,curriculum_unit_id,subject,title,sequence_number,curriculum_item_kind,estimated_minutes")
    .eq("family_id", input.familyId)
    .eq("student_id", unit.student_id)
    .eq("curriculum_unit_id", unit.id)
    .eq("status", "planned")
    .is("scheduled_date", null)
    .not("sequence_number", "is", null)
    .order("sequence_number", { ascending: true })
    .order("id", { ascending: true })
    .limit(Math.min(scheduleFrequency(unit.schedule_rule), 7))));
  const candidateError = candidateQueries.find((query) => query.error)?.error;
  if (candidateError) throw candidateError;
  const candidates = candidateQueries.flatMap((query) => query.data ?? []).flatMap((candidate) => {
    if (!candidate.curriculum_unit_id || candidate.sequence_number === null) return [];
    return [{
      id: candidate.id,
      curriculumUnitId: candidate.curriculum_unit_id,
      subject: candidate.subject,
      title: candidate.title,
      sequenceNumber: candidate.sequence_number,
      curriculumItemKind: curriculumItemKind(candidate.curriculum_item_kind),
      estimatedMinutes: candidate.estimated_minutes ?? 40,
      curriculumUrl: units.data.find((unit) => unit.id === candidate.curriculum_unit_id)?.curriculum_url ?? null,
    }];
  });

  const needsSetup: Array<{ studentId: string; displayName: string }> = [];
  const learnerPlans: LearnerPlan[] = [];
  const availabilityByStudentDate = new Map<string, Record<string, FamilyDayAvailability>>();
  for (const student of students.data) {
    const studentUnits = units.data.filter((unit) => unit.student_id === student.id);
    if (!studentUnits.length) {
      needsSetup.push({ studentId: student.id, displayName: student.display_name });
      continue;
    }
    const dates = learnerDates.get(student.id)!;
    const studentExisting = existing.data.filter((item) => item.student_id === student.id && item.scheduled_date && dates.includes(item.scheduled_date));
    const availabilityByDate = Object.fromEntries(dates.map((date) => {
      const availability = effectiveAvailability({ date, studentId: student.id, dailyCapacityMinutes: student.daily_capacity_minutes, schedulePreferences: student.schedule_preferences, familyLearningDays: familyDays, conflicts });
      return [date, { availableMinutes: availability.availableMinutes, blockedIntervals: availability.blockedIntervals, teachingWindow: availability.teachingWindow }];
    }));
    availabilityByStudentDate.set(student.id, availabilityByDate);
    const plan = buildFirstWeekAssignments({
      units: studentUnits.map((unit) => ({
        id: unit.id,
        subject: unit.subject,
        defaultMinutes: unit.default_minutes,
        weeklyFrequency: scheduleFrequency(unit.schedule_rule),
        scheduledTime: scheduleTime(unit.schedule_rule),
        attentionMode: unit.attention_mode as "unspecified" | "parent_led" | "independent" | "flexible",
        parentAttentionMinutes: unit.parent_attention_minutes,
      })),
      candidates: candidates.filter((candidate) => studentUnits.some((unit) => unit.id === candidate.curriculumUnitId)),
      dates,
      existing: studentExisting.map((item) => ({ curriculumUnitId: item.curriculum_unit_id, scheduledDate: item.scheduled_date, estimatedMinutes: item.estimated_minutes, status: item.status })),
      dailyCapacityMinutes: student.daily_capacity_minutes,
      availabilityByDate,
    });
    const expectedCount = studentUnits.reduce((sum, unit) => {
      const existingCount = studentExisting.filter((item) => item.curriculum_unit_id === unit.id && item.status !== "skipped").length;
      return sum + Math.max(0, Math.min(scheduleFrequency(unit.schedule_rule), dates.length) - existingCount);
    }, 0);
    if (plan.length < expectedCount) {
      const candidateCount = candidates.filter((candidate) => studentUnits.some((unit) => unit.id === candidate.curriculumUnitId)).length;
      if (candidateCount < expectedCount) {
        throw new FamilyWeekPlanError(
          `${student.display_name} does not have enough unscheduled curriculum lessons left for this week. Increase the affected course target before planning again.`,
          "CURRICULUM_SCOPE_EXHAUSTED",
          409,
          { studentId: student.id },
        );
      }
      throw new FamilyWeekPlanError(
        `${student.display_name}’s subject frequencies need more weekly learning time. Increase that learner’s daily limit or lower a subject frequency.`,
        "FREQUENCY_OVER_CAPACITY",
        409,
        { studentId: student.id },
      );
    }
    learnerPlans.push({
      studentId: student.id,
      displayName: student.display_name,
      dates,
      subjectCount: studentUnits.length,
      existingCount: studentExisting.filter((item) => item.status !== "skipped").length,
      plan,
    });
  }

  if (!learnerPlans.length) {
    throw new FamilyWeekPlanError(
      "Set up subjects for at least one learner before Klio builds the family week.",
      "NO_CURRICULUM",
      409,
      { needsSetup },
    );
  }

  const unitById = new Map(units.data.map((unit) => [unit.id, unit]));
  const plannedItems = learnerPlans.flatMap((learnerPlan) => learnerPlan.plan.map((item) => ({ ...item, studentId: learnerPlan.studentId })));
  const plannedDates = [...new Set(plannedItems.map((item) => item.scheduledDate))].sort();
  for (const student of students.data) {
    const current = availabilityByStudentDate.get(student.id) ?? {};
    for (const date of plannedDates) if (!current[date]) {
      const availability = effectiveAvailability({ date, studentId: student.id, dailyCapacityMinutes: student.daily_capacity_minutes, schedulePreferences: student.schedule_preferences, familyLearningDays: familyDays, conflicts });
      current[date] = { availableMinutes: availability.availableMinutes, blockedIntervals: availability.blockedIntervals, teachingWindow: availability.teachingWindow, allDayBlocked: availability.allDayBlocked };
    }
    availabilityByStudentDate.set(student.id, current);
  }
  const scheduledTimeByKey = new Map<string, string>();
  for (const date of plannedDates) {
    const newItems = plannedItems.filter((item) => item.scheduledDate === date);
    const existingItems = existing.data.filter((item) => item.scheduled_date === date && item.status !== "skipped" && item.status !== "completed" && (item.estimated_minutes ?? 0) > 0);
    const assignments = [
      ...existingItems.map((item) => {
        const unit = item.curriculum_unit_id ? unitById.get(item.curriculum_unit_id) : null;
        return { id: item.id, studentId: item.student_id, curriculumUnitId: item.curriculum_unit_id, scheduledTime: item.scheduled_time, fixed: Boolean(item.scheduled_time), preserveExistingTime: Boolean(item.scheduled_time), requirement: resolveAttentionRequirement({ assignmentMode: item.attention_mode, assignmentParentMinutes: item.parent_attention_minutes, curriculumMode: unit?.attention_mode, curriculumParentMinutes: unit?.parent_attention_minutes, lessonMinutes: item.estimated_minutes }) };
      }),
      ...newItems.map((item) => {
        const unit = unitById.get(item.curriculumUnitId)!;
        return { id: item.assignmentId, studentId: item.studentId, curriculumUnitId: item.curriculumUnitId, sequenceNumber: item.sequenceNumber, scheduledTime: item.scheduledTime, fixed: Boolean(item.scheduledTime), requirement: resolveAttentionRequirement({ curriculumMode: unit.attention_mode, curriculumParentMinutes: unit.parent_attention_minutes, lessonMinutes: item.estimatedMinutes }) };
      }),
    ];
    const dayAvailability = Object.fromEntries([...new Set(assignments.map((item) => item.studentId))].map((studentId) => [studentId, availabilityByStudentDate.get(studentId)?.[date] ?? { availableMinutes: 0, allDayBlocked: true }]));
    const arranged = arrangeFamilyDay({ date, assignments, availability: dayAvailability });
    if (!arranged.ok) {
      throw new FamilyWeekPlanError(parentAttentionFailureMessage(arranged.reason), "PARENT_ATTENTION_UNAVAILABLE", 409, { date, reason: arranged.reason, conflicts: arranged.conflictDetails });
    }
    for (const placement of arranged.placements) if (newItems.some((item) => item.assignmentId === placement.assignmentId)) scheduledTimeByKey.set(placement.assignmentId, placement.scheduledTime);
  }
  for (const item of plannedItems) item.scheduledTime = scheduledTimeByKey.get(item.assignmentId) ?? item.scheduledTime;
  if (plannedItems.length) {
    const scheduled = await input.supabase.rpc("schedule_curriculum_assignments", {
      p_family_id: input.familyId,
      p_actor_id: input.parentId,
      p_placements: plannedItems.map((item, position) => ({
        assignment_id: item.assignmentId,
        scheduled_date: item.scheduledDate,
        scheduled_time: item.scheduledTime,
        estimated_minutes: item.estimatedMinutes,
        position,
      })),
    });
    if (scheduled.error) {
      if (/CURRICULUM_SCHEDULE_CONFLICT/.test(scheduled.error.message)) {
        throw new FamilyWeekPlanError("Another planner scheduled one of these lessons first. Refresh and try again.", "CURRICULUM_SCHEDULE_CONFLICT", 409);
      }
      throw scheduled.error;
    }
  }

  const summaries = learnerPlans.map((learnerPlan) => ({
    studentId: learnerPlan.studentId,
    displayName: learnerPlan.displayName,
    weekStart: learnerPlan.dates[0],
    assignmentCount: learnerPlan.plan.length,
    totalAssignmentCount: learnerPlan.existingCount + learnerPlan.plan.length,
    subjectCount: learnerPlan.subjectCount,
    adjustedMinutes: learnerPlan.plan.length ? Math.min(...learnerPlan.plan.map((item) => item.estimatedMinutes)) : null,
    alreadyPlanned: learnerPlan.plan.length === 0,
  }));

  await writeAuditEvent(createAdminClient(), {
    familyId: input.familyId,
    actorId: input.parentId,
    actorType: input.actorType ?? "parent",
    action: "week_plan.built",
    entityType: "family",
    entityId: input.familyId,
    metadata: { assignment_count: plannedItems.length, week_start: allDates[0], learners: summaries.map((item) => ({ student_id: item.studentId, assignment_count: item.assignmentCount })) },
  });
  return {
    learners: summaries,
    needsSetup,
    weekStart: allDates[0],
    assignmentCount: summaries.reduce((sum, item) => sum + item.assignmentCount, 0),
    totalAssignmentCount: summaries.reduce((sum, item) => sum + item.totalAssignmentCount, 0),
    subjectCount: summaries.reduce((sum, item) => sum + item.subjectCount, 0),
  };
}

function parentAttentionFailureMessage(reason: string | null) {
  if (reason === "insufficient_parent_time") return "The requested direct teaching time does not fit the family’s available teaching hours.";
  if (reason === "fixed_time_collision") return "Existing fixed lessons need the parent at the same time. Klio left the week unchanged.";
  if (reason === "blocked_by_conflicts") return "Calendar conflicts leave too little safe teaching time for the requested week.";
  if (reason === "curriculum_sequence") return "The week cannot be arranged without putting curriculum out of order.";
  return "The requested lessons do not fit the learners’ available teaching time.";
}

function currentOrNextLearningWeek(anchorDate: string, weekdays: number[]) {
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  let dates = scheduleDates(monday.toISOString().slice(0, 10), weekdays, weekdays.length).filter((date) => date >= anchorDate);
  if (!dates.length) {
    monday.setUTCDate(monday.getUTCDate() + 7);
    dates = scheduleDates(monday.toISOString().slice(0, 10), weekdays, weekdays.length);
  }
  return dates;
}

function scheduleTime(rule: unknown) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const value = "scheduledTime" in rule ? rule.scheduledTime : null;
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function scheduleFrequency(rule: unknown) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return 5;
  const value = "weeklyFrequency" in rule ? Number(rule.weeklyFrequency) : 5;
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : 5;
}

function curriculumItemKind(value: string | null): FirstWeekCandidate["curriculumItemKind"] {
  if (value === "assessment" || value === "review" || value === "project" || value === "activity") return value;
  return "lesson" as const;
}
