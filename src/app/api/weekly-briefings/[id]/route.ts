import { after, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { enqueueWorkspaceTurn } from "@/lib/agent/workspace/turns";
import { processWorkspaceTurn } from "@/lib/agent/workspace/runtime";
import { serverEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["view", "dismiss"]) }).strict(),
  z.object({
    action: z.literal("handle"),
    request: z.string().trim().min(1).max(4000),
    studentId: postgresUuidSchema.nullable(),
  }).strict(),
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid briefing action." }, { status: 400 });
    const { id } = await context.params;
    const supabase = await createClient();
    const existing = await supabase.from("weekly_briefings").select("id,family_id,status,week_start,viewed_at").eq("id", id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: "Weekly briefing not found." }, { status: 404 });
    if (parsed.data.action === "handle") {
      if (existing.data.status !== "active") return NextResponse.json({ error: "That briefing is no longer active." }, { status: 409 });
      if (serverEnv.klioAgentRuntime !== "codex_app_server") return NextResponse.json({ error: "The background Klio worker is not available." }, { status: 503 });
      const rate = checkRateLimit(`briefing-agent:${parent.id}`, 6, 5 * 60_000);
      if (!rate.allowed) return NextResponse.json({ error: "Klio is already handling several requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
      if (parsed.data.studentId) {
        const student = await supabase.from("students").select("id").eq("id", parsed.data.studentId).eq("family_id", existing.data.family_id).eq("active", true).maybeSingle();
        if (student.error) throw student.error;
        if (!student.data) return NextResponse.json({ error: "That learner is no longer in this workspace." }, { status: 404 });
      }
      const queued = await enqueueWorkspaceTurn({
        familyId: existing.data.family_id,
        requestedBy: parent.id,
        studentId: parsed.data.studentId,
        trigger: "parent_message",
        goal: "weekly_plan",
        idempotencyKey: `weekly-briefing-handoff:${existing.data.id}:${parsed.data.studentId ?? "family"}`,
        request: parsed.data.request,
        contextDate: existing.data.week_start,
        taskName: "Handling weekly briefing",
        expectedOutput: "A completed safe change, a durable reviewable proposal, or one precise question",
        interactionMode: "act",
      });
      if (serverEnv.klioAgentInline && !queued.duplicate) after(() => processWorkspaceTurn(queued.turn.id));
      return NextResponse.json({ turn: queued.turn, duplicate: queued.duplicate }, { status: queued.duplicate ? 200 : 202 });
    }
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
