"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireParent } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

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

export async function addStudentAction(formData: FormData) {
  await requireParent();
  const parsed = z.object({
    familyId: z.uuid(), displayName: z.string().trim().min(1).max(80),
    gradeBand: z.enum(["pre-k", "k-2", "3-5", "6-8", "9-12", "other"]),
    learningPreferences: z.string().trim().max(2000).optional(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("students").insert({
    family_id: parsed.familyId, display_name: parsed.displayName, grade_band: parsed.gradeBand,
    learning_preferences: parsed.learningPreferences || null,
  });
  if (error) throw error;
  revalidatePath("/app", "layout");
}

export async function launchPracticeAction(formData: FormData) {
  const parent = await requireParent();
  const { artifactId } = z.object({ artifactId: z.uuid() }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: artifact } = await supabase.from("artifacts").select("id, family_id, student_id, content, status, type").eq("id", artifactId).eq("status", "approved").eq("type", "practice").maybeSingle();
  if (!artifact?.student_id || !artifact.content || typeof artifact.content !== "object" || Array.isArray(artifact.content)) throw new Error("Approve a valid practice activity first.");
  const practice = artifact.content.practice;
  if (!practice || typeof practice !== "object" || Array.isArray(practice)) throw new Error("Practice specification is missing.");
  const { data: session, error } = await supabase.from("practice_sessions").insert({
    family_id: artifact.family_id, student_id: artifact.student_id, artifact_id: artifact.id,
    created_by: parent.id, spec: practice,
  }).select("id").single();
  if (error) throw error;
  redirect(`/practice/${session.id}`);
}
