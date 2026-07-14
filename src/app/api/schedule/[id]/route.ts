import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nextLearningDate } from "@/lib/schedule/dates";

const updateSchema = z.object({ action: z.enum(["complete", "reopen", "move_forward"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = updateSchema.safeParse(await request.json());
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Choose a valid schedule update." }, { status: 400 });

    const supabase = await createClient();
    const { data: item, error: itemError } = await supabase.from("weekly_plan_items").select("id, family_id, scheduled_date, rescheduled_count").eq("id", id).maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Schedule item not found." }, { status: 404 });

    const updates: { completed_at?: string | null; scheduled_date?: string; rescheduled_count?: number } = {};
    if (parsed.data.action === "complete") updates.completed_at = new Date().toISOString();
    if (parsed.data.action === "reopen") updates.completed_at = null;
    if (parsed.data.action === "move_forward") {
      const { data: family, error: familyError } = await supabase.from("families").select("timezone, available_days").eq("id", item.family_id).single();
      if (familyError) throw familyError;
      const availableDays = Array.isArray(family.available_days) ? family.available_days.filter((day): day is string => typeof day === "string") : [];
      updates.scheduled_date = nextLearningDate(item.scheduled_date, availableDays, family.timezone);
      updates.completed_at = null;
      updates.rescheduled_count = item.rescheduled_count + 1;
    }

    const { data, error } = await supabase.from("weekly_plan_items").update(updates).eq("id", id).select("id, scheduled_date, completed_at, rescheduled_count").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Schedule item not found." }, { status: 404 });

    await writeAuditEvent(createAdminClient(), {
      familyId: item.family_id,
      actorId: parent.id,
      actorType: "parent",
      action: `schedule_item.${parsed.data.action}`,
      entityType: "weekly_plan_item",
      entityId: id,
      metadata: { scheduled_date: data.scheduled_date, rescheduled_count: data.rescheduled_count },
    });

    return NextResponse.json({ id: data.id, scheduledDate: data.scheduled_date, completedAt: data.completed_at, rescheduledCount: data.rescheduled_count });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that schedule item." }, { status: 500 });
  }
}
