import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const schema = z.object({ decision: z.enum(["approve", "reject", "undo", "acknowledge"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose approve, decline, undo, or acknowledge." }, { status: 400 });
    const supabase = await createClient();
    const proposal = await supabase.from("adjustment_proposals").select("id,family_id,status,undo_status,created_at,acknowledged_at").eq("id", id).maybeSingle();
    if (proposal.error || !proposal.data) return NextResponse.json({ error: "Adjustment not found." }, { status: 404 });
    const admin = createAdminClient();
    if (parsed.data.decision === "acknowledge") {
      if (proposal.data.status !== "applied") return NextResponse.json({ error: "Only a completed adjustment can be acknowledged." }, { status: 409 });
      const acknowledgedAt = proposal.data.acknowledged_at ?? new Date().toISOString();
      const acknowledged = await supabase.from("adjustment_proposals")
        .update({ acknowledged_at: acknowledgedAt, acknowledged_by: parent.id })
        .eq("family_id", proposal.data.family_id)
        .eq("status", "applied")
        .is("acknowledged_at", null)
        .lte("created_at", proposal.data.created_at)
        .select("id");
      if (acknowledged.error) throw acknowledged.error;
      const acknowledgedIds = acknowledged.data.map((item) => item.id);
      if (acknowledgedIds.length) {
        const activeInsights = await supabase.from("klio_insights").select("id,action_ref").eq("family_id", proposal.data.family_id).eq("status", "active");
        if (activeInsights.error) throw activeInsights.error;
        const linkedInsightIds = activeInsights.data.flatMap((insight) => {
          const ref = insight.action_ref && typeof insight.action_ref === "object" && !Array.isArray(insight.action_ref) ? insight.action_ref : null;
          return ref && typeof ref.proposalId === "string" && acknowledgedIds.includes(ref.proposalId) ? [insight.id] : [];
        });
        if (linkedInsightIds.length) {
          const dismissed = await supabase.from("klio_insights").update({ status: "dismissed", dismissed_at: acknowledgedAt, dismissed_by: parent.id }).in("id", linkedInsightIds);
          if (dismissed.error) throw dismissed.error;
        }
      }
      await writeAuditEvent(admin, {
        familyId: proposal.data.family_id,
        actorId: parent.id,
        actorType: "parent",
        action: "schedule_adjustment.acknowledged",
        entityType: "adjustment_proposal",
        entityId: id,
        metadata: { acknowledged_count: acknowledgedIds.length, through_created_at: proposal.data.created_at },
      });
      revalidatePath("/app", "layout");
      return NextResponse.json({ status: "acknowledged", acknowledgedCount: acknowledgedIds.length, alreadyAcknowledged: acknowledgedIds.length === 0 });
    }
    if (parsed.data.decision === "reject") {
      if (proposal.data.status !== "proposed") return NextResponse.json({ error: "That adjustment has already been decided." }, { status: 409 });
      const rejected = await supabase.from("adjustment_proposals").update({ status: "rejected", approved_by: parent.id, approved_at: new Date().toISOString() }).eq("id", id).eq("family_id", proposal.data.family_id).eq("status", "proposed");
      if (rejected.error) throw rejected.error;
      await writeAuditEvent(admin, { familyId: proposal.data.family_id, actorId: parent.id, actorType: "parent", action: "schedule_adjustment.rejected", entityType: "adjustment_proposal", entityId: id });
      revalidatePath("/app", "layout");
      return NextResponse.json({ status: "rejected" });
    }
    const rpc = parsed.data.decision === "undo"
      ? await admin.rpc("undo_klio_adjustment", { p_proposal_id: id, p_actor_id: parent.id })
      : await admin.rpc("apply_klio_adjustment", { p_proposal_id: id, p_actor_id: parent.id });
    if (rpc.error) {
      if (/SNAPSHOT_STALE|ACTION_STALE/.test(rpc.error.message)) return NextResponse.json({ error: parsed.data.decision === "undo" ? "The week changed after this adjustment, so undo would overwrite later work." : "The week changed after this proposal. Ask Klio to recalculate it." }, { status: 409 });
      if (/UNDO_PRACTICE_ALREADY_USED/.test(rpc.error.message)) return NextResponse.json({ error: "That practice has already been used, so it cannot be removed safely." }, { status: 409 });
      throw rpc.error;
    }
    const outcome = rpc.data && typeof rpc.data === "object" && !Array.isArray(rpc.data) ? rpc.data as Record<string, unknown> : {};
    if (outcome.status === "stale" || outcome.status === "expired") return NextResponse.json({ error: parsed.data.decision === "undo" ? "The week changed after this adjustment, so undo would overwrite later work." : "The week changed after this proposal. Ask Klio to recalculate it." }, { status: 409 });
    revalidatePath("/app", "layout");
    return NextResponse.json(rpc.data);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not safely update that adjustment." }, { status: 500 });
  }
}
