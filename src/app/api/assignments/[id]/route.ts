import { after, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enqueueProactiveEvaluation, processProactiveEvaluation } from "@/lib/proactive/evaluate";
import { assignmentAttentionInputSchema } from "@/lib/schedule/attention-input";
import { findParentAttentionConflicts, resolveAttentionRequirement } from "@/lib/schedule/parent-attention";
import { assertScheduleChangesFit } from "@/lib/schedule/placement-validation";

const schema = z.union([
  z.object({ status: z.enum(["planned", "doing", "completed", "skipped"]) }).strict(),
  z.object({ scheduledDate: z.iso.date() }).strict(),
  assignmentAttentionInputSchema,
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid assignment update." }, { status: 400 });
    const supabase = await createClient();
    const assignment = await supabase.from("assignments").select("id,family_id,student_id,curriculum_unit_id,title,estimated_minutes,scheduled_date,scheduled_time,status,attention_mode,parent_attention_minutes").eq("id", id).maybeSingle();
    if (!assignment.data) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    if ("attentionMode" in parsed.data) {
      if (parsed.data.attentionMode === "flexible" && (!assignment.data.estimated_minutes || parsed.data.parentAttentionMinutes! > assignment.data.estimated_minutes)) {
        return NextResponse.json({ error: "Minutes together cannot be longer than the lesson." }, { status: 400 });
      }
      const changed = await supabase.from("assignments").update({ attention_mode: parsed.data.attentionMode, parent_attention_minutes: parsed.data.parentAttentionMinutes })
        .eq("id", id).eq("family_id", assignment.data.family_id)
        .select("id,attention_mode,parent_attention_minutes,scheduled_date,scheduled_time,estimated_minutes,curriculum_unit_id").maybeSingle();
      if (changed.error) throw changed.error;
      if (!changed.data) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
      const unit = changed.data.curriculum_unit_id
        ? await supabase.from("curriculum_units").select("attention_mode,parent_attention_minutes").eq("id", changed.data.curriculum_unit_id).eq("family_id", assignment.data.family_id).maybeSingle()
        : { data: null, error: null };
      if (unit.error) throw unit.error;
      const resolved = resolveAttentionRequirement({ assignmentMode: changed.data.attention_mode, assignmentParentMinutes: changed.data.parent_attention_minutes, curriculumMode: unit.data?.attention_mode, curriculumParentMinutes: unit.data?.parent_attention_minutes, lessonMinutes: changed.data.estimated_minutes });
      const conflicts = await attentionConflictsForAssignment(supabase, assignment.data.family_id, changed.data.scheduled_date, id);
      await writeAuditEvent(createAdminClient(), {
        familyId: assignment.data.family_id, actorId: parent.id, actorType: "parent",
        action: parsed.data.attentionMode === null ? "assignment.attention_override_cleared" : "assignment.attention_override_changed",
        entityType: "assignment", entityId: id,
        metadata: { attention_mode: parsed.data.attentionMode, parent_attention_minutes: parsed.data.parentAttentionMinutes, existing_schedule_unchanged: true },
      });
      return NextResponse.json({ assignment: { id, attentionMode: changed.data.attention_mode, parentAttentionMinutes: changed.data.parent_attention_minutes, resolvedAttentionMode: resolved.mode, resolvedParentMinutes: resolved.parentMinutes, attentionInherited: resolved.inherited, attentionSource: resolved.source, scheduledDate: changed.data.scheduled_date, scheduledTime: changed.data.scheduled_time }, attentionConflicts: conflicts, existingScheduleUnchanged: true });
    }
    if ("scheduledDate" in parsed.data) {
      try {
        await assertScheduleChangesFit({
          supabase,
          familyId: assignment.data.family_id,
          studentId: assignment.data.student_id,
          changes: [{ assignmentId: id, scheduledDate: parsed.data.scheduledDate, scheduledTime: assignment.data.scheduled_time, estimatedMinutes: assignment.data.estimated_minutes ?? 30 }],
        });
      } catch (error) {
        const message = placementConflictMessage(error);
        if (message) return NextResponse.json({ error: message }, { status: 409 });
        throw error;
      }
      const moved = await supabase.from("assignments").update({ scheduled_date: parsed.data.scheduledDate }).eq("id", id).eq("family_id", assignment.data.family_id).select("id,scheduled_date").single();
      if (moved.error) throw moved.error;
      const plan = await supabase.from("weekly_plan_items").update({ scheduled_date: parsed.data.scheduledDate, rescheduled_count: 1 }).eq("assignment_id", id).eq("family_id", assignment.data.family_id);
      if (plan.error) throw plan.error;
      await writeAuditEvent(createAdminClient(), { familyId: assignment.data.family_id, actorId: parent.id, actorType: "parent", action: "assignment.moved", entityType: "assignment", entityId: id, metadata: { scheduled_date: parsed.data.scheduledDate } });
      await enqueueProactiveEvaluation({ familyId: assignment.data.family_id, studentId: assignment.data.student_id, requestedBy: parent.id, eventKind: "schedule_adjusted", entityType: "assignment", entityId: id, idempotencyKey: `parent-move:${id}:${parsed.data.scheduledDate}` });
      return NextResponse.json({ assignment: moved.data });
    }
    const now = new Date().toISOString();
    const updates = { status: parsed.data.status, completed_at: parsed.data.status === "completed" ? now : null, skipped_at: parsed.data.status === "skipped" ? now : null };
    const result = await supabase.from("assignments").update(updates).eq("id", id).eq("family_id", assignment.data.family_id).select("id,status,completed_at,skipped_at").single();
    if (result.error) throw result.error;
    await supabase.from("weekly_plan_items").update({ completed_at: parsed.data.status === "completed" ? now : null }).eq("assignment_id", id).eq("family_id", assignment.data.family_id);
    await writeAuditEvent(createAdminClient(), { familyId: assignment.data.family_id, actorId: parent.id, actorType: "parent", action: `assignment.${parsed.data.status}`, entityType: "assignment", entityId: id });
    if (parsed.data.status === "completed") {
      const evaluation = await enqueueProactiveEvaluation({ familyId: assignment.data.family_id, studentId: assignment.data.student_id, requestedBy: parent.id, eventKind: "assignment_completed", entityType: "assignment", entityId: id, idempotencyKey: `assignment-completed:${id}:${result.data.completed_at}` });
      if (!evaluation.duplicate) after(() => processProactiveEvaluation(evaluation.evaluation.id));
    }
    return NextResponse.json({ assignment: result.data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that assignment." }, { status: 500 });
  }
}

async function attentionConflictsForAssignment(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string, scheduledDate: string | null, assignmentId: string) {
  if (!scheduledDate) return [];
  const [assignments, units] = await Promise.all([
    supabase.from("assignments").select("id,student_id,curriculum_unit_id,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,status").eq("family_id", familyId).eq("scheduled_date", scheduledDate).neq("status", "skipped"),
    supabase.from("curriculum_units").select("id,attention_mode,parent_attention_minutes").eq("family_id", familyId),
  ]);
  if (assignments.error ?? units.error) throw assignments.error ?? units.error;
  const unitById = new Map(units.data.map((unit) => [unit.id, unit]));
  return findParentAttentionConflicts(assignments.data.map((item) => {
    const unit = item.curriculum_unit_id ? unitById.get(item.curriculum_unit_id) : null;
    return {
      id: item.id, studentId: item.student_id, scheduledStart: item.scheduled_time,
      requirement: resolveAttentionRequirement({ assignmentMode: item.attention_mode, assignmentParentMinutes: item.parent_attention_minutes, curriculumMode: unit?.attention_mode, curriculumParentMinutes: unit?.parent_attention_minutes, lessonMinutes: item.estimated_minutes }),
    };
  })).filter((conflict) => conflict.firstId === assignmentId || conflict.secondId === assignmentId);
}

function placementConflictMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (error.message === "SCHEDULE_EXCEEDS_AVAILABLE_TIME") return "That day does not have enough available teaching time.";
  if (error.message === "SCHEDULE_TIME_BLOCKED") return "That lesson time overlaps blocked teaching time.";
  if (error.message === "LEARNER_SCHEDULE_OVERLAP") return "That lesson time overlaps another lesson for this learner.";
  if (error.message === "PARENT_ATTENTION_OVERLAP") return "Another lesson needs you at that time.";
  return null;
}
