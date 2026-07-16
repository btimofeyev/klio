import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const position = z.object({
  x: z.number().finite().min(0).max(3200),
  y: z.number().finite().min(0).max(2300),
}).strict();

const schema = z.object({
  familyId: z.uuid(),
  surface: z.enum(["day", "week"]),
  scopeKey: z.union([z.literal("all"), z.uuid()]),
  layoutVersion: z.literal(2),
  positions: z.partialRecord(z.enum(["schedule", "pace", "attention", "support", "review", "coverage", "progress", "records"]), position)
    .refine((value) => Object.keys(value).length <= 8, "Too many workspace objects."),
}).strict();

export async function PUT(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Klio could not save that desk arrangement." }, { status: 400 });
    const supabase = await createClient();
    const [membership, learner] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle(),
      parsed.data.scopeKey === "all"
        ? Promise.resolve({ data: { id: "all" }, error: null })
        : supabase.from("students").select("id").eq("id", parsed.data.scopeKey).eq("family_id", parsed.data.familyId).maybeSingle(),
    ]);
    if (membership.error) throw membership.error;
    if (learner.error) throw learner.error;
    if (!membership.data || !learner.data) return NextResponse.json({ error: "That family workspace is not available." }, { status: 403 });

    const result = await supabase.from("family_workspace_layouts").upsert({
      family_id: parsed.data.familyId,
      surface: parsed.data.surface,
      scope_key: parsed.data.scopeKey,
      layout_version: parsed.data.layoutVersion,
      positions: parsed.data.positions,
      updated_by: parent.id,
    }, { onConflict: "family_id,surface,scope_key" }).select("surface,scope_key,layout_version,updated_at").single();
    if (result.error) throw result.error;
    return NextResponse.json({ layout: result.data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that desk arrangement." }, { status: 500 });
  }
}
