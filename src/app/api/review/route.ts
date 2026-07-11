import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const itemSchema = z.object({
  entityType: z.enum(["artifact", "skill_observation"]),
  entityId: z.uuid(),
  decision: z.enum(["approved", "rejected"]).optional(),
  updates: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().max(5000).nullable().optional(),
    subject: z.string().trim().min(1).max(80).optional(),
    skillLabel: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["emerging", "developing", "secure", "needs-review"]).optional(),
    rationale: z.string().trim().min(1).max(5000).optional(),
  }).optional(),
}).refine((item) => Boolean(item.decision || item.updates), "A decision or edit is required");

const schema = z.object({ familyId: z.uuid(), items: z.array(itemSchema).min(1).max(100), reason: z.string().trim().max(1000).optional() });

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose drafts and a valid action." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id")
      .eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to those drafts." }, { status: 403 });
    const admin = createAdminClient();
    const reviewedAt = new Date().toISOString();
    const completed: string[] = [];

    for (const item of parsed.data.items) {
      if (item.entityType === "artifact") {
        const values = {
          ...(item.updates?.title !== undefined ? { title: item.updates.title } : {}),
          ...(item.updates?.summary !== undefined ? { summary: item.updates.summary } : {}),
          ...(item.decision ? { status: item.decision, reviewed_by: parent.id, reviewed_at: reviewedAt, rejection_reason: item.decision === "rejected" ? parsed.data.reason || "Rejected by parent" : null } : {}),
        };
        const { data, error } = await admin.from("artifacts").update(values).eq("id", item.entityId).eq("family_id", parsed.data.familyId).eq("status", "draft").select("id").maybeSingle();
        if (error) throw error;
        if (!data) continue;
      } else {
        const values = {
          ...(item.updates?.subject !== undefined ? { subject: item.updates.subject } : {}),
          ...(item.updates?.skillLabel !== undefined ? { skill_label: item.updates.skillLabel } : {}),
          ...(item.updates?.status !== undefined ? { status: item.updates.status } : {}),
          ...(item.updates?.rationale !== undefined ? { rationale: item.updates.rationale } : {}),
          ...(item.decision ? { approval_status: item.decision, reviewed_by: parent.id, reviewed_at: reviewedAt, rejection_reason: item.decision === "rejected" ? parsed.data.reason || "Rejected by parent" : null } : {}),
        };
        const { data, error } = await admin.from("skill_observations").update(values).eq("id", item.entityId).eq("family_id", parsed.data.familyId).eq("approval_status", "draft").select("id").maybeSingle();
        if (error) throw error;
        if (!data) continue;
      }

      if (item.decision) {
        await admin.from("approval_requests").update({
          status: item.decision,
          decided_by: parent.id,
          decided_at: reviewedAt,
          decision_note: parsed.data.reason || null,
        }).eq("entity_id", item.entityId).eq("entity_type", item.entityType).eq("family_id", parsed.data.familyId).eq("status", "pending");
      }
      await writeAuditEvent(admin, {
        familyId: parsed.data.familyId,
        actorId: parent.id,
        actorType: "parent",
        action: item.decision ? `${item.entityType}.${item.decision}` : `${item.entityType}.edited`,
        entityType: item.entityType,
        entityId: item.entityId,
        metadata: { bulk: parsed.data.items.length > 1, edited: Boolean(item.updates) },
      });
      completed.push(item.entityId);
    }
    return NextResponse.json({ completed });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update those drafts." }, { status: 500 });
  }
}
