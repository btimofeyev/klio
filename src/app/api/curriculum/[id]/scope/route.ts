import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { resizeCurriculumScope } from "@/lib/curriculum/scope-store";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ targetLessonCount: z.number().int().min(1).max(500) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose between 1 and 500 lessons." }, { status: 400 });
    const { id } = await context.params;
    const supabase = await createClient();
    const unit = await supabase.from("curriculum_units").select("id,family_id,student_id,title,subject,sequence_label,default_minutes,target_lesson_count").eq("id", id).maybeSingle();
    if (unit.error) throw unit.error;
    if (!unit.data) return NextResponse.json({ error: "Curriculum not found." }, { status: 404 });
    const result = await resizeCurriculumScope({ supabase, unit: unit.data, parentId: parent.id, targetLessonCount: parsed.data.targetLessonCount });
    if (!result.allowed) return NextResponse.json({ error: result.reason }, { status: 409 });
    await writeAuditEvent(createAdminClient(), { familyId: unit.data.family_id, actorId: parent.id, actorType: "parent", action: "curriculum_unit.target_changed", entityType: "curriculum_unit", entityId: id, metadata: { previous_target: unit.data.target_lesson_count, target_lesson_count: parsed.data.targetLessonCount } });
    return NextResponse.json({ targetLessonCount: parsed.data.targetLessonCount });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not change that annual lesson target." }, { status: 500 });
  }
}
