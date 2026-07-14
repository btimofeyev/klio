import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { inferNextCurriculumLessons } from "@/lib/schedule/sequence";

const nextLessonSchema = z.object({
  familyId: z.uuid(),
  studentId: z.uuid(),
  subject: z.string().trim().min(1).max(80),
  scheduledDate: z.iso.date(),
}).strict();

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = nextLessonSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid subject and day." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to this family schedule." }, { status: 403 });

    const { data: schedule, error: scheduleError } = await supabase.from("weekly_plan_items").select("id, student_id, scheduled_date, scheduled_time, title, estimated_minutes, subject").eq("family_id", parsed.data.familyId).eq("student_id", parsed.data.studentId).lte("scheduled_date", parsed.data.scheduledDate).order("scheduled_date", { ascending: true }).limit(200);
    if (scheduleError) throw scheduleError;
    const options = inferNextCurriculumLessons((schedule ?? []).map((item) => ({ id: item.id, studentId: item.student_id, scheduledDate: item.scheduled_date, scheduledTime: item.scheduled_time, title: item.title, estimatedMinutes: item.estimated_minutes, subject: item.subject })), parsed.data.scheduledDate);
    const next = options.find((option) => option.subject.toLowerCase() === parsed.data.subject.toLowerCase());
    if (!next) return NextResponse.json({ error: `${parsed.data.subject} already has work that day, or Klio could not verify the next numbered lesson.` }, { status: 409 });

    const { data, error } = await supabase.from("weekly_plan_items").insert({
      family_id: parsed.data.familyId,
      student_id: parsed.data.studentId,
      artifact_id: null,
      title: next.title,
      description: "Continue the family curriculum sequence.",
      subject: next.subject,
      scheduled_date: next.scheduledDate,
      scheduled_time: next.scheduledTime,
      estimated_minutes: next.estimatedMinutes,
      source_kind: "parent",
    }).select("id, artifact_id, student_id, scheduled_date, scheduled_time, title, description, estimated_minutes, subject, curriculum_url, source_kind, rescheduled_count, completed_at, position").single();
    if (error) throw error;

    await writeAuditEvent(createAdminClient(), {
      familyId: parsed.data.familyId,
      actorId: parent.id,
      actorType: "parent",
      action: "schedule_item.next_created",
      entityType: "weekly_plan_item",
      entityId: data.id,
      metadata: { source_item_id: next.sourceItemId, scheduled_date: next.scheduledDate, subject: next.subject },
    });
    return NextResponse.json({ item: toScheduleItem(data) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not schedule the next lesson." }, { status: 500 });
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
