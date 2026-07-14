import { after, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enqueueWorkspaceTurn } from "@/lib/agent/workspace/turns";
import { processWorkspaceTurn } from "@/lib/agent/workspace/runtime";
import { serverEnv } from "@/lib/env";

const schema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose approve or decline." }, { status: 400 });
    const supabase = await createClient();
    const proposal = await supabase.from("adjustment_proposals").select("id,family_id,student_id,status,snapshot_version,adjustment_actions(id,assignment_id,action_type,after_state,position)").eq("id", id).maybeSingle();
    if (!proposal.data) return NextResponse.json({ error: "Adjustment not found." }, { status: 404 });
    if (proposal.data.status !== "proposed") return NextResponse.json({ error: "That adjustment has already been decided." }, { status: 409 });
    if (parsed.data.decision === "reject") {
      await supabase.from("adjustment_proposals").update({ status: "rejected", approved_by: parent.id, approved_at: new Date().toISOString() }).eq("id", id).eq("family_id", proposal.data.family_id);
      return NextResponse.json({ status: "rejected" });
    }
    const family = await supabase.from("families").select("agent_context_version").eq("id", proposal.data.family_id).single();
    if (family.error) throw family.error;
    if (family.data.agent_context_version !== proposal.data.snapshot_version) {
      await supabase.from("adjustment_proposals").update({ status: "expired" }).eq("id", id).eq("family_id", proposal.data.family_id);
      return NextResponse.json({ error: "The week changed after this proposal. Ask Klio to recalculate it." }, { status: 409 });
    }
    for (const action of [...proposal.data.adjustment_actions].sort((a, b) => a.position - b.position)) {
      const nextState = action.after_state as { scheduledDate?: string };
      if (!nextState.scheduledDate) continue;
      if (action.action_type === "move" && action.assignment_id) {
        const updated = await supabase.from("assignments").update({ scheduled_date: nextState.scheduledDate }).eq("id", action.assignment_id).eq("family_id", proposal.data.family_id);
        if (updated.error) throw updated.error;
        const placement = await supabase.from("weekly_plan_items").update({ scheduled_date: nextState.scheduledDate, rescheduled_count: 1 }).eq("assignment_id", action.assignment_id).eq("family_id", proposal.data.family_id);
        if (placement.error) throw placement.error;
      } else if (action.action_type === "add_practice") {
        const practice = action.after_state as { scheduledDate: string; estimatedMinutes?: number; subject?: string; title?: string };
        const created = await supabase.from("assignments").insert({ family_id: proposal.data.family_id, student_id: proposal.data.student_id, created_by: parent.id, created_by_type: "agent", title: practice.title ?? "Focused review", subject: practice.subject ?? "Practice", instructions: "Focused reinforcement based on a parent-approved assignment result.", status: "planned", scheduled_date: practice.scheduledDate, estimated_minutes: practice.estimatedMinutes ?? 15, source_kind: "practice" }).select("id,title,subject,scheduled_date,estimated_minutes").single();
        if (created.error) throw created.error;
        const placement = await supabase.from("weekly_plan_items").insert({ family_id: proposal.data.family_id, student_id: proposal.data.student_id, assignment_id: created.data.id, artifact_id: null, title: created.data.title, subject: created.data.subject, description: "Focused reinforcement based on approved work.", scheduled_date: created.data.scheduled_date, estimated_minutes: created.data.estimated_minutes, source_kind: "agent" });
        if (placement.error) throw placement.error;
        if (serverEnv.klioAgentRuntime === "codex_app_server") {
          const workspace = await enqueueWorkspaceTurn({ familyId: proposal.data.family_id, requestedBy: parent.id, studentId: proposal.data.student_id, trigger: "scheduled", goal: "practice", idempotencyKey: `approved-practice:${proposal.data.id}`, request: `Create a short dynamic ${created.data.subject} practice activity for “${created.data.title}”. Ground it only in the latest parent-approved assignment result and current curriculum context. This is focused reinforcement, not replacement curriculum.` });
          if (serverEnv.klioAgentInline && !workspace.duplicate) after(() => processWorkspaceTurn(workspace.turn.id));
        }
      }
      await supabase.from("adjustment_actions").update({ status: "applied" }).eq("id", action.id).eq("family_id", proposal.data.family_id);
    }
    const now = new Date().toISOString();
    await supabase.from("adjustment_proposals").update({ status: "applied", approved_by: parent.id, approved_at: now, applied_at: now }).eq("id", id).eq("family_id", proposal.data.family_id);
    await writeAuditEvent(createAdminClient(), { familyId: proposal.data.family_id, actorId: parent.id, actorType: "parent", action: "schedule_adjustment.applied", entityType: "adjustment_proposal", entityId: id, metadata: { action_count: proposal.data.adjustment_actions.length } });
    return NextResponse.json({ status: "applied" });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not apply that adjustment." }, { status: 500 });
  }
}
