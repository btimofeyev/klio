import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const createScheduleItemSchema = z.object({
  familyId: z.uuid(),
  studentId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  subject: z.string().trim().min(1).max(80),
  scheduledDate: z.iso.date(),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  estimatedMinutes: z.number().int().min(5).max(480).nullable().optional(),
  curriculumUrl: z.url().max(2000).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = createScheduleItemSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the curriculum block and try again." }, { status: 400 });

    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to this family schedule." }, { status: 403 });
    const { data: student } = await supabase.from("students").select("id").eq("id", parsed.data.studentId).eq("family_id", parsed.data.familyId).eq("active", true).maybeSingle();
    if (!student) return NextResponse.json({ error: "Choose an active learner." }, { status: 400 });

    const { data, error } = await supabase.from("weekly_plan_items").insert({
      family_id: parsed.data.familyId,
      student_id: parsed.data.studentId,
      artifact_id: null,
      title: parsed.data.title,
      description: parsed.data.description || null,
      subject: parsed.data.subject,
      scheduled_date: parsed.data.scheduledDate,
      scheduled_time: parsed.data.scheduledTime ? `${parsed.data.scheduledTime}:00` : null,
      estimated_minutes: parsed.data.estimatedMinutes ?? null,
      curriculum_url: parsed.data.curriculumUrl ?? null,
      source_kind: "parent",
    }).select("id, artifact_id, student_id, scheduled_date, scheduled_time, title, description, estimated_minutes, subject, curriculum_url, source_kind, rescheduled_count, completed_at, position").single();
    if (error) throw error;

    await writeAuditEvent(createAdminClient(), {
      familyId: parsed.data.familyId,
      actorId: parent.id,
      actorType: "parent",
      action: "schedule_item.created",
      entityType: "weekly_plan_item",
      entityId: data.id,
      metadata: { scheduled_date: data.scheduled_date, subject: data.subject },
    });

    return NextResponse.json({ item: toScheduleItem(data) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not add that curriculum block." }, { status: 500 });
  }
}

function toScheduleItem(item: {
  id: string; artifact_id: string | null; student_id: string | null; scheduled_date: string | null; scheduled_time: string | null;
  title: string; description: string | null; estimated_minutes: number | null; subject: string | null; curriculum_url: string | null;
  source_kind: string; rescheduled_count: number; completed_at: string | null; position: number;
}) {
  return {
    id: item.id, artifactId: item.artifact_id, studentId: item.student_id, scheduledDate: item.scheduled_date,
    scheduledTime: item.scheduled_time, title: item.title, description: item.description, estimatedMinutes: item.estimated_minutes,
    subject: item.subject, curriculumUrl: item.curriculum_url, sourceKind: item.source_kind,
    rescheduledCount: item.rescheduled_count, completedAt: item.completed_at, position: item.position, artifact: null,
  };
}
