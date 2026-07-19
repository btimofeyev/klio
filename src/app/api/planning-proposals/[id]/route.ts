import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { assertScheduleChangesFit, type SchedulePlacementChange } from "@/lib/schedule/placement-validation";

const schema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).nullable().optional() }).strict();

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
    const admin = createAdminClient();
    const { id } = await context.params;
    const proposal = await admin.from("planning_proposals").select("id,family_id,student_id,status,title,action_name,target_assignment_id,proposed_changes").eq("id", id).maybeSingle();
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
    try {
      await validateScheduleProposal(admin, proposal.data);
    } catch (error) {
      if (error instanceof Error && ["SCHEDULE_EXCEEDS_AVAILABLE_TIME", "SCHEDULE_TIME_BLOCKED", "INVALID_SCHEDULE_TIME", "DUPLICATE_SCHEDULE_CHANGE"].includes(error.message)) {
        return NextResponse.json({ error: "That schedule no longer fits the learner’s available teaching time. Ask Klio to recalculate it." }, { status: 409 });
      }
      throw error;
    }
    const applied = proposal.data.action_name === "record_inferred_grade"
      ? await admin.rpc("apply_grade_return_proposal", { p_proposal_id: id, p_actor_id: parent.id })
      : await admin.rpc("apply_planning_proposal", { p_proposal_id: id, p_actor_id: parent.id });
    if (applied.error) throw applied.error;
    const result = applied.data && typeof applied.data === "object" && !Array.isArray(applied.data) ? applied.data as Record<string, unknown> : {};
    if (result.status === "expired") {
      const error = result.error === "PROPOSAL_TARGET_STALE"
        ? "An assignment in this proposal changed. Ask Klio to recalculate it."
        : "The family plan changed after this proposal. Ask Klio to recalculate it.";
      return NextResponse.json({ error }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = errorMessage(error);
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (message.includes("PROPOSAL_SNAPSHOT_STALE") || message.includes("PROPOSAL_TARGET_STALE")) {
      return NextResponse.json({ error: "This part of the family plan changed. Ask Klio to recalculate it." }, { status: 409 });
    }
    if (message.includes("PROPOSAL_NOT_ACTIVE")) {
      return NextResponse.json({ error: "That proposal is no longer waiting for approval." }, { status: 409 });
    }
    if (message.includes("PROPOSAL_ASSIGNMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "An assignment in this proposal is no longer available. Ask Klio to recalculate it." }, { status: 409 });
    }
    return NextResponse.json({ error: "Klio could not apply that proposal." }, { status: 500 });
  }
}

async function validateScheduleProposal(
  admin: ReturnType<typeof createAdminClient>,
  proposal: { family_id: string; student_id: string | null; action_name: string; target_assignment_id: string | null; proposed_changes: unknown },
) {
  if (!["prepare_week", "prepare_term", "resize_schedule_work"].includes(proposal.action_name)) return;
  if (proposal.action_name === "resize_schedule_work") {
    if (!proposal.target_assignment_id) throw new Error("PROPOSAL_ASSIGNMENT_NOT_FOUND");
    const assignment = await admin.from("assignments").select("id,student_id,scheduled_date,scheduled_time,estimated_minutes").eq("family_id", proposal.family_id).eq("id", proposal.target_assignment_id).maybeSingle();
    if (assignment.error) throw assignment.error;
    if (!assignment.data) throw new Error("PROPOSAL_ASSIGNMENT_NOT_FOUND");
    const changes = asObject(proposal.proposed_changes);
    const after = typeof changes?.after === "number" ? changes.after : null;
    if (!assignment.data.scheduled_date || after === null) return;
    await assertScheduleChangesFit({ supabase: admin, familyId: proposal.family_id, studentId: assignment.data.student_id, changes: [{ assignmentId: assignment.data.id, scheduledDate: assignment.data.scheduled_date, scheduledTime: assignment.data.scheduled_time, estimatedMinutes: after }] });
    return;
  }
  const payload = asObject(proposal.proposed_changes);
  const rawChanges = Array.isArray(payload?.changes) ? payload.changes.map(asObject).filter((value): value is Record<string, unknown> => Boolean(value)) : [];
  const assignmentIds = [...new Set(rawChanges.flatMap((change) => typeof change.assignmentId === "string" ? [change.assignmentId] : []))];
  if (!assignmentIds.length) return;
  let assignmentsQuery = admin.from("assignments").select("id,student_id,scheduled_date,scheduled_time,estimated_minutes").eq("family_id", proposal.family_id).in("id", assignmentIds);
  if (proposal.student_id) assignmentsQuery = assignmentsQuery.eq("student_id", proposal.student_id);
  const assignments = await assignmentsQuery;
  if (assignments.error) throw assignments.error;
  if (assignments.data.length !== assignmentIds.length) throw new Error("PROPOSAL_ASSIGNMENT_NOT_FOUND");
  const byId = new Map(assignments.data.map((assignment) => [assignment.id, assignment]));
  const placements = rawChanges.flatMap((change): Array<{ studentId: string; change: SchedulePlacementChange }> => {
    if (typeof change.assignmentId !== "string") return [];
    const assignment = byId.get(change.assignmentId);
    if (!assignment) return [];
    const scheduledDate = change.scheduledDate === undefined ? assignment.scheduled_date : typeof change.scheduledDate === "string" ? change.scheduledDate : null;
    if (!scheduledDate) return [];
    return [{ studentId: assignment.student_id, change: { assignmentId: assignment.id, scheduledDate, scheduledTime: assignment.scheduled_time, estimatedMinutes: typeof change.estimatedMinutes === "number" ? change.estimatedMinutes : assignment.estimated_minutes ?? 30 } }];
  });
  const studentIds = [...new Set(placements.map((placement) => placement.studentId))];
  await Promise.all(studentIds.map((studentId) => assertScheduleChangesFit({ supabase: admin, familyId: proposal.family_id, studentId, changes: placements.filter((placement) => placement.studentId === studentId).map((placement) => placement.change) })));
}

function asObject(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
