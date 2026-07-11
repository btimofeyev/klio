import { NextResponse } from "next/server";
import { z } from "zod";
import { askKlio } from "@/lib/agent/ask-klio";
import { requireParentApi } from "@/lib/auth/require-parent";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  familyId: z.uuid(),
  studentId: z.uuid().nullable().optional(),
  threadId: z.uuid().nullable().optional(),
  question: z.string().trim().min(2).max(2000),
});

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const rate = checkRateLimit(`ask:${parent.id}`, 20, 5 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Klio is handling several questions. Try again shortly." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Ask Klio a question about your saved records." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id")
      .eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });
    if (parsed.data.studentId) {
      const { data: student } = await supabase.from("students").select("id").eq("id", parsed.data.studentId).eq("family_id", parsed.data.familyId).maybeSingle();
      if (!student) return NextResponse.json({ error: "That learner is not in this workspace." }, { status: 400 });
    }
    return NextResponse.json(await askKlio({ ...parsed.data, parentId: parent.id }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (message === "OPENAI_KEY_REQUIRED") return NextResponse.json({ error: "OpenAI is not configured." }, { status: 503 });
    return NextResponse.json({ error: "Klio could not answer that question right now. Your records are safe." }, { status: 500 });
  }
}
