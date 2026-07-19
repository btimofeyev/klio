import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { agentEventLabel } from "@/lib/agent/workspace/presentation";
import { normalizePublicResult } from "@/lib/agent/workspace/public-result";
import { parentFacingTurnStatus } from "@/lib/agent/workspace/turn-status";

const querySchema = z.object({ familyId: z.uuid(), conversationId: z.uuid().optional() });

export async function GET(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: "A family is required." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });
    let turnsQuery = supabase.from("agent_turns").select("id,status,outcome,goal,student_id,task_name,subject,source_count,normalized_step,expected_output,source_evidence_id,snapshot_summary,public_result,error_code,created_at,started_at,last_heartbeat_at,last_progress_at,completed_at,conversation_id,interaction_mode,streamed_message,agent_events(sequence,kind,payload,created_at),agent_tool_calls(tool_name,status,result_summary,created_at)").eq("family_id", parsed.data.familyId);
    if (parsed.data.conversationId) turnsQuery = turnsQuery.eq("conversation_id", parsed.data.conversationId);
    const { data, error } = await turnsQuery.order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    const questions = await supabase.from("question_threads").select("id,status,awaiting_turn_id,question_messages!question_messages_thread_id_fkey(id,role,content,created_at)").eq("family_id", parsed.data.familyId).limit(30);
    if (questions.error) throw questions.error;
    const recentConversations = await supabase
      .from("agent_conversations")
      .select("id,title,student_id,updated_at")
      .eq("family_id", parsed.data.familyId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(12);
    if (recentConversations.error) throw recentConversations.error;
    let conversationQuery = supabase.from("agent_conversations").select("id,title,status,student_id,updated_at").eq("family_id", parsed.data.familyId).eq("status", "active");
    if (parsed.data.conversationId) conversationQuery = conversationQuery.eq("id", parsed.data.conversationId);
    const conversation = await conversationQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (conversation.error) throw conversation.error;
    const messages = conversation.data
      ? await supabase.from("agent_conversation_messages").select("id,role,content,agent_turn_id,created_at").eq("family_id", parsed.data.familyId).eq("conversation_id", conversation.data.id).order("created_at", { ascending: false }).limit(80)
      : { data: [], error: null };
    if (messages.error) throw messages.error;
    return NextResponse.json({ conversations: recentConversations.data.map((item) => ({
      id: item.id,
      title: item.title,
      studentId: item.student_id,
      updatedAt: item.updated_at,
    })), conversation: conversation.data ? {
      id: conversation.data.id,
      title: conversation.data.title,
      studentId: conversation.data.student_id,
      messages: [...messages.data].reverse().map((message) => ({ id: message.id, role: message.role, content: message.content, turnId: message.agent_turn_id, createdAt: message.created_at })),
    } : null, turns: data.map((turn) => {
      const summary = turn.snapshot_summary as { request?: string | null } | null;
      const clarification = clarificationForTurn(questions.data, turn.id);
      return {
        id: turn.id, status: parentFacingTurnStatus(turn.status, Boolean(clarification)), outcome: turn.outcome, goal: turn.goal,
        request: summary?.request ?? fallbackRequest(turn.goal), sourceEvidenceId: turn.source_evidence_id,
        result: turn.public_result ? normalizePublicResult(turn.public_result) : null,
        clarification,
        errorCode: turn.error_code, createdAt: turn.created_at, completedAt: turn.completed_at,
        conversationId: turn.conversation_id, interactionMode: turn.interaction_mode, streamedMessage: turn.streamed_message,
        taskName: turn.task_name ?? "Handling a family handoff", studentId: turn.student_id, subject: turn.subject,
        sourceCount: turn.source_count, normalizedStep: turn.normalized_step, expectedOutput: turn.expected_output,
        startedAt: turn.started_at, lastHeartbeatAt: turn.last_heartbeat_at, lastProgressAt: turn.last_progress_at,
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

function clarificationForTurn(threads: Array<{ id: string; status: string; awaiting_turn_id: string | null; question_messages: Array<{ id: string; role: string; content: string; created_at: string }> }>, turnId: string) {
  const thread = threads.find((item) => item.awaiting_turn_id === turnId);
  if (!thread) return null;
  const message = [...thread.question_messages].filter((item) => item.role === "assistant").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return message ? { threadId: thread.id, messageId: message.id, question: message.content, status: thread.status } : null;
}

function fallbackRequest(goal: string) { return `Complete a ${goal.replaceAll("_", " ")} job.`; }
