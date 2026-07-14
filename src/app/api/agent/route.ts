import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { enqueueAgentJob, safelyProcessAgentJob } from "@/lib/agent/jobs";
import type { AgentIntent } from "@/lib/agent/run-agent";
import { enqueueWorkspaceTurn, type WorkspaceGoal } from "@/lib/agent/workspace/turns";
import { processWorkspaceTurn } from "@/lib/agent/workspace/runtime";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  familyId: z.uuid(), studentId: z.uuid().nullable().optional(), evidenceIds: z.array(z.uuid()).max(20).default([]),
  intent: z.enum(["general", "organize", "understand", "update_records", "next_step", "weekly_plan", "lesson", "summary", "practice", "portfolio"]),
  request: z.string().trim().min(3).max(4000), requestId: z.uuid(),
});

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const rate = checkRateLimit(`agent:${parent.id}`, 10, 5 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Klio is already handling several requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Tell Klio what you would like it to take care of." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });
    if (serverEnv.klioAgentRuntime === "codex_app_server") {
      const goal = intentGoal(parsed.data.intent);
      const idempotencyKey = `workspace:${parsed.data.requestId}`;
      const workspace = await enqueueWorkspaceTurn({ familyId: parsed.data.familyId, requestedBy: parent.id, evidenceIds: parsed.data.evidenceIds, studentId: parsed.data.studentId, trigger: "parent_message", goal, idempotencyKey, request: parsed.data.request });
      if (serverEnv.klioAgentInline && !workspace.duplicate) after(() => processWorkspaceTurn(workspace.turn.id));
      return NextResponse.json({ turn: workspace.turn }, { status: 202 });
    }
    if (!parsed.data.studentId || !parsed.data.evidenceIds.length) return NextResponse.json({ error: "This workspace request requires the Codex agent runtime." }, { status: 503 });
    const job = await enqueueAgentJob({
      familyId: parsed.data.familyId,
      parentId: parent.id,
      studentId: parsed.data.studentId,
      evidenceIds: parsed.data.evidenceIds,
      intents: [parsed.data.intent as AgentIntent],
    });
    after(() => safelyProcessAgentJob(job.id));
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (message === "OPENAI_KEY_REQUIRED") return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart Klio to use the agent." }, { status: 503 });
    if (message === "OPENAI_KEY_INVALID") return NextResponse.json({ error: "OpenAI rejected the configured API key. Replace OPENAI_API_KEY with a valid Platform key and restart Klio." }, { status: 503 });
    return NextResponse.json({ error: "The Klio agent could not complete this request. Your original capture is safe." }, { status: 500 });
  }
}

function intentGoal(intent: z.infer<typeof schema>["intent"]): WorkspaceGoal {
  if (intent === "weekly_plan") return "weekly_plan";
  if (intent === "lesson") return "lesson";
  if (intent === "practice") return "practice";
  if (intent === "portfolio") return "portfolio";
  if (intent === "summary" || intent === "next_step") return "dashboard";
  if (intent === "update_records" || intent === "understand") return "records";
  if (intent === "organize") return "capture";
  return "general";
}
