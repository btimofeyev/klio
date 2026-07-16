import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const schema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).nullable().optional() }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
    const admin = createAdminClient();
    const { id } = await context.params;
    const proposal = await admin.from("planning_proposals").select("id,family_id,status,title,action_name").eq("id", id).maybeSingle();
    if (proposal.error || !proposal.data) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    const membership = await admin.from("family_members").select("family_id").eq("family_id", proposal.data.family_id).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle();
    if (membership.error || !membership.data) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    if (parsed.data.decision === "reject") {
      const rejected = await admin.from("planning_proposals").update({ status: "rejected", reviewed_by: parent.id, reviewed_at: new Date().toISOString() }).eq("id", id).eq("family_id", proposal.data.family_id).eq("status", "proposed").select("id").maybeSingle();
      if (rejected.error) throw rejected.error;
      if (!rejected.data) return NextResponse.json({ error: "That proposal is no longer waiting." }, { status: 409 });
      await writeAuditEvent(admin, { familyId: proposal.data.family_id, actorId: parent.id, actorType: "parent", action: "planning_proposal.rejected", entityType: "planning_proposal", entityId: id, metadata: { has_note: Boolean(parsed.data.note) } });
      return NextResponse.json({ status: "rejected" });
    }
    const applied = proposal.data.action_name === "record_inferred_grade"
      ? await admin.rpc("apply_grade_return_proposal", { p_proposal_id: id, p_actor_id: parent.id })
      : await admin.rpc("apply_planning_proposal", { p_proposal_id: id, p_actor_id: parent.id });
    if (applied.error) throw applied.error;
    const result = applied.data && typeof applied.data === "object" && !Array.isArray(applied.data) ? applied.data as Record<string, unknown> : {};
    if (result.status === "expired") return NextResponse.json({ error: "The family plan changed after this proposal. Ask Klio to recalculate it." }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not apply that proposal." }, { status: 500 });
  }
}
