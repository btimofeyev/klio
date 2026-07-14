import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { agentEventLabel } from "@/lib/agent/workspace/presentation";

const querySchema = z.object({ familyId: z.uuid() });

export async function GET(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: "A family is required." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });
    const { data, error } = await supabase.from("agent_turns").select("id, status, outcome, goal, source_evidence_id, snapshot_summary, public_result, error_code, created_at, completed_at, agent_events(sequence, kind, payload, created_at), agent_tool_calls(tool_name, status, result_summary, created_at)").eq("family_id", parsed.data.familyId).order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    return NextResponse.json({ turns: data.map((turn) => {
      const summary = turn.snapshot_summary as { request?: string | null } | null;
      return {
        id: turn.id, status: turn.status, outcome: turn.outcome, goal: turn.goal,
        request: summary?.request ?? fallbackRequest(turn.goal), sourceEvidenceId: turn.source_evidence_id,
        result: turn.public_result, errorCode: turn.error_code, createdAt: turn.created_at, completedAt: turn.completed_at,
        events: [...turn.agent_events].sort((a, b) => a.sequence - b.sequence).map((event) => ({
          sequence: event.sequence, kind: event.kind, label: agentEventLabel(event.kind, event.payload), createdAt: event.created_at,
        })),
        tools: turn.agent_tool_calls.map((tool) => ({ name: tool.tool_name, status: tool.status, result: tool.result_summary, createdAt: tool.created_at })),
      };
    }) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not load agent activity." }, { status: 500 });
  }
}

function fallbackRequest(goal: string) { return `Complete a ${goal.replaceAll("_", " ")} job.`; }
