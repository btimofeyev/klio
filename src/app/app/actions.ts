"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireParent } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { normalizePracticeSpec } from "@/lib/practice/spec";
import { subjectSlug } from "@/lib/onboarding/subjects";
import { FamilyWeekPlanError, planFamilyWeek } from "@/lib/assignments/plan-family-week";

const reviewSchema = z.object({
  familyId: z.uuid(), entityId: z.uuid(), entityType: z.enum(["artifact", "skill_observation"]),
  decision: z.enum(["approved", "rejected"]), reason: z.string().trim().max(1000).optional(),
});

export async function reviewEntityAction(formData: FormData) {
  const parent = await requireParent();
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid review request");
  const supabase = await createClient();
  const reviewValues = {
    reviewed_by: parent.id,
    reviewed_at: new Date().toISOString(),
    rejection_reason: parsed.data.decision === "rejected" ? parsed.data.reason || "Rejected by parent" : null,
  };
  let error: { message: string } | null;
  if (parsed.data.entityType === "artifact") {
    const result = await supabase.from("artifacts").update({ ...reviewValues, status: parsed.data.decision }).eq("id", parsed.data.entityId).eq("family_id", parsed.data.familyId).select("id").maybeSingle();
    if (!result.data && !result.error) throw new Error("Not found");
    error = result.error;
  } else {
    const result = await supabase.from("skill_observations").update({ ...reviewValues, approval_status: parsed.data.decision }).eq("id", parsed.data.entityId).eq("family_id", parsed.data.familyId).select("id").maybeSingle();
    if (!result.data && !result.error) throw new Error("Not found");
    error = result.error;
  }
  if (error) throw error;
  await createAdminClient().from("approval_requests").update({
    status: parsed.data.decision, decided_by: parent.id, decided_at: new Date().toISOString(), decision_note: parsed.data.reason || null,
  }).eq("entity_id", parsed.data.entityId).eq("entity_type", parsed.data.entityType).eq("family_id", parsed.data.familyId);
  await writeAuditEvent(createAdminClient(), {
    familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent",
    action: `${parsed.data.entityType}.${parsed.data.decision}`, entityType: parsed.data.entityType,
    entityId: parsed.data.entityId, metadata: { reason: parsed.data.reason || null },
  });
  revalidatePath("/app", "layout");
}

export async function togglePlanItemAction(formData: FormData) {
  await requireParent();
  const parsed = z.object({ id: z.uuid(), completed: z.enum(["true", "false"]) }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("weekly_plan_items").update({ completed_at: parsed.completed === "true" ? new Date().toISOString() : null }).eq("id", parsed.id);
  if (error) throw error;
  revalidatePath("/app/plans");
}

export type LearnerSetupState = { error: string | null; success: string | null };
export type NewLearnerState = { error: string | null };

const newLearnerSchema = z.object({
  familyId: z.uuid(),
  displayName: z.string().trim().min(1, "Add the learner’s first name.").max(80),
  gradeBand: z.enum(["pre-k", "k-2", "3-5", "6-8", "9-12", "other"]),
  learningPreferences: z.string().trim().max(2000).optional(),
});

const learnerSchema = z.object({
  familyId: z.uuid(),
  studentId: z.uuid().optional(),
  displayName: z.string().trim().min(1, "Add the learner’s first name.").max(80),
  gradeBand: z.enum(["pre-k", "k-2", "3-5", "6-8", "9-12", "other"]),
  learningPreferences: z.string().trim().max(2000).optional(),
  dailyCapacityMinutes: z.coerce.number().int().min(60).max(480),
});

const learnerSubjectsSchema = z.array(z.object({
  name: z.string().trim().min(1).max(80),
  courseName: z.string().trim().max(120),
  weeklyFrequency: z.number().int().min(1).max(7),
})).min(1, "Add at least one subject for this learner.").max(16);

export async function createStudentProfileAction(_: NewLearnerState, formData: FormData): Promise<NewLearnerState> {
  const parent = await requireParent();
  const parsed = newLearnerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the learner details." };
  const supabase = await createClient();
  const membership = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
  if (membership.error) return { error: membership.error.message };
  if (!membership.data) return { error: "You do not have access to that family." };
  const { data: student, error } = await supabase.from("students").insert({
    family_id: parsed.data.familyId,
    display_name: parsed.data.displayName,
    grade_band: parsed.data.gradeBand,
    learning_preferences: parsed.data.learningPreferences || null,
    daily_capacity_minutes: defaultDailyCapacity(parsed.data.gradeBand),
    schedule_preferences: { learningDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
  }).select("id").single();
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  revalidatePath("/app/settings");
  redirect(`/app/settings/learners/${student.id}`);
}

function defaultDailyCapacity(gradeBand: z.infer<typeof newLearnerSchema>["gradeBand"]) {
  if (gradeBand === "pre-k" || gradeBand === "k-2") return 90;
  if (gradeBand === "3-5" || gradeBand === "other") return 180;
  if (gradeBand === "6-8") return 240;
  return 300;
}

export async function updateStudentSetupAction(_: LearnerSetupState, formData: FormData): Promise<LearnerSetupState> {
  const parent = await requireParent();
  const setup = readLearnerSetup(formData);
  if ("error" in setup) return { error: setup.error ?? "Check the learner setup.", success: null };
  if (!setup.learner.studentId) return { error: "Choose a learner to update.", success: null };
  const supabase = await createClient();
  const membership = await supabase.from("family_members").select("family_id").eq("family_id", setup.learner.familyId).eq("user_id", parent.id).maybeSingle();
  if (!membership.data) return { error: "You do not have access to that family.", success: null };
  const updated = await supabase.from("students").update({
    display_name: setup.learner.displayName,
    grade_band: setup.learner.gradeBand,
    learning_preferences: setup.learner.learningPreferences || null,
    daily_capacity_minutes: setup.learner.dailyCapacityMinutes,
    schedule_preferences: { learningDays: setup.learningDays },
  }).eq("id", setup.learner.studentId).eq("family_id", setup.learner.familyId).select("id").maybeSingle();
  if (updated.error || !updated.data) return { error: updated.error?.message ?? "Learner not found.", success: null };
  try {
    await replaceLearnerSubjects(supabase, { familyId: setup.learner.familyId, studentId: setup.learner.studentId, parentId: parent.id, subjects: setup.subjects });
  } catch (syncError) {
    return { error: syncError instanceof Error ? syncError.message : "Klio could not update those subjects.", success: null };
  }
  let plannedMessage = "";
  try {
    const planned = await planFamilyWeek({
      supabase,
      familyId: setup.learner.familyId,
      parentId: parent.id,
      actorType: "agent",
    });
    const learnerPlan = planned.learners.find((learner) => learner.studentId === setup.learner.studentId);
    if (learnerPlan?.assignmentCount) plannedMessage = ` Klio also placed ${learnerPlan.assignmentCount} ${learnerPlan.assignmentCount === 1 ? "lesson" : "lessons"} into the current week.`;
  } catch (planningError) {
    if (planningError instanceof FamilyWeekPlanError && planningError.code === "FREQUENCY_OVER_CAPACITY") {
      return { error: null, success: `${setup.learner.displayName}’s learning setup is updated. Klio left the week unchanged: ${planningError.message}` };
    }
    console.error("Automatic learner week planning failed", planningError);
    plannedMessage = " The setup is safe, but Klio could not refresh the week yet.";
  }
  revalidatePath("/app", "layout");
  revalidatePath("/app/settings");
  return { error: null, success: `${setup.learner.displayName}’s learning setup is updated.${plannedMessage}` };
}

function readLearnerSetup(formData: FormData) {
  const learner = learnerSchema.safeParse(Object.fromEntries(formData));
  if (!learner.success) return { error: learner.error.issues[0]?.message ?? "Check the learner details." } as const;
  let rawSubjects: unknown;
  try { rawSubjects = JSON.parse(String(formData.get("subjectSetup") ?? "[]")); }
  catch { return { error: "The subject setup could not be read. Please try again." } as const; }
  const subjects = learnerSubjectsSchema.safeParse(rawSubjects);
  if (!subjects.success) return { error: subjects.error.issues[0]?.message ?? "Check the subject setup." } as const;
  const names = subjects.data.map((subject) => subject.name.toLowerCase());
  if (new Set(names).size !== names.length) return { error: "Each subject can only be added once." } as const;
  const learningDays = formData.getAll("learningDays").filter((value): value is string => typeof value === "string" && ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(value));
  if (!learningDays.length) return { error: "Choose at least one learning day." } as const;
  return { learner: learner.data, subjects: subjects.data, learningDays } as const;
}

async function replaceLearnerSubjects(supabase: Awaited<ReturnType<typeof createClient>>, input: { familyId: string; studentId: string; parentId: string; subjects: z.infer<typeof learnerSubjectsSchema> }) {
  const existingSubjects = await supabase.from("student_subjects").select("id").eq("family_id", input.familyId).eq("student_id", input.studentId);
  if (existingSubjects.error) throw existingSubjects.error;
  if (existingSubjects.data.length) {
    const removed = await supabase.from("student_subjects").delete().eq("family_id", input.familyId).eq("student_id", input.studentId);
    if (removed.error) throw removed.error;
  }
  const inserted = await supabase.from("student_subjects").insert(input.subjects.map((subject, position) => ({
    family_id: input.familyId,
    student_id: input.studentId,
    created_by: input.parentId,
    name: subject.name,
    course_name: subject.courseName || null,
    weekly_frequency: subject.weeklyFrequency,
    position,
  })));
  if (inserted.error) throw inserted.error;

  const curricula = await supabase.from("curriculum_units").select("id,subject,title,status").eq("family_id", input.familyId).eq("student_id", input.studentId);
  if (curricula.error) throw curricula.error;
  const keep = new Set<string>();
  for (const subject of input.subjects) {
    const title = subject.courseName || subject.name;
    const match = curricula.data.find((unit) => unit.subject.toLowerCase() === subject.name.toLowerCase() && unit.title.toLowerCase() === title.toLowerCase());
    if (match) {
      keep.add(match.id);
      const result = await supabase.from("curriculum_units").update({ status: "active", schedule_rule: { weeklyFrequency: subject.weeklyFrequency } }).eq("id", match.id).eq("family_id", input.familyId);
      if (result.error) throw result.error;
    } else {
      const result = await supabase.from("curriculum_units").insert({ family_id: input.familyId, student_id: input.studentId, created_by: input.parentId, subject: subject.name, title, schedule_rule: { weeklyFrequency: subject.weeklyFrequency } }).select("id").single();
      if (result.error) throw result.error;
      keep.add(result.data.id);
    }
  }
  const archiveIds = curricula.data.filter((unit) => unit.status !== "archived" && !keep.has(unit.id)).map((unit) => unit.id);
  if (archiveIds.length) {
    const archived = await supabase.from("curriculum_units").update({ status: "archived" }).eq("family_id", input.familyId).in("id", archiveIds);
    if (archived.error) throw archived.error;
  }

  const categories = await supabase.from("categories").select("name,slug").eq("family_id", input.familyId);
  if (categories.error) throw categories.error;
  const knownNames = new Set(categories.data.map((category) => category.name.toLowerCase()));
  const knownSlugs = new Set(categories.data.map((category) => category.slug));
  const missing = input.subjects.filter((subject) => !knownNames.has(subject.name.toLowerCase())).map((subject) => {
    const base = subjectSlug(subject.name) || "subject";
    let slug = base;
    let suffix = 2;
    while (knownSlugs.has(slug)) slug = `${base}-${suffix++}`;
    knownSlugs.add(slug);
    return { family_id: input.familyId, name: subject.name, slug, created_by: input.parentId, created_by_type: "parent" as const, description: `Learning folder for ${subject.name}.` };
  });
  if (missing.length) {
    const categoriesInserted = await supabase.from("categories").insert(missing);
    if (categoriesInserted.error) throw categoriesInserted.error;
  }
}

export async function launchPracticeAction(formData: FormData) {
  const parent = await requireParent();
  const { artifactId } = z.object({ artifactId: z.uuid() }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: artifact } = await supabase.from("artifacts").select("id, family_id, student_id, content, status, type").eq("id", artifactId).eq("status", "approved").eq("type", "practice").maybeSingle();
  if (!artifact?.student_id || !artifact.content || typeof artifact.content !== "object" || Array.isArray(artifact.content)) redirect(`/app/artifacts/${artifactId}`);
  const practice = normalizePracticeSpec(artifact.content.practice);
  if (!practice) redirect(`/app/artifacts/${artifactId}`);
  const existing = await supabase.from("practice_sessions").select("id").eq("family_id", artifact.family_id).eq("artifact_id", artifact.id).in("status", ["ready", "in_progress"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) redirect(`/app?practice=${existing.data.id}`);
  const { data: session, error } = await supabase.from("practice_sessions").insert({
    family_id: artifact.family_id, student_id: artifact.student_id, artifact_id: artifact.id,
    created_by: parent.id, spec: practice,
  }).select("id").single();
  if (error) throw error;
  redirect(`/app?practice=${session.id}`);
}
