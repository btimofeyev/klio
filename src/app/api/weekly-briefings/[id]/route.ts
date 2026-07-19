import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ action: z.enum(["view", "dismiss"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose view or dismiss." }, { status: 400 });
    const { id } = await context.params;
    const supabase = await createClient();
    const existing = await supabase.from("weekly_briefings").select("id,family_id,status,viewed_at").eq("id", id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: "Weekly briefing not found." }, { status: 404 });
    const now = new Date().toISOString();
    const values = parsed.data.action === "view"
      ? { viewed_at: existing.data.viewed_at ?? now }
      : { status: "dismissed", dismissed_at: now, dismissed_by: parent.id, viewed_at: existing.data.viewed_at ?? now };
    const updated = await supabase.from("weekly_briefings").update(values)
      .eq("id", existing.data.id)
      .eq("family_id", existing.data.family_id)
      .select("id,status,viewed_at,dismissed_at")
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return NextResponse.json({ error: "Weekly briefing not found." }, { status: 404 });
    revalidatePath("/app", "layout");
    return NextResponse.json({ briefing: { id: updated.data.id, status: updated.data.status, viewedAt: updated.data.viewed_at, dismissedAt: updated.data.dismissed_at } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that briefing." }, { status: 500 });
  }
}
