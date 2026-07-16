import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { moveUnfinishedWork } from "@/lib/proactive/adjustments";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";

const schema = z.object({
  familyId: postgresUuidSchema,
  studentId: postgresUuidSchema,
  assignmentId: postgresUuidSchema.optional(),
  assignmentIds: z.array(postgresUuidSchema).min(1).max(20).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.assignmentId) === Boolean(value.assignmentIds)) context.addIssue({ code: "custom", message: "Choose one assignment or a group." });
});

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose unfinished work to adjust." }, { status: 400 });
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (membership.error || !membership.data) return NextResponse.json({ error: "Family workspace not found." }, { status: 403 });
    const assignmentIds = [...new Set(parsed.data.assignmentIds ?? [parsed.data.assignmentId!])];
    const key = parsed.data.idempotencyKey ?? `unfinished:${assignmentIds.sort().join(":")}`;
    const result = await moveUnfinishedWork({ familyId: parsed.data.familyId, studentId: parsed.data.studentId, assignmentIds, actorId: parent.id, idempotencyKey: key });
    revalidatePath("/app", "layout");
    return NextResponse.json({
      proposal: result.proposal,
      insight: result.insight ? {
        id: result.insight.id, studentId: result.insight.student_id, kind: result.insight.kind,
        title: result.insight.title, summary: result.insight.summary, reason: result.insight.reason,
        priority: result.insight.priority, evidenceRefs: result.insight.evidence_refs,
        actionRef: result.insight.action_ref, createdAt: result.insight.created_at,
      } : null,
      applied: result.applied, duplicate: result.duplicate,
    }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (error instanceof Error && error.message === "NO_CAPACITY_FOR_UNFINISHED_WORK") return NextResponse.json({ error: "Klio could not fit all unfinished work into the next two learning weeks without exceeding capacity." }, { status: 409 });
    return NextResponse.json({ error: "Klio could not adjust that unfinished work." }, { status: 500 });
  }
}
