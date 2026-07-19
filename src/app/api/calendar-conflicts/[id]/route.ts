import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireParentApi } from "@/lib/auth/require-parent";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { affectedWorkForConflict, calendarFamilyId, CalendarConflictError, conflictDTO, conflictInputSchema, requireCalendarFamily, verifyConflictStudent } from "@/lib/calendar/conflicts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    if (!uuid.test(id)) return NextResponse.json({ error: "Conflict not found." }, { status: 404 });
    const parsed = conflictInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the conflict details." }, { status: 400 });
    const supabase = await createClient();
    const familyId = await requireCalendarFamily(supabase, parent.id, calendarFamilyId(request));
    await verifyConflictStudent(supabase, familyId, parsed.data.studentId);
    const updated = await supabase.from("calendar_conflicts").update({
      student_id: parsed.data.studentId,
      conflict_date: parsed.data.conflictDate,
      all_day: parsed.data.allDay,
      starts_at: parsed.data.allDay ? null : parsed.data.startsAt,
      ends_at: parsed.data.allDay ? null : parsed.data.endsAt,
      title: parsed.data.title,
      note: parsed.data.note || null,
    }).eq("id", id).eq("family_id", familyId).select("id,student_id,conflict_date,all_day,starts_at,ends_at,title,note,created_at,updated_at").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return NextResponse.json({ error: "Conflict not found." }, { status: 404 });
    const conflict = conflictDTO(updated.data);
    const affectedWork = await affectedWorkForConflict(supabase, familyId, conflict);
    await writeAuditEvent(createAdminClient(), { familyId, actorId: parent.id, actorType: "parent", action: "calendar_conflict.updated", entityType: "calendar_conflict", entityId: id, metadata: { conflict_date: conflict.conflictDate, student_id: conflict.studentId, all_day: conflict.allDay, affected_lessons: affectedWork.directOverlapCount } });
    revalidatePath("/app/week");
    return NextResponse.json({ conflict, affectedWork });
  } catch (error) {
    if (error instanceof CalendarConflictError) return NextResponse.json({ error: error.code === "LEARNER_NOT_FOUND" ? "Choose a learner in this family." : "You do not have permission to edit this family calendar." }, { status: error.status });
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that conflict." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    if (!uuid.test(id)) return NextResponse.json({ error: "Conflict not found." }, { status: 404 });
    const supabase = await createClient();
    const familyId = await requireCalendarFamily(supabase, parent.id, calendarFamilyId(request));
    const existing = await supabase.from("calendar_conflicts").select("id,title,conflict_date,student_id").eq("id", id).eq("family_id", familyId).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: "Conflict not found." }, { status: 404 });
    const removed = await supabase.from("calendar_conflicts").delete().eq("id", id).eq("family_id", familyId).select("id").maybeSingle();
    if (removed.error) throw removed.error;
    if (!removed.data) return NextResponse.json({ error: "Conflict not found." }, { status: 404 });
    await writeAuditEvent(createAdminClient(), { familyId, actorId: parent.id, actorType: "parent", action: "calendar_conflict.deleted", entityType: "calendar_conflict", entityId: id, metadata: { conflict_date: existing.data.conflict_date, student_id: existing.data.student_id, title: existing.data.title } });
    revalidatePath("/app/week");
    return NextResponse.json({ deletedId: id });
  } catch (error) {
    if (error instanceof CalendarConflictError) return NextResponse.json({ error: "You do not have permission to edit this family calendar." }, { status: error.status });
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not delete that conflict." }, { status: 500 });
  }
}
