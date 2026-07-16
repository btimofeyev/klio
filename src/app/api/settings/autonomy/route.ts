import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { autonomyActions } from "@/lib/autonomy/policy";

const levels = z.enum(["automatic", "automatic_with_undo", "confirm", "ask", "never"]);
const policies = z.object(Object.fromEntries(autonomyActions.map((action) => [action, levels.optional()]))).strict();
const schema = z.object({ familyId: z.uuid(), preset: z.enum(["helpful", "proactive", "ask_first", "custom"]), policies }).strict();

export async function PUT(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the autonomy settings." }, { status: 400 });
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (membership.error || !membership.data) return NextResponse.json({ error: "Family workspace not found." }, { status: 403 });
    const saved = await supabase.from("family_autonomy_policies").upsert({ family_id: parsed.data.familyId, preset: parsed.data.preset, policies: parsed.data.policies, updated_by: parent.id }, { onConflict: "family_id" }).select("preset,policies").single();
    if (saved.error) throw saved.error;
    return NextResponse.json(saved.data);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save those settings." }, { status: 500 });
  }
}
