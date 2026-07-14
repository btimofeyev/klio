import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const seriesSchema = z.object({
  familyId: z.uuid(),
  studentId: z.uuid(),
  sourceItemId: z.uuid(),
  items: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    scheduledDate: z.iso.date(),
  }).strict()).min(1).max(10),
}).strict();

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = seriesSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the lesson sequence and try again." }, { status: 400 });

    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to this family schedule." }, { status: 403 });
    const { data: source, error: sourceError } = await supabase.from("weekly_plan_items").select("id, family_id, student_id, subject, scheduled_time, estimated_minutes, curriculum_url").eq("id", parsed.data.sourceItemId).eq("family_id", parsed.data.familyId).eq("student_id", parsed.data.studentId).maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) return NextResponse.json({ error: "The first lesson could not be found." }, { status: 404 });

    const requestedDates = parsed.data.items.map((item) => item.scheduledDate);
    const { data: existing, error: existingError } = await supabase.from("weekly_plan_items").select("scheduled_date, title").eq("family_id", parsed.data.familyId).eq("student_id", parsed.data.studentId).in("scheduled_date", requestedDates);
    if (existingError) throw existingError;
    const existingKeys = new Set((existing ?? []).map((item) => `${item.scheduled_date}:${item.title.toLowerCase()}`));
    const additions = parsed.data.items.filter((item) => !existingKeys.has(`${item.scheduledDate}:${item.title.toLowerCase()}`));
    if (!additions.length) return NextResponse.json({ items: [] });

    const { data, error } = await supabase.from("weekly_plan_items").insert(additions.map((item, position) => ({
      family_id: parsed.data.familyId,
      student_id: parsed.data.studentId,
      artifact_id: null,
      title: item.title,
      description: "Continue the family curriculum sequence.",
      subject: source.subject,
      scheduled_date: item.scheduledDate,
      scheduled_time: source.scheduled_time,
      estimated_minutes: source.estimated_minutes,
      curriculum_url: null,
      source_kind: "parent" as const,
      position,
    }))).select("id, artifact_id, student_id, scheduled_date, scheduled_time, title, description, estimated_minutes, subject, curriculum_url, source_kind, rescheduled_count, completed_at, position");
    if (error) throw error;

    await writeAuditEvent(createAdminClient(), {
      familyId: parsed.data.familyId,
      actorId: parent.id,
      actorType: "parent",
      action: "schedule_series.created",
      entityType: "weekly_plan_item",
      entityId: source.id,
      metadata: { created_count: data.length, created_ids: data.map((item) => item.id), source_item_id: source.id },
    });

    return NextResponse.json({ items: data.map(toScheduleItem) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not schedule the lesson sequence." }, { status: 500 });
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
