import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadAvailabilityByDate } from "@/lib/schedule/availability-data";
import { wallClockMinutes } from "@/lib/schedule/availability";
import { findParentAttentionConflicts, intervalsOverlap, lessonInterval, resolveAttentionRequirement } from "@/lib/schedule/parent-attention";

export type SchedulePlacementChange = {
  assignmentId?: string;
  scheduledDate: string;
  estimatedMinutes: number;
  scheduledTime: string | null;
};

export async function assertScheduleChangesFit(input: {
  supabase: SupabaseClient<Database>;
  familyId: string;
  studentId: string;
  changes: SchedulePlacementChange[];
}) {
  if (!input.changes.length) return;
  if (new Set(input.changes.flatMap((change) => change.assignmentId ? [change.assignmentId] : [])).size !== input.changes.filter((change) => change.assignmentId).length) throw new Error("DUPLICATE_SCHEDULE_CHANGE");
  const dates = [...new Set(input.changes.map((change) => change.scheduledDate))].sort();
  const [student, family, existing, familyAssignments, units] = await Promise.all([
    input.supabase.from("students").select("daily_capacity_minutes,schedule_preferences").eq("family_id", input.familyId).eq("id", input.studentId).eq("active", true).single(),
    input.supabase.from("families").select("available_days").eq("id", input.familyId).single(),
    input.supabase.from("assignments").select("id,scheduled_date,estimated_minutes,status").eq("family_id", input.familyId).eq("student_id", input.studentId).gte("scheduled_date", dates[0]).lte("scheduled_date", dates.at(-1)!).neq("status", "skipped").limit(1000),
    input.supabase.from("assignments").select("id,student_id,curriculum_unit_id,scheduled_date,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,status").eq("family_id", input.familyId).gte("scheduled_date", dates[0]).lte("scheduled_date", dates.at(-1)!).neq("status", "skipped").limit(5000),
    input.supabase.from("curriculum_units").select("id,attention_mode,parent_attention_minutes").eq("family_id", input.familyId),
  ]);
  if (student.error ?? family.error ?? existing.error ?? familyAssignments.error ?? units.error) throw student.error ?? family.error ?? existing.error ?? familyAssignments.error ?? units.error;
  const availability = await loadAvailabilityByDate({ supabase: input.supabase, familyId: input.familyId, studentId: input.studentId, dailyCapacityMinutes: student.data.daily_capacity_minutes, schedulePreferences: student.data.schedule_preferences, familyLearningDays: family.data.available_days, dates });
  const changingIds = new Set(input.changes.flatMap((change) => change.assignmentId ? [change.assignmentId] : []));
  const changingAssignments = changingIds.size
    ? await input.supabase.from("assignments").select("id,student_id,curriculum_unit_id,scheduled_date,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,status").eq("family_id", input.familyId).in("id", [...changingIds])
    : { data: [], error: null };
  if (changingAssignments.error) throw changingAssignments.error;
  const existingById = new Map([...familyAssignments.data, ...changingAssignments.data].map((assignment) => [assignment.id, assignment]));
  const unitById = new Map(units.data.map((unit) => [unit.id, unit]));
  for (const date of dates) {
    const dateChanges = input.changes.filter((change) => change.scheduledDate === date);
    const existingMinutes = existing.data.filter((assignment) => assignment.scheduled_date === date && !changingIds.has(assignment.id)).reduce((sum, assignment) => sum + (assignment.estimated_minutes ?? 30), 0);
    const changedMinutes = dateChanges.reduce((sum, change) => sum + change.estimatedMinutes, 0);
    const dateAvailability = availability[date];
    if (!dateAvailability || dateAvailability.availableMinutes === 0 || existingMinutes + changedMinutes > dateAvailability.availableMinutes) throw new Error("SCHEDULE_EXCEEDS_AVAILABLE_TIME");
    for (const change of dateChanges) {
      if (!change.scheduledTime) continue;
      const start = wallClockMinutes(change.scheduledTime);
      if (start === null) throw new Error("INVALID_SCHEDULE_TIME");
      const end = start + change.estimatedMinutes;
      const windowStart = dateAvailability.teachingWindow ? wallClockMinutes(dateAvailability.teachingWindow.start)! : 0;
      const windowEnd = dateAvailability.teachingWindow ? wallClockMinutes(dateAvailability.teachingWindow.end)! : 1440;
      if (start < windowStart || end > windowEnd || (dateAvailability.blockedIntervals ?? []).some((interval) => start < interval.end && end > interval.start)) throw new Error("SCHEDULE_TIME_BLOCKED");
    }
    const simulated = [
      ...familyAssignments.data.filter((assignment) => assignment.scheduled_date === date && !changingIds.has(assignment.id)),
      ...dateChanges.map((change, index) => {
        const current = change.assignmentId ? existingById.get(change.assignmentId) : null;
        return {
          id: change.assignmentId ?? `new:${date}:${index}`,
          student_id: input.studentId,
          curriculum_unit_id: current?.curriculum_unit_id ?? null,
          scheduled_date: date,
          scheduled_time: change.scheduledTime,
          estimated_minutes: change.estimatedMinutes,
          attention_mode: current?.attention_mode ?? null,
          parent_attention_minutes: current?.parent_attention_minutes ?? null,
          status: current?.status ?? "planned",
        };
      }),
    ];
    const timed = simulated.flatMap((assignment) => {
      const unit = assignment.curriculum_unit_id ? unitById.get(assignment.curriculum_unit_id) : null;
      const requirement = resolveAttentionRequirement({ assignmentMode: assignment.attention_mode, assignmentParentMinutes: assignment.parent_attention_minutes, curriculumMode: unit?.attention_mode, curriculumParentMinutes: unit?.parent_attention_minutes, lessonMinutes: assignment.estimated_minutes });
      return assignment.scheduled_time ? [{ assignment, requirement, lesson: lessonInterval(assignment.scheduled_time, requirement.lessonMinutes) }] : [];
    });
    for (let index = 0; index < timed.length; index += 1) for (let other = index + 1; other < timed.length; other += 1) {
      if (timed[index].assignment.student_id === timed[other].assignment.student_id && intervalsOverlap(timed[index].lesson, timed[other].lesson)) throw new Error("LEARNER_SCHEDULE_OVERLAP");
    }
    const parentConflicts = findParentAttentionConflicts(timed.map((item) => ({ id: item.assignment.id, studentId: item.assignment.student_id, scheduledStart: item.assignment.scheduled_time, requirement: item.requirement })));
    if (parentConflicts.length) throw new Error("PARENT_ATTENTION_OVERLAP");
  }
}
