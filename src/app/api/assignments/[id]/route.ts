import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ status: z.enum(["planned", "doing", "completed", "skipped"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid assignment status." }, { status: 400 });
    const supabase = await createClient();
    const assignment = await supabase.from("assignments").select("id,family_id").eq("id", id).maybeSingle();
    if (!assignment.data) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    const now = new Date().toISOString();
    const updates = { status: parsed.data.status, completed_at: parsed.data.status === "completed" ? now : null, skipped_at: parsed.data.status === "skipped" ? now : null };
    const result = await supabase.from("assignments").update(updates).eq("id", id).eq("family_id", assignment.data.family_id).select("id,status,completed_at,skipped_at").single();
    if (result.error) throw result.error;
    await supabase.from("weekly_plan_items").update({ completed_at: parsed.data.status === "completed" ? now : null }).eq("assignment_id", id).eq("family_id", assignment.data.family_id);
    await writeAuditEvent(createAdminClient(), { familyId: assignment.data.family_id, actorId: parent.id, actorType: "parent", action: `assignment.${parsed.data.status}`, entityType: "assignment", entityId: id });
    return NextResponse.json({ assignment: result.data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that assignment." }, { status: 500 });
  }
}
