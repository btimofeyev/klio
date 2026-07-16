import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const pacingSchema = z.object({
  curriculumUnitId: z.uuid(), startsOn: z.iso.date(), targetCompletionDate: z.iso.date(), startSequence: z.number().int().min(1).max(100000),
  targetSequence: z.number().int().min(1).max(100000), weeklyCadence: z.number().int().min(1).max(14), weeklyEffortMinutes: z.number().int().min(5).max(10080),
}).strict().refine((value) => value.targetSequence >= value.startSequence && value.targetCompletionDate >= value.startsOn);
const schema = z.object({
  familyId: z.uuid(), studentId: z.uuid(), termId: z.uuid(), title: z.string().trim().min(1).max(200), subject: z.string().trim().min(1).max(80),
  description: z.string().trim().max(3000).nullable().optional(), goalKind: z.enum(["curriculum_progress", "milestone", "effort", "credit", "hours", "standard", "custom"]).default("curriculum_progress"),
  targetValue: z.number().min(0).max(1_000_000).nullable().optional(), targetUnit: z.string().trim().max(40).nullable().optional(), targetDate: z.iso.date().nullable().optional(),
  weeklyEffortMinutes: z.number().int().min(0).max(10080).nullable().optional(), weeklyCadence: z.number().int().min(0).max(14).nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50), constraints: z.string().trim().max(2000).nullable().optional(), pacing: pacingSchema.nullable().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the goal and pacing details." }, { status: 400 });
    const input = parsed.data;
    const supabase = await createClient();
    const [membership, student, term] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", input.familyId).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle(),
      supabase.from("students").select("id").eq("family_id", input.familyId).eq("id", input.studentId).eq("active", true).maybeSingle(),
      supabase.from("academic_terms").select("id,starts_on,ends_on").eq("family_id", input.familyId).eq("id", input.termId).maybeSingle(),
    ]);
    if (!membership.data || !student.data || !term.data) return NextResponse.json({ error: "Learner or term not found." }, { status: 404 });
    if (input.pacing) {
      const curriculum = await supabase.from("curriculum_units").select("id").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("id", input.pacing.curriculumUnitId).maybeSingle();
      if (!curriculum.data) return NextResponse.json({ error: "Curriculum not found for this learner." }, { status: 404 });
      if (input.pacing.startsOn < term.data.starts_on || input.pacing.targetCompletionDate > term.data.ends_on) return NextResponse.json({ error: "Pacing dates must stay inside the academic term." }, { status: 400 });
    }
    const goal = await supabase.from("learning_goals").insert({
      family_id: input.familyId, student_id: input.studentId, term_id: input.termId, created_by: parent.id,
      title: input.title, subject: input.subject, description: input.description ?? null, goal_kind: input.goalKind,
      target_value: input.targetValue ?? null, target_unit: input.targetUnit ?? null, target_date: input.targetDate ?? null,
      weekly_effort_minutes: input.weeklyEffortMinutes ?? input.pacing?.weeklyEffortMinutes ?? null,
      weekly_cadence: input.weeklyCadence ?? input.pacing?.weeklyCadence ?? null, priority: input.priority,
      constraints: input.constraints ?? null, status: "active",
    }).select("id,title,subject,status").single();
    if (goal.error) throw goal.error;
    let pacingTarget = null;
    if (input.pacing) {
      const pacing = await supabase.from("curriculum_pacing_targets").insert({
        family_id: input.familyId, student_id: input.studentId, term_id: input.termId,
        curriculum_unit_id: input.pacing.curriculumUnitId, goal_id: goal.data.id, created_by: parent.id,
        starts_on: input.pacing.startsOn, target_completion_date: input.pacing.targetCompletionDate,
        start_sequence: input.pacing.startSequence, target_sequence: input.pacing.targetSequence,
        expected_assignments: input.pacing.targetSequence - input.pacing.startSequence + 1,
        weekly_cadence: input.pacing.weeklyCadence, weekly_effort_minutes: input.pacing.weeklyEffortMinutes,
        priority: input.priority, constraints: input.constraints ?? null, status: "active",
      }).select("id,target_completion_date,target_sequence,weekly_cadence,weekly_effort_minutes").single();
      if (pacing.error) {
        await supabase.from("learning_goals").delete().eq("id", goal.data.id).eq("family_id", input.familyId);
        throw pacing.error;
      }
      pacingTarget = pacing.data;
    }
    await writeAuditEvent(createAdminClient(), { familyId: input.familyId, actorId: parent.id, actorType: "parent", action: "learning_goal.created", entityType: "learning_goal", entityId: goal.data.id, metadata: { student_id: input.studentId, subject: input.subject, has_pacing_target: Boolean(pacingTarget) } });
    return NextResponse.json({ goal: goal.data, pacingTarget }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that learning goal." }, { status: 500 });
  }
}
