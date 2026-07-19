import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireParentApi } from "@/lib/auth/require-parent";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { affectedWorkForConflict, calendarFamilyId, CalendarConflictError, conflictDTO, conflictInputSchema, requireCalendarFamily, verifyConflictStudent } from "@/lib/calendar/conflicts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = conflictInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the conflict details." }, { status: 400 });
    const supabase = await createClient();
    const familyId = await requireCalendarFamily(supabase, parent.id, calendarFamilyId(request));
    await verifyConflictStudent(supabase, familyId, parsed.data.studentId);
    const inserted = await supabase.from("calendar_conflicts").insert({
      family_id: familyId,
      student_id: parsed.data.studentId,
      conflict_date: parsed.data.conflictDate,
      all_day: parsed.data.allDay,
      starts_at: parsed.data.allDay ? null : parsed.data.startsAt,
      ends_at: parsed.data.allDay ? null : parsed.data.endsAt,
      title: parsed.data.title,
      note: parsed.data.note || null,
      created_by: parent.id,
    }).select("id,student_id,conflict_date,all_day,starts_at,ends_at,title,note,created_at,updated_at").single();
    if (inserted.error) throw inserted.error;
    const conflict = conflictDTO(inserted.data);
    const affectedWork = await affectedWorkForConflict(supabase, familyId, conflict);
    await writeAuditEvent(createAdminClient(), { familyId, actorId: parent.id, actorType: "parent", action: "calendar_conflict.created", entityType: "calendar_conflict", entityId: conflict.id, metadata: { conflict_date: conflict.conflictDate, student_id: conflict.studentId, all_day: conflict.allDay, affected_lessons: affectedWork.directOverlapCount } });
    revalidatePath("/app/week");
    return NextResponse.json({ conflict, affectedWork }, { status: 201 });
  } catch (error) {
    if (error instanceof CalendarConflictError) return NextResponse.json({ error: conflictErrorMessage(error.code) }, { status: error.status });
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that conflict." }, { status: 500 });
  }
}

function conflictErrorMessage(code: string) {
  if (code === "LEARNER_NOT_FOUND") return "Choose a learner in this family.";
  return "You do not have permission to edit this family calendar.";
}
