import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ action: z.literal("dismiss") }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose dismiss." }, { status: 400 });
    const { id } = await context.params;
    const supabase = await createClient();
    const existing = await supabase.from("klio_insights").select("id,family_id,kind,title,status").eq("id", id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: "Klio note not found." }, { status: 404 });
    const dismissed = await supabase.from("klio_insights").update({ status: "dismissed", dismissed_by: parent.id, dismissed_at: new Date().toISOString() })
      .eq("family_id", existing.data.family_id)
      .eq("kind", existing.data.kind)
      .eq("title", existing.data.title)
      .eq("status", "active")
      .select("id");
    if (dismissed.error) throw dismissed.error;
    if (!dismissed.data.length) return NextResponse.json({ status: "dismissed", alreadyResolved: true, dismissedCount: 0 });
    revalidatePath("/app", "layout");
    return NextResponse.json({ status: "dismissed", dismissedCount: dismissed.data.length });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not dismiss that note." }, { status: 500 });
  }
}
