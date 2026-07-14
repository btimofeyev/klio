import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ weeklyFrequency: z.number().int().min(1).max(7) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose between one and seven sessions per week." }, { status: 400 });
    const supabase = await createClient();
    const unit = await supabase.from("curriculum_units").select("id,family_id,student_id,subject,schedule_rule").eq("id", id).maybeSingle();
    if (!unit.data) return NextResponse.json({ error: "Curriculum not found." }, { status: 404 });
    const scheduleRule = unit.data.schedule_rule && typeof unit.data.schedule_rule === "object" && !Array.isArray(unit.data.schedule_rule) ? unit.data.schedule_rule : {};
    const result = await supabase.from("curriculum_units").update({ schedule_rule: { ...scheduleRule, weeklyFrequency: parsed.data.weeklyFrequency } }).eq("id", id).eq("family_id", unit.data.family_id).eq("student_id", unit.data.student_id).select("id,schedule_rule").single();
    if (result.error) throw result.error;
    const subject = await supabase.from("student_subjects").update({ weekly_frequency: parsed.data.weeklyFrequency }).eq("family_id", unit.data.family_id).eq("student_id", unit.data.student_id).eq("name", unit.data.subject);
    if (subject.error) throw subject.error;
    await writeAuditEvent(createAdminClient(), { familyId: unit.data.family_id, actorId: parent.id, actorType: "parent", action: "curriculum_unit.rhythm_updated", entityType: "curriculum_unit", entityId: id, metadata: { weekly_frequency: parsed.data.weeklyFrequency } });
    return NextResponse.json({ unit: result.data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that teaching rhythm." }, { status: 500 });
  }
}
