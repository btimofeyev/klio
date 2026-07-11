import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const reasonCodes = ["wrong_learner", "wrong_subject", "misunderstood_work", "parent_or_sibling_helped", "not_enough_information", "something_else"] as const;
const reasonSchema = z.object({ code: z.enum(reasonCodes), detail: z.string().trim().min(1).max(1000).optional() });
const itemSchema = z.object({
  requestId: z.uuid(), entityType: z.enum(["artifact", "skill_observation"]), entityId: z.uuid(), decision: z.enum(["approved", "rejected"]).optional(),
  reason: reasonSchema.optional(),
  updates: z.object({
    title: z.string().trim().min(1).max(200).optional(), summary: z.string().trim().max(5000).nullable().optional(),
    subject: z.string().trim().min(1).max(80).optional(), skillLabel: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["emerging", "developing", "secure", "needs-review"]).optional(), rationale: z.string().trim().min(1).max(5000).optional(),
  }).optional(),
}).superRefine((item, context) => {
  if (!item.decision && !item.updates) context.addIssue({ code: "custom", message: "A decision or edit is required" });
  if (item.decision === "rejected" && !item.reason) context.addIssue({ code: "custom", message: "A correction reason is required", path: ["reason"] });
  if (item.decision !== "rejected" && item.reason) context.addIssue({ code: "custom", message: "Reasons are only accepted with a correction", path: ["reason"] });
});
const reviewRequestSchema = z.object({ familyId: z.uuid(), items: z.array(itemSchema).min(1).max(100) });

type ReviewItem = z.infer<typeof itemSchema>;
type ReviewResult = { requestId: string; entityType: ReviewItem["entityType"]; entityId: string; status: "completed" | "not_found_or_already_decided" | "failed"; error?: string };
const correctionLabels: Record<(typeof reasonCodes)[number], string> = {
  wrong_learner: "Wrong learner", wrong_subject: "Wrong subject", misunderstood_work: "Misunderstood the work",
  parent_or_sibling_helped: "A parent or sibling helped", not_enough_information: "Not enough information", something_else: "Something else",
};

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = reviewRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid action. Corrections need a reason." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to those suggestions." }, { status: 403 });
    const admin = createAdminClient();
    const results: ReviewResult[] = [];
    for (const item of parsed.data.items) results.push(await processItem(admin, parent.id, parsed.data.familyId, item, parsed.data.items.length > 1));
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update those suggestions." }, { status: 500 });
  }
}

async function processItem(admin: ReturnType<typeof createAdminClient>, parentId: string, familyId: string, item: ReviewItem, bulk: boolean): Promise<ReviewResult> {
  const result = (status: ReviewResult["status"], error?: string): ReviewResult => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, status, ...(error ? { error } : {}) });
  try {
    const { data: approval, error: approvalLookupError } = await admin.from("approval_requests").select("id").eq("id", item.requestId).eq("entity_id", item.entityId).eq("entity_type", item.entityType).eq("family_id", familyId).eq("status", "pending").maybeSingle();
    if (approvalLookupError) return result("failed", "The review request could not be checked.");
    if (!approval) return result("not_found_or_already_decided");
    const reviewedAt = new Date().toISOString();
    const rejectionReason = item.reason ? serializeReason(item.reason) : null;
    let auditTitle: string | null = null;
    let studentId: string | null = null;

    if (item.entityType === "artifact") {
      const { data: current } = await admin.from("artifacts").select("title, student_id").eq("id", item.entityId).eq("family_id", familyId).eq("status", "draft").maybeSingle();
      if (!current) return result("not_found_or_already_decided");
      auditTitle = item.updates?.title ?? current.title; studentId = current.student_id;
      const values = {
        ...(item.updates?.title !== undefined ? { title: item.updates.title } : {}), ...(item.updates?.summary !== undefined ? { summary: item.updates.summary } : {}),
        ...(item.decision ? { status: item.decision, reviewed_by: parentId, reviewed_at: reviewedAt, rejection_reason: item.decision === "rejected" ? rejectionReason : null } : {}),
      };
      const { data, error } = await admin.from("artifacts").update(values).eq("id", item.entityId).eq("family_id", familyId).eq("status", "draft").select("id").maybeSingle();
      if (error) return result("failed", "The draft could not be updated.");
      if (!data) return result("not_found_or_already_decided");
    } else {
      const { data: current } = await admin.from("skill_observations").select("skill_label, student_id").eq("id", item.entityId).eq("family_id", familyId).eq("approval_status", "draft").maybeSingle();
      if (!current) return result("not_found_or_already_decided");
      auditTitle = item.updates?.skillLabel ?? current.skill_label; studentId = current.student_id;
      const values = {
        ...(item.updates?.subject !== undefined ? { subject: item.updates.subject } : {}), ...(item.updates?.skillLabel !== undefined ? { skill_label: item.updates.skillLabel } : {}),
        ...(item.updates?.status !== undefined ? { status: item.updates.status } : {}), ...(item.updates?.rationale !== undefined ? { rationale: item.updates.rationale } : {}),
        ...(item.decision ? { approval_status: item.decision, reviewed_by: parentId, reviewed_at: reviewedAt, rejection_reason: item.decision === "rejected" ? rejectionReason : null } : {}),
      };
      const { data, error } = await admin.from("skill_observations").update(values).eq("id", item.entityId).eq("family_id", familyId).eq("approval_status", "draft").select("id").maybeSingle();
      if (error) return result("failed", "The learning note could not be updated.");
      if (!data) return result("not_found_or_already_decided");
    }

    if (item.decision) {
      const { data, error } = await admin.from("approval_requests").update({ status: item.decision, decided_by: parentId, decided_at: reviewedAt, decision_note: rejectionReason }).eq("id", item.requestId).eq("family_id", familyId).eq("status", "pending").select("id").maybeSingle();
      if (error || !data) return result("failed", "The decision changed, but the review queue could not be updated. Refresh before trying again.");
    }
    let studentName: string | null = null;
    if (studentId) {
      const { data: student } = await admin.from("students").select("display_name").eq("id", studentId).eq("family_id", familyId).maybeSingle();
      studentName = student?.display_name ?? null;
    }
    await writeAuditEvent(admin, {
      familyId, actorId: parentId, actorType: "parent", action: item.decision ? `${item.entityType}.${item.decision}` : `${item.entityType}.edited`, entityType: item.entityType, entityId: item.entityId,
      metadata: { bulk, edited: Boolean(item.updates), ...(item.entityType === "artifact" ? { title: auditTitle } : { skill_label: auditTitle }), student_name: studentName, correction_code: item.reason?.code ?? null, correction_label: item.reason ? correctionLabels[item.reason.code] : null, has_correction_detail: Boolean(item.reason?.detail) },
    });
    return result("completed");
  } catch {
    return result("failed", "This suggestion could not be updated.");
  }
}

function serializeReason(reason: z.infer<typeof reasonSchema>) {
  return JSON.stringify({ code: reason.code, ...(reason.detail ? { detail: reason.detail } : {}) });
}
