import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { effectiveAvailability, type CalendarConflict } from "@/lib/schedule/availability";
import type { PlanningAvailabilityByDate } from "@/lib/assignments/planning";

export async function loadAvailabilityByDate(input: {
  supabase: SupabaseClient<Database>;
  familyId: string;
  studentId: string;
  dailyCapacityMinutes: number;
  schedulePreferences: unknown;
  familyLearningDays: unknown;
  dates: string[];
}): Promise<PlanningAvailabilityByDate> {
  const dates = [...new Set(input.dates)].sort();
  if (!dates.length) return {};
  const rows = await input.supabase.from("calendar_conflicts")
    .select("id,student_id,conflict_date,all_day,starts_at,ends_at,title,note")
    .eq("family_id", input.familyId)
    .gte("conflict_date", dates[0]).lte("conflict_date", dates.at(-1)!)
    .or(`student_id.is.null,student_id.eq.${input.studentId}`)
    .limit(1000);
  if (rows.error) throw rows.error;
  const conflicts: CalendarConflict[] = rows.data.map((item) => ({ id: item.id, studentId: item.student_id, conflictDate: item.conflict_date, allDay: item.all_day, startsAt: item.starts_at, endsAt: item.ends_at, title: item.title, note: item.note }));
  return Object.fromEntries(dates.map((date) => {
    const availability = effectiveAvailability({ date, studentId: input.studentId, dailyCapacityMinutes: input.dailyCapacityMinutes, schedulePreferences: input.schedulePreferences, familyLearningDays: input.familyLearningDays, conflicts });
    return [date, { availableMinutes: availability.availableMinutes, blockedIntervals: availability.blockedIntervals, teachingWindow: availability.teachingWindow }];
  }));
}
