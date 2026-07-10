import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { runKlioAgent } from "@/lib/agent/run-agent";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  familyId: z.uuid(), studentId: z.uuid(), evidenceIds: z.array(z.uuid()).min(1).max(20),
  intent: z.enum(["understand", "update_records", "next_step", "weekly_plan", "lesson", "summary", "practice", "portfolio"]),
});

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const rate = checkRateLimit(`agent:${parent.id}`, 10, 5 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Klio is already handling several requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose evidence and an action for Klio." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });
    const result = await runKlioAgent({ ...parsed.data, parentId: parent.id });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (message === "OPENAI_KEY_REQUIRED") return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart Klio to use the agent." }, { status: 503 });
    if (message === "OPENAI_KEY_INVALID") return NextResponse.json({ error: "OpenAI rejected the configured API key. Replace OPENAI_API_KEY with a valid Platform key and restart Klio." }, { status: 503 });
    return NextResponse.json({ error: "The Klio agent could not complete this request. Your original capture is safe." }, { status: 500 });
  }
}
