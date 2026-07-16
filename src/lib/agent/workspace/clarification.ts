import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueWorkspaceTurn, type WorkspaceGoal } from "./turns";
import { appendAgentConversationMessage } from "./conversations";

export async function answerWorkspaceClarification(input: {
  turnId: string;
  parentId: string;
  answer: string;
  requestId: string;
}) {
  const admin = createAdminClient();
  const turn = await admin.from("agent_turns").select("id,thread_id,family_id,requested_by,status,goal,student_id,subject,task_name,snapshot_summary,conversation_id,interaction_mode")
    .eq("id", input.turnId).maybeSingle();
  if (turn.error) throw turn.error;
  if (!turn.data) throw new Error("CLARIFICATION_NOT_FOUND");
  await requireEditor(turn.data.family_id, input.parentId);
  const question = await admin.from("question_threads").select("id,status,resumed_by_turn_id")
    .eq("family_id", turn.data.family_id).eq("awaiting_turn_id", turn.data.id).maybeSingle();
  if (question.error) throw question.error;
  if (!question.data) throw new Error("CLARIFICATION_NOT_FOUND");
  if (question.data.status === "cancelled") throw new Error("CLARIFICATION_CANCELLED");
  if (question.data.resumed_by_turn_id) return { resumedTurnId: question.data.resumed_by_turn_id, duplicate: true };
  const prompt = await admin.from("question_messages").select("id,content").eq("family_id", turn.data.family_id).eq("thread_id", question.data.id).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).single();
  if (prompt.error) throw prompt.error;
  const messageKey = `clarification-answer:${input.requestId}`;
  let answerMessage = await admin.from("question_messages").insert({
    thread_id: question.data.id, family_id: turn.data.family_id, role: "user", content: input.answer,
    created_by: input.parentId, reply_to_message_id: prompt.data.id, idempotency_key: messageKey,
  }).select("id,content").single();
  if (answerMessage.error?.code === "23505") {
    answerMessage = await admin.from("question_messages").select("id,content").eq("family_id", turn.data.family_id).eq("thread_id", question.data.id).eq("role", "user").eq("reply_to_message_id", prompt.data.id).single();
  }
  if (answerMessage.error) throw answerMessage.error;
  if (turn.data.conversation_id) {
    await appendAgentConversationMessage({
      conversationId: turn.data.conversation_id,
      familyId: turn.data.family_id,
      role: "user",
      content: input.answer,
      idempotencyKey: `clarification:${input.requestId}:user`,
    });
  }
  const answeredAt = new Date().toISOString();
  const answered = await admin.from("question_threads").update({ status: "answered", answered_by: input.parentId, answered_at: answeredAt })
    .eq("id", question.data.id).eq("family_id", turn.data.family_id).in("status", ["open", "answered"]);
  if (answered.error) throw answered.error;
  await admin.from("agent_turns").update({ status: "completed", completed_at: answeredAt, normalized_step: "finished", last_progress_at: answeredAt }).eq("id", turn.data.id).eq("family_id", turn.data.family_id).eq("status", "awaiting_parent");
  await admin.from("agent_threads").update({ status: "active" }).eq("id", turn.data.thread_id).eq("family_id", turn.data.family_id);
  const summary = turn.data.snapshot_summary as { request?: string | null; evidence_ids?: string[] } | null;
  const resumed = await enqueueWorkspaceTurn({
    familyId: turn.data.family_id,
    requestedBy: input.parentId,
    evidenceIds: summary?.evidence_ids ?? [],
    studentId: turn.data.student_id,
    trigger: "clarification_answer",
    goal: turn.data.goal as WorkspaceGoal,
    idempotencyKey: `clarification-resume:${question.data.id}:${answerMessage.data.id}`,
    request: `Resume the earlier parent request using this one clarification. Original request: ${summary?.request ?? "Not recorded"}\nQuestion: ${prompt.data.content}\nParent answer: ${answerMessage.data.content}`,
    taskName: turn.data.task_name,
    subject: turn.data.subject,
    conversationId: turn.data.conversation_id,
    interactionMode: turn.data.interaction_mode as "answer" | "act",
  });
  const linked = await admin.from("question_threads").update({ resumed_by_turn_id: resumed.turn.id }).eq("id", question.data.id).eq("family_id", turn.data.family_id);
  if (linked.error) throw linked.error;
  await admin.from("agent_events").insert([
    { family_id: turn.data.family_id, turn_id: turn.data.id, sequence: await nextSequence(turn.data.id), kind: "clarification.answered", payload: { questionThreadId: question.data.id } },
    { family_id: turn.data.family_id, turn_id: resumed.turn.id, sequence: 2, kind: "turn.resumed", payload: { questionThreadId: question.data.id, priorTurnId: turn.data.id } },
  ]);
  return { resumedTurnId: resumed.turn.id, duplicate: resumed.duplicate, questionThreadId: question.data.id };
}

export async function cancelWorkspaceClarification(input: { turnId: string; parentId: string }) {
  const admin = createAdminClient();
  const turn = await admin.from("agent_turns").select("id,thread_id,family_id,status").eq("id", input.turnId).maybeSingle();
  if (turn.error) throw turn.error;
  if (!turn.data) throw new Error("CLARIFICATION_NOT_FOUND");
  await requireEditor(turn.data.family_id, input.parentId);
  if (turn.data.status !== "awaiting_parent") throw new Error("CLARIFICATION_NOT_WAITING");
  const now = new Date().toISOString();
  const question = await admin.from("question_threads").update({ status: "cancelled", cancelled_by: input.parentId, cancelled_at: now })
    .eq("family_id", turn.data.family_id).eq("awaiting_turn_id", turn.data.id).eq("status", "open").select("id").maybeSingle();
  if (question.error) throw question.error;
  if (!question.data) throw new Error("CLARIFICATION_NOT_WAITING");
  const cancelled = await admin.from("agent_turns").update({ status: "cancelled", completed_at: now, normalized_step: "paused", cancel_requested_at: now })
    .eq("id", turn.data.id).eq("family_id", turn.data.family_id).eq("status", "awaiting_parent");
  if (cancelled.error) throw cancelled.error;
  await admin.from("agent_threads").update({ status: "active" }).eq("id", turn.data.thread_id).eq("family_id", turn.data.family_id);
  await admin.from("agent_events").insert({ family_id: turn.data.family_id, turn_id: turn.data.id, sequence: await nextSequence(turn.data.id), kind: "clarification.cancelled", payload: { questionThreadId: question.data.id } });
  return { status: "cancelled" as const };
}

async function requireEditor(familyId: string, parentId: string) {
  const admin = createAdminClient();
  const membership = await admin.from("family_members").select("family_id").eq("family_id", familyId).eq("user_id", parentId).in("role", ["owner", "editor"]).maybeSingle();
  if (membership.error) throw membership.error;
  if (!membership.data) throw new Error("CLARIFICATION_FORBIDDEN");
}

async function nextSequence(turnId: string) {
  const admin = createAdminClient();
  const result = await admin.from("agent_events").select("sequence").eq("turn_id", turnId).order("sequence", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  return (result.data?.sequence ?? 0) + 1;
}
