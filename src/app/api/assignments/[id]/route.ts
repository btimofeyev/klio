import { after, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enqueueProactiveEvaluation, processProactiveEvaluation } from "@/lib/proactive/evaluate";

const schema = z.union([
  z.object({ status: z.enum(["planned", "doing", "completed", "skipped"]) }).strict(),
  z.object({ scheduledDate: z.iso.date() }).strict(),
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid assignment update." }, { status: 400 });
    const supabase = await createClient();
    const assignment = await supabase.from("assignments").select("id,family_id,student_id,title,estimated_minutes,status").eq("id", id).maybeSingle();
    if (!assignment.data) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    if ("scheduledDate" in parsed.data) {
      const [student, scheduled] = await Promise.all([
        supabase.from("students").select("daily_capacity_minutes").eq("id", assignment.data.student_id).eq("family_id", assignment.data.family_id).single(),
        supabase.from("assignments").select("id,estimated_minutes,status").eq("family_id", assignment.data.family_id).eq("student_id", assignment.data.student_id).eq("scheduled_date", parsed.data.scheduledDate).neq("id", id),
      ]);
      const error = student.error ?? scheduled.error;
      if (error) throw error;
      if (!student.data) throw new Error("LEARNER_NOT_FOUND");
      const load = (scheduled.data ?? []).filter((item) => item.status !== "skipped").reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0) + (assignment.data.estimated_minutes ?? 0);
      if (load > student.data.daily_capacity_minutes) return NextResponse.json({ error: `That day would exceed this learner’s ${student.data.daily_capacity_minutes}-minute limit.` }, { status: 409 });
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
