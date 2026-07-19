import "server-only";

import { analyzeDayLoad, lessonOverlapsConflict, type CalendarConflict } from "@/lib/schedule/availability";
import { createClient } from "@/lib/supabase/server";
export { conflictDTO, conflictInputSchema } from "@/lib/calendar/conflict-model";
import { conflictDTO, trimDatabaseTime } from "@/lib/calendar/conflict-model";

export async function requireCalendarFamily(supabase: Awaited<ReturnType<typeof createClient>>, parentId: string, familyId: string) {
  const membership = await supabase.from("family_members").select("family_id,role").eq("family_id", familyId).eq("user_id", parentId).in("role", ["owner", "editor"]).maybeSingle();
  if (membership.error) throw membership.error;
  if (!membership.data) throw new CalendarConflictError("FORBIDDEN", 403);
  return membership.data.family_id;
}

export function calendarFamilyId(request: Request) {
  const familyId = new URL(request.url).searchParams.get("family");
  if (!familyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId)) throw new CalendarConflictError("FAMILY_NOT_FOUND", 400);
  return familyId;
}

export async function verifyConflictStudent(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string, studentId: string | null) {
  if (!studentId) return;
  const student = await supabase.from("students").select("id").eq("id", studentId).eq("family_id", familyId).eq("active", true).maybeSingle();
  if (student.error) throw student.error;
  if (!student.data) throw new CalendarConflictError("LEARNER_NOT_FOUND", 400);
}

export async function affectedWorkForConflict(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string,
  changedConflict: ReturnType<typeof conflictDTO>,
) {
  const [family, students, assignments, conflicts] = await Promise.all([
    supabase.from("families").select("available_days").eq("id", familyId).single(),
    supabase.from("students").select("id,display_name,daily_capacity_minutes,schedule_preferences").eq("family_id", familyId).eq("active", true).order("created_at"),
    supabase.from("assignments").select("id,student_id,title,status,scheduled_date,scheduled_time,estimated_minutes").eq("family_id", familyId).eq("scheduled_date", changedConflict.conflictDate).neq("status", "skipped").limit(500),
    supabase.from("calendar_conflicts").select("id,student_id,conflict_date,all_day,starts_at,ends_at,title,note,created_at,updated_at").eq("family_id", familyId).eq("conflict_date", changedConflict.conflictDate).limit(200),
  ]);
  const error = family.error ?? students.error ?? assignments.error ?? conflicts.error;
  if (error) throw error;
  if (!family.data) throw new CalendarConflictError("FAMILY_NOT_FOUND", 404);
  const conflictRows = conflicts.data ?? [];
  const assignmentRows = assignments.data ?? [];
  const conflictValues: CalendarConflict[] = conflictRows.map((item) => conflictDTO(item));
  const applicableStudents = (students.data ?? []).filter((student) => changedConflict.studentId === null || changedConflict.studentId === student.id);
  const affectedLearners = applicableStudents.flatMap((student) => {
    const normalizedAssignments = assignmentRows.map((item) => ({ id: item.id, studentId: item.student_id, scheduledDate: item.scheduled_date, scheduledTime: trimDatabaseTime(item.scheduled_time), estimatedMinutes: item.estimated_minutes, status: item.status, title: item.title }));
    const analysis = analyzeDayLoad({
      date: changedConflict.conflictDate,
      studentId: student.id,
      dailyCapacityMinutes: student.daily_capacity_minutes,
      schedulePreferences: student.schedule_preferences,
      familyLearningDays: family.data.available_days,
      conflicts: conflictValues,
      assignments: normalizedAssignments,
    });
    const directOverlapLessonNames = normalizedAssignments.filter((assignment) => lessonOverlapsConflict(assignment, changedConflict)).map((assignment) => assignment.title ?? "Lesson");
    if (!directOverlapLessonNames.length && !analysis.overCapacity) return [];
    return [{
      id: student.id,
      name: student.display_name,
      directOverlapLessonNames,
      overCapacity: analysis.overCapacity,
      plannedMinutes: analysis.plannedMinutes,
      availableMinutes: analysis.availableMinutes,
    }];
  });
  const affectedLessonNames = [...new Set(affectedLearners.flatMap((learner) => learner.directOverlapLessonNames))];
  return {
    directOverlapCount: affectedLearners.reduce((sum, learner) => sum + learner.directOverlapLessonNames.length, 0),
    overCapacity: affectedLearners.some((learner) => learner.overCapacity),
    affectedLearnerNames: affectedLearners.map((learner) => learner.name),
    affectedLessonNames,
    learners: affectedLearners,
  };
}

export class CalendarConflictError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
