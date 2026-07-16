import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export async function ensureAgentConversation(input: {
  familyId: string;
  requestedBy: string;
  conversationId?: string | null;
  studentId?: string | null;
  openingRequest: string;
}) {
  const admin = createAdminClient();
  if (input.conversationId) {
    const existing = await admin.from("agent_conversations").select("id,status").eq("id", input.conversationId).eq("family_id", input.familyId).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data || existing.data.status !== "active") throw new Error("AGENT_CONVERSATION_NOT_FOUND");
    if (input.studentId) {
      const focused = await admin.from("agent_conversations").update({ student_id: input.studentId }).eq("id", existing.data.id).eq("family_id", input.familyId);
      if (focused.error) throw focused.error;
    }
    return existing.data.id;
  }
  const created = await admin.from("agent_conversations").insert({
    family_id: input.familyId,
    created_by: input.requestedBy,
    student_id: input.studentId ?? null,
    title: conversationTitle(input.openingRequest),
  }).select("id").single();
  if (created.error) throw created.error;
  return created.data.id;
}

export async function appendAgentConversationMessage(input: {
  conversationId: string;
  familyId: string;
  role: "user" | "assistant";
  content: string;
  agentTurnId?: string | null;
  idempotencyKey?: string | null;
}) {
  const admin = createAdminClient();
  const inserted = await admin.from("agent_conversation_messages").insert({
    conversation_id: input.conversationId,
    family_id: input.familyId,
    agent_turn_id: input.agentTurnId ?? null,
    role: input.role,
    content: input.content.trim().slice(0, 12_000),
    idempotency_key: input.idempotencyKey ?? null,
  }).select("id").single();
  if (inserted.error?.code === "23505" && input.idempotencyKey) {
    const existing = await admin.from("agent_conversation_messages").select("id").eq("family_id", input.familyId).eq("idempotency_key", input.idempotencyKey).single();
    if (existing.error) throw existing.error;
    return existing.data.id;
  }
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

export async function appendTurnAssistantMessage(input: {
  conversationId: string | null;
  familyId: string;
  turnId: string;
  content: string;
}) {
  if (!input.conversationId || !input.content.trim()) return;
  await appendAgentConversationMessage({
    conversationId: input.conversationId,
    familyId: input.familyId,
    role: "assistant",
    content: input.content,
    agentTurnId: input.turnId,
    idempotencyKey: `turn:${input.turnId}:assistant`,
  });
}

function conversationTitle(request: string) {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (!normalized) return "Conversation with Klio";
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77).trimEnd()}…`;
}
