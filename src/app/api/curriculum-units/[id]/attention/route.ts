import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { curriculumAttentionInputSchema, maximumFlexibleParentMinutes } from "@/lib/schedule/attention-input";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = curriculumAttentionInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid parent support type." }, { status: 400 });
    const supabase = await createClient();
    const unit = await supabase.from("curriculum_units").select("id,family_id,student_id,default_minutes,attention_mode,parent_attention_minutes").eq("id", id).maybeSingle();
    if (unit.error) throw unit.error;
    if (!unit.data) return NextResponse.json({ error: "Curriculum not found." }, { status: 404 });
    if (parsed.data.attentionMode === "flexible") {
      const inheriting = await supabase.from("assignments").select("estimated_minutes").eq("family_id", unit.data.family_id).eq("curriculum_unit_id", id).is("attention_mode", null);
      if (inheriting.error) throw inheriting.error;
      const maximum = maximumFlexibleParentMinutes(unit.data.default_minutes, inheriting.data.map((assignment) => assignment.estimated_minutes));
      if (parsed.data.parentAttentionMinutes! > maximum) return NextResponse.json({ error: `Minutes together cannot be longer than the shortest ${maximum}-minute lesson.` }, { status: 400 });
    }
    const updated = await supabase.from("curriculum_units").update({ attention_mode: parsed.data.attentionMode, parent_attention_minutes: parsed.data.parentAttentionMinutes })
      .eq("id", id).eq("family_id", unit.data.family_id).eq("student_id", unit.data.student_id)
      .select("id,attention_mode,parent_attention_minutes").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return NextResponse.json({ error: "Curriculum not found." }, { status: 404 });
    const scheduled = await supabase.from("assignments").select("id", { count: "exact", head: true }).eq("family_id", unit.data.family_id).eq("curriculum_unit_id", id).is("attention_mode", null).not("scheduled_date", "is", null).neq("status", "skipped");
    if (scheduled.error) throw scheduled.error;
    await writeAuditEvent(createAdminClient(), {
      familyId: unit.data.family_id, actorId: parent.id, actorType: "parent",
      action: "curriculum.attention_preference_changed", entityType: "curriculum_unit", entityId: id,
      metadata: { before: { attention_mode: unit.data.attention_mode, parent_attention_minutes: unit.data.parent_attention_minutes }, after: { attention_mode: parsed.data.attentionMode, parent_attention_minutes: parsed.data.parentAttentionMinutes }, existing_schedule_unchanged: true },
    });
    revalidatePath("/app", "layout");
    return NextResponse.json({ curriculumUnit: { id, attentionMode: updated.data.attention_mode, parentAttentionMinutes: updated.data.parent_attention_minutes }, affectedScheduledLessonCount: scheduled.count ?? 0, existingScheduleUnchanged: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that parent support preference." }, { status: 500 });
  }
}
