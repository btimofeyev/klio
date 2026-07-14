import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { scheduleDates } from "@/lib/assignments/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  curriculumUnitId: z.uuid().nullable().optional(),
  familyId: z.uuid(), studentId: z.uuid(), subject: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200),
  sequenceLabel: z.string().trim().min(1).max(40).default("Lesson"), startSequence: z.number().int().min(1).max(10000).default(1),
  count: z.number().int().min(1).max(40).default(10), startDate: z.iso.date(), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), estimatedMinutes: z.number().int().min(5).max(480).default(40),
  weeklyFrequency: z.number().int().min(1).max(7).default(5),
  curriculumUrl: z.url().max(2048).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the curriculum details and try again." }, { status: 400 });
    const input = parsed.data;
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", input.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership.data) return NextResponse.json({ error: "You do not have access to this family." }, { status: 403 });
    const student = await supabase.from("students").select("id").eq("id", input.studentId).eq("family_id", input.familyId).maybeSingle();
    if (!student.data) return NextResponse.json({ error: "Choose a learner in this family." }, { status: 400 });

    const unitValues = {
      subject: input.subject, title: input.title, curriculum_url: input.curriculumUrl ?? null, sequence_label: input.sequenceLabel,
      next_sequence_number: input.startSequence + input.count, default_minutes: input.estimatedMinutes,
      schedule_rule: { weekdays: input.weekdays, scheduledTime: input.scheduledTime ?? null, weeklyFrequency: input.weeklyFrequency },
    };
    const unit = input.curriculumUnitId
      ? await supabase.from("curriculum_units").update(unitValues).eq("id", input.curriculumUnitId).eq("family_id", input.familyId).eq("student_id", input.studentId).select("id,subject,title").single()
      : await supabase.from("curriculum_units").insert({ family_id: input.familyId, student_id: input.studentId, created_by: parent.id, ...unitValues }).select("id,subject,title").single();
    if (unit.error) throw unit.error;
    const dates = scheduleDates(input.startDate, input.weekdays, input.count);
    const assignments = await supabase.from("assignments").insert(dates.map((scheduledDate, index) => ({
      family_id: input.familyId, student_id: input.studentId, curriculum_unit_id: unit.data.id, created_by: parent.id, created_by_type: "parent" as const,
      title: `${input.title} · ${input.sequenceLabel} ${input.startSequence + index}`, subject: input.subject, sequence_number: input.startSequence + index,
      status: "planned" as const, scheduled_date: scheduledDate, scheduled_time: input.scheduledTime ?? null, estimated_minutes: input.estimatedMinutes, source_kind: "curriculum" as const,
    }))).select("id,title,subject,status,scheduled_date,scheduled_time,estimated_minutes,sequence_number,curriculum_unit_id");
    if (assignments.error) throw assignments.error;
    const placements = await supabase.from("weekly_plan_items").insert(assignments.data.map((assignment, position) => ({
      family_id: input.familyId, student_id: input.studentId, assignment_id: assignment.id, artifact_id: null, title: assignment.title, subject: assignment.subject,
      scheduled_date: assignment.scheduled_date, scheduled_time: assignment.scheduled_time, estimated_minutes: assignment.estimated_minutes,
      curriculum_url: input.curriculumUrl ?? null, source_kind: "parent", position,
    })));
    if (placements.error) throw placements.error;
    await writeAuditEvent(createAdminClient(), { familyId: input.familyId, actorId: parent.id, actorType: "parent", action: input.curriculumUnitId ? "curriculum_unit.scheduled" : "curriculum_unit.created", entityType: "curriculum_unit", entityId: unit.data.id, metadata: { assignment_count: assignments.data.length } });
    return NextResponse.json({ unit: unit.data, assignments: assignments.data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not add that curriculum." }, { status: 500 });
  }
}
