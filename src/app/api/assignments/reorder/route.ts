import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { enqueueProactiveEvaluation } from "@/lib/proactive/evaluate";
import { dayOrderTimeUpdates } from "@/lib/schedule/day-order";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";

const schema = z.object({
  familyId: postgresUuidSchema,
  scheduledDate: z.iso.date(),
  scopeStudentId: postgresUuidSchema.nullable(),
  movedId: postgresUuidSchema,
  orderedIds: z.array(postgresUuidSchema).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "Lesson ids must be unique."),
}).strict();

export async function PATCH(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Klio could not read that lesson order." }, { status: 400 });
    const input = parsed.data;
    if (!input.orderedIds.includes(input.movedId)) return NextResponse.json({ error: "The moved lesson is not part of this day." }, { status: 400 });
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", input.familyId).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) return NextResponse.json({ error: "That family schedule is not available." }, { status: 403 });

    let dayQuery = supabase.from("assignments").select("id,student_id,scheduled_time").eq("family_id", input.familyId).eq("scheduled_date", input.scheduledDate).neq("status", "skipped");
    if (input.scopeStudentId) dayQuery = dayQuery.eq("student_id", input.scopeStudentId);
    const day = await dayQuery;
    if (day.error) throw day.error;
    const rows = day.data ?? [];
    if (rows.length !== input.orderedIds.length || rows.some((item) => !input.orderedIds.includes(item.id))) {
      return NextResponse.json({ error: "The day changed before this order was saved. Refresh and try again." }, { status: 409 });
    }

    const updates = dayOrderTimeUpdates(rows.map((item) => ({ id: item.id, scheduledTime: item.scheduled_time })), input.orderedIds);
    const placements = await supabase.from("weekly_plan_items").select("id,assignment_id,scheduled_time,position")
      .eq("family_id", input.familyId).in("assignment_id", input.orderedIds);
    if (placements.error) throw placements.error;
    const before = Object.fromEntries(rows.map((item) => [item.id, item.scheduled_time]));
    try {
      for (const update of updates) {
        const assignment = await supabase.from("assignments").update({ scheduled_time: update.scheduledTime }).eq("id", update.id).eq("family_id", input.familyId).eq("scheduled_date", input.scheduledDate).select("id").single();
        if (assignment.error) throw assignment.error;
        const placement = await supabase.from("weekly_plan_items").update({ scheduled_time: update.scheduledTime, position: update.position }).eq("assignment_id", update.id).eq("family_id", input.familyId);
        if (placement.error) throw placement.error;
      }
    } catch (error) {
      await Promise.all([
        ...rows.map((item) => supabase.from("assignments").update({ scheduled_time: item.scheduled_time }).eq("id", item.id).eq("family_id", input.familyId)),
        ...(placements.data ?? []).map((item) => supabase.from("weekly_plan_items").update({ scheduled_time: item.scheduled_time, position: item.position }).eq("id", item.id).eq("family_id", input.familyId)),
      ]);
      throw error;
    }

    const orderHash = createHash("sha256").update(`${input.familyId}:${input.scheduledDate}:${input.scopeStudentId ?? "all"}:${input.orderedIds.join(":")}`).digest("hex").slice(0, 24);
    await writeAuditEvent(createAdminClient(), {
      familyId: input.familyId,
      actorId: parent.id,
      actorType: "parent",
      action: "assignments.reordered",
      entityType: "assignment",
      entityId: input.movedId,
      metadata: { scheduled_date: input.scheduledDate, scope_student_id: input.scopeStudentId, before, ordered_ids: input.orderedIds },
    });
    const moved = rows.find((item) => item.id === input.movedId);
    await enqueueProactiveEvaluation({
      familyId: input.familyId,
      studentId: input.scopeStudentId ?? moved?.student_id ?? null,
      requestedBy: parent.id,
      eventKind: "schedule_adjusted",
      entityType: "assignment",
      entityId: input.movedId,
      idempotencyKey: `parent-day-order:${orderHash}`,
    });
    return NextResponse.json({ assignments: updates.map((item) => ({ id: item.id, scheduledTime: item.scheduledTime })) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that lesson order." }, { status: 500 });
  }
}
