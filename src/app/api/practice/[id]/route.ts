import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const dismissSchema = z.object({
  action: z.literal("dismiss"),
  reason: z.enum(["learned_in_curriculum", "already_understands", "not_right_fit"]),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = dismissSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose why this practice is no longer needed." }, { status: 400 });

    const { id } = await context.params;
    const supabase = await createClient();
    const existing = await supabase.from("practice_sessions")
      .select("id,family_id,student_id,artifact_id,status,dismissal_reason")
      .eq("id", id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: "Practice not found." }, { status: 404 });
    if (existing.data.status === "dismissed") {
      return NextResponse.json({ status: "dismissed", reason: existing.data.dismissal_reason, duplicate: true });
    }
    if (!["ready", "in_progress"].includes(existing.data.status)) {
      return NextResponse.json({ error: "Only active practice can be marked no longer needed." }, { status: 409 });
    }

    const dismissed = await supabase.from("practice_sessions").update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      dismissed_by: parent.id,
      dismissal_reason: parsed.data.reason,
    })
      .eq("id", id)
      .eq("family_id", existing.data.family_id)
      .in("status", ["ready", "in_progress"])
      .select("id,status,dismissal_reason")
      .maybeSingle();
    if (dismissed.error) throw dismissed.error;
    if (!dismissed.data) return NextResponse.json({ error: "This practice changed before it could be removed." }, { status: 409 });

    revalidatePath("/app", "layout");
    return NextResponse.json({ status: dismissed.data.status, reason: dismissed.data.dismissal_reason });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not remove this practice. It is still available." }, { status: 500 });
  }
}
