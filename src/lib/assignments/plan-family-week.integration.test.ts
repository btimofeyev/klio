import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { findParentAttentionConflicts, intervalsOverlap, lessonInterval, resolveAttentionRequirement } from "@/lib/schedule/parent-attention";
import { FamilyWeekPlanError, planFamilyWeek } from "./plan-family-week";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let userId = ""; let familyId = ""; let studentA = ""; let studentB = "";
let client: SupabaseClient<Database>;

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `family-week-conflicts-${crypto.randomUUID()}@example.test`, password: "KlioFamilyWeek123", email_confirm: true });
  if (user.error) throw user.error; userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Availability planner family", created_by: userId, timezone: "UTC", available_days: ["Mon", "Tue"] }).select("id").single();
  if (family.error) throw family.error; familyId = family.data.id;
  const membership = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  if (membership.error) throw membership.error;
  client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email: user.data.user.email!, password: "KlioFamilyWeek123" });
  if (signedIn.error) throw signedIn.error;
  const students = await admin.from("students").insert([
    { family_id: familyId, display_name: "Planner Maya", daily_capacity_minutes: 180, schedule_preferences: { learningDays: ["Mon", "Tue"], teachingWindows: { Mon: { start: "09:00", end: "12:00" }, Tue: { start: "09:00", end: "12:00" } } } },
    { family_id: familyId, display_name: "Planner Theo", daily_capacity_minutes: 180, schedule_preferences: { learningDays: ["Mon", "Tue"], teachingWindows: { Mon: { start: "09:00", end: "12:00" }, Tue: { start: "09:00", end: "12:00" } } } },
  ]).select("id,display_name");
  if (students.error) throw students.error;
  studentA = students.data.find((student) => student.display_name.endsWith("Maya"))!.id;
  studentB = students.data.find((student) => student.display_name.endsWith("Theo"))!.id;
  const units = await admin.from("curriculum_units").insert([
    { family_id: familyId, student_id: studentA, created_by: userId, subject: "Math", title: "Maya Math", default_minutes: 45, schedule_rule: { weeklyFrequency: 1, scheduledTime: "10:00" }, attention_mode: "parent_led" },
    { family_id: familyId, student_id: studentB, created_by: userId, subject: "Math", title: "Theo Math", default_minutes: 45, schedule_rule: { weeklyFrequency: 1, scheduledTime: "10:00" }, attention_mode: "independent" },
  ]).select("id,family_id,student_id,subject,title,sequence_label,default_minutes,target_lesson_count");
  if (units.error) throw units.error;
  await insertScope(units.data);
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("planFamilyWeek availability integration", () => {
  it("keeps a learner-specific timed conflict isolated while avoiding the blocked interval", async () => {
    const conflict = await admin.from("calendar_conflicts").insert({ family_id: familyId, student_id: studentA, conflict_date: "2026-07-21", all_day: false, starts_at: "10:00", ends_at: "11:00", title: "Maya appointment", created_by: userId });
    if (conflict.error) throw conflict.error;
    const before = await admin.from("assignments").select("id").eq("family_id", familyId);
    const nextIds = await admin.from("assignments").select("id,student_id").eq("family_id", familyId).eq("sequence_number", 1);
    const firstPlan = await planFamilyWeek({ supabase: client, familyId, parentId: userId, anchorDate: "2026-07-20" });
    const assignments = await admin.from("assignments").select("id,student_id,scheduled_date,scheduled_time").eq("family_id", familyId).gte("scheduled_date", "2026-07-20").lte("scheduled_date", "2026-07-21");
    expect(assignments.error).toBeNull();
    expect(assignments.data?.find((assignment) => assignment.student_id === studentA)).toMatchObject({ scheduled_date: "2026-07-20", scheduled_time: "10:00:00" });
    expect(assignments.data?.find((assignment) => assignment.student_id === studentB)).toMatchObject({ scheduled_date: "2026-07-21", scheduled_time: "10:00:00" });
    expect(new Set(assignments.data?.map((assignment) => assignment.id))).toEqual(new Set(nextIds.data?.map((assignment) => assignment.id)));
    expect((await admin.from("assignments").select("id").eq("family_id", familyId)).data).toHaveLength(before.data!.length);
    const repeated = await planFamilyWeek({ supabase: client, familyId, parentId: userId, anchorDate: "2026-07-20" });
    expect(firstPlan.assignmentCount).toBe(2);
    expect(repeated.assignmentCount).toBe(0);
    expect((await admin.from("weekly_plan_items").select("id").eq("family_id", familyId).gte("scheduled_date", "2026-07-20").lte("scheduled_date", "2026-07-21")).data).toHaveLength(2);
  });

  it("applies a family-wide conflict to both learners", async () => {
    const conflict = await admin.from("calendar_conflicts").insert({ family_id: familyId, student_id: null, conflict_date: "2026-07-28", all_day: true, title: "Family day", created_by: userId });
    if (conflict.error) throw conflict.error;
    await planFamilyWeek({ supabase: client, familyId, parentId: userId, anchorDate: "2026-07-27" });
    const assignments = await admin.from("assignments").select("student_id,scheduled_date").eq("family_id", familyId).gte("scheduled_date", "2026-07-27").lte("scheduled_date", "2026-07-28");
    expect(assignments.data).toHaveLength(2);
    expect(assignments.data?.every((assignment) => assignment.scheduled_date === "2026-07-27")).toBe(true);
  });

  it("fails safely without inserting a partial plan when no date is available", async () => {
    const conflicts = await admin.from("calendar_conflicts").insert([
      { family_id: familyId, student_id: studentA, conflict_date: "2026-08-03", all_day: true, title: "Blocked Monday", created_by: userId },
      { family_id: familyId, student_id: studentA, conflict_date: "2026-08-04", all_day: true, title: "Blocked Tuesday", created_by: userId },
    ]);
    if (conflicts.error) throw conflicts.error;
    await expect(planFamilyWeek({ supabase: client, familyId, parentId: userId, anchorDate: "2026-08-03" })).rejects.toMatchObject({ code: "FREQUENCY_OVER_CAPACITY" } satisfies Partial<FamilyWeekPlanError>);
    const assignments = await admin.from("assignments").select("id").eq("family_id", familyId).gte("scheduled_date", "2026-08-03").lte("scheduled_date", "2026-08-04");
    expect(assignments.data).toEqual([]);
  });

  it("plans sibling parent time together while allowing safe independent parallel work", async () => {
    const added = await admin.from("curriculum_units").insert([
      { family_id: familyId, student_id: studentA, created_by: userId, subject: "Reading", title: "Maya Reading", default_minutes: 30, schedule_rule: { weeklyFrequency: 1 }, attention_mode: "independent" },
      { family_id: familyId, student_id: studentB, created_by: userId, subject: "Writing", title: "Theo Writing", default_minutes: 30, schedule_rule: { weeklyFrequency: 1 }, attention_mode: "flexible", parent_attention_minutes: 10 },
    ]).select("id,family_id,student_id,subject,title,sequence_label,default_minutes,target_lesson_count");
    if (added.error) throw added.error;
    await insertScope(added.data);
    await planFamilyWeek({ supabase: client, familyId, parentId: userId, anchorDate: "2026-08-10" });
    const result = await admin.from("assignments").select("id,student_id,curriculum_unit_id,scheduled_date,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,curriculum_units(attention_mode,parent_attention_minutes)")
      .eq("family_id", familyId).gte("scheduled_date", "2026-08-10").lte("scheduled_date", "2026-08-11");
    if (result.error) throw result.error;
    expect(result.data).toHaveLength(4);
    const work = result.data.map((assignment) => {
      const unit = Array.isArray(assignment.curriculum_units) ? assignment.curriculum_units[0] : assignment.curriculum_units;
      return {
        id: assignment.id,
        studentId: assignment.student_id,
        scheduledStart: assignment.scheduled_time,
        scheduledDate: assignment.scheduled_date,
        requirement: resolveAttentionRequirement({ assignmentMode: assignment.attention_mode, assignmentParentMinutes: assignment.parent_attention_minutes, curriculumMode: unit?.attention_mode, curriculumParentMinutes: unit?.parent_attention_minutes, lessonMinutes: assignment.estimated_minutes }),
      };
    });
    for (const date of ["2026-08-10", "2026-08-11"]) expect(findParentAttentionConflicts(work.filter((item) => item.scheduledDate === date))).toEqual([]);
    for (const learnerId of [studentA, studentB]) {
      const lessons = work.filter((item) => item.studentId === learnerId);
      for (let index = 0; index < lessons.length; index += 1) for (let other = index + 1; other < lessons.length; other += 1) {
        if (lessons[index].scheduledDate !== lessons[other].scheduledDate) continue;
        expect(intervalsOverlap(lessonInterval(lessons[index].scheduledStart, lessons[index].requirement.lessonMinutes), lessonInterval(lessons[other].scheduledStart, lessons[other].requirement.lessonMinutes))).toBe(false);
      }
    }
    const flexible = work.find((item) => item.requirement.mode === "flexible")!;
    expect(flexible.requirement.parentMinutes).toBe(10);
    const parallelIndependent = work.some((independent) => independent.requirement.mode === "independent" && independent.studentId !== flexible.studentId && independent.scheduledDate === flexible.scheduledDate
      && intervalsOverlap(lessonInterval(independent.scheduledStart, independent.requirement.lessonMinutes), lessonInterval(flexible.scheduledStart, flexible.requirement.parentMinutes)));
    expect(parallelIndependent).toBe(true);
  });
});

async function insertScope(units: Array<{ id: string; family_id: string; student_id: string; subject: string; title: string; sequence_label: string; default_minutes: number; target_lesson_count: number }>) {
  const rows = units.flatMap((unit) => Array.from({ length: unit.target_lesson_count }, (_, index) => ({
    family_id: unit.family_id,
    student_id: unit.student_id,
    curriculum_unit_id: unit.id,
    created_by: userId,
    title: `${unit.title} · ${unit.sequence_label} ${index + 1}`,
    subject: unit.subject,
    sequence_number: index + 1,
    estimated_minutes: unit.default_minutes,
    status: "planned" as const,
    source_kind: "curriculum" as const,
    curriculum_item_kind: "lesson" as const,
    curriculum_item_state: "placeholder" as const,
    curriculum_path: [],
  })));
  const inserted = await admin.from("assignments").insert(rows);
  if (inserted.error) throw inserted.error;
}
