import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const schema = z.object({
  familyId: z.uuid(), name: z.string().trim().min(1).max(120), startsOn: z.iso.date(), endsOn: z.iso.date(),
  instructionalWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine((days) => new Set(days).size === days.length),
  targetInstructionalDays: z.number().int().min(1).max(366).nullable().optional(),
  status: z.enum(["planned", "active"]).default("active"), notes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((value) => value.endsOn >= value.startsOn, { path: ["endsOn"], message: "Term end must follow its start." });

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the term dates and learning days." }, { status: 400 });
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle();
    if (membership.error || !membership.data) return NextResponse.json({ error: "Family not found." }, { status: 404 });
    const term = await supabase.from("academic_terms").insert({
      family_id: parsed.data.familyId, created_by: parent.id, name: parsed.data.name, starts_on: parsed.data.startsOn,
      ends_on: parsed.data.endsOn, target_instructional_days: parsed.data.targetInstructionalDays ?? null,
      status: parsed.data.status, notes: parsed.data.notes ?? null,
    }).select("id,name,starts_on,ends_on,status").single();
    if (term.error) throw term.error;
    const weekdays = await supabase.from("academic_term_weekdays").insert(parsed.data.instructionalWeekdays.map((weekday) => ({ family_id: parsed.data.familyId, term_id: term.data.id, weekday })));
    if (weekdays.error) {
      await supabase.from("academic_terms").delete().eq("id", term.data.id).eq("family_id", parsed.data.familyId);
      throw weekdays.error;
    }
    await writeAuditEvent(createAdminClient(), { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "academic_term.created", entityType: "academic_term", entityId: term.data.id, metadata: { starts_on: parsed.data.startsOn, ends_on: parsed.data.endsOn, weekday_count: parsed.data.instructionalWeekdays.length } });
    return NextResponse.json({ term: { ...term.data, instructionalWeekdays: parsed.data.instructionalWeekdays } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that academic term." }, { status: 500 });
  }
}
