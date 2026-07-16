"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/auth/require-parent";
import { subjectSlug } from "@/lib/onboarding/subjects";

export type OnboardingState = { error: string | null };

const schema = z.object({
  familyName: z.string().trim().min(1, "Name your family workspace.").max(100),
  studentName: z.string().trim().min(1, "Add your first learner.").max(80),
  gradeBand: z.enum(["pre-k", "k-2", "3-5", "6-8", "9-12", "other"]),
  learningPreferences: z.string().trim().max(2000).optional(),
  dailyCapacityMinutes: z.coerce.number().int().min(60).max(480),
  autonomyPreset: z.enum(["proactive", "helpful", "ask_first"]),
});

const subjectSetupSchema = z.array(z.object({
  name: z.string().trim().min(1).max(80),
  courseName: z.string().trim().max(120),
  weeklyFrequency: z.number().int().min(1).max(7),
})).min(1, "Add at least one subject so Klio knows what this learner is studying.").max(16);

export async function createWorkspaceAction(_: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const parent = await requireParent();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  let decodedSubjects: unknown;
  try { decodedSubjects = JSON.parse(String(formData.get("subjectSetup") ?? "[]")); }
  catch { return { error: "The subject setup could not be read. Please try again." }; }
  const subjectSetup = subjectSetupSchema.safeParse(decodedSubjects);
  if (!subjectSetup.success) return { error: subjectSetup.error.issues[0]?.message ?? "Check the subject setup." };
  const normalizedNames = subjectSetup.data.map((subject) => subject.name.toLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) return { error: "Each subject can only be added once." };

  const learningDays = formData.getAll("learningDays").filter((value): value is string => typeof value === "string" && ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(value));
  if (learningDays.length === 0) return { error: "Choose at least one learning day." };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("family_members").select("family_id").eq("user_id", parent.id).limit(1).maybeSingle();
  if (existing) redirect("/app");

  const { data: family, error: familyError } = await supabase.from("families")
    .insert({ name: parsed.data.familyName, created_by: parent.id, available_days: learningDays }).select("id").single();
  if (familyError) return { error: familyError.message };

  const { error: memberError } = await supabase.from("family_members").insert({ family_id: family.id, user_id: parent.id, role: "owner" });
  if (memberError) {
    await supabase.from("families").delete().eq("id", family.id);
    return { error: memberError.message };
  }

  const { data: student, error: studentError } = await supabase.from("students").insert({
    family_id: family.id,
    display_name: parsed.data.studentName,
    grade_band: parsed.data.gradeBand,
    learning_preferences: parsed.data.learningPreferences || null,
    daily_capacity_minutes: parsed.data.dailyCapacityMinutes,
    schedule_preferences: { learningDays },
  }).select("id").single();
  if (studentError) {
    await supabase.from("families").delete().eq("id", family.id);
    return { error: studentError.message };
  }

  const subjectRows = subjectSetup.data.map((subject, position) => ({
    family_id: family.id,
    student_id: student.id,
    created_by: parent.id,
    name: subject.name,
    course_name: subject.courseName || null,
    weekly_frequency: subject.weeklyFrequency,
    position,
  }));
  const { error: subjectsError } = await supabase.from("student_subjects").insert(subjectRows);
  if (subjectsError) {
    await supabase.from("families").delete().eq("id", family.id);
    return { error: subjectsError.message };
  }

  const curriculumRows = subjectSetup.data.map((subject) => ({
      family_id: family.id,
      student_id: student.id,
      created_by: parent.id,
      subject: subject.name,
      title: subject.courseName || subject.name,
      schedule_rule: { weeklyFrequency: subject.weeklyFrequency },
  }));
  const { error: curriculumError } = await supabase.from("curriculum_units").insert(curriculumRows);
  if (curriculumError) {
    await supabase.from("families").delete().eq("id", family.id);
    return { error: curriculumError.message };
  }

  const categoryRows = subjectSetup.data.map((subject, position) => ({
    family_id: family.id,
    name: subject.name,
    slug: (subjectSlug(subject.name) || "subject") + "-" + (position + 1) + "-" + student.id.slice(0, 8),
    created_by: parent.id,
    created_by_type: "parent" as const,
  }));
  const { error: categoriesError } = await supabase.from("categories").insert(categoryRows);
  if (categoriesError) {
    await supabase.from("families").delete().eq("id", family.id);
    return { error: categoriesError.message };
  }

  const { error: autonomyError } = await supabase.from("family_autonomy_policies").insert({
    family_id: family.id,
    preset: parsed.data.autonomyPreset,
    policies: {},
    updated_by: parent.id,
  });
  if (autonomyError) {
    await supabase.from("families").delete().eq("id", family.id);
    return { error: autonomyError.message };
  }

  redirect("/app");
}
