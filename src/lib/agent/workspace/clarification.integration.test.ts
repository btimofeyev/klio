import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { answerWorkspaceClarification, cancelWorkspaceClarification } from "./clarification";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(url, secretKey, { auth: { persistSession: false } });
let userId = "";
let familyId = "";
let studentId = "";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `clarification-${crypto.randomUUID()}@example.test`, password: "KlioClarification123", email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Clarification family", created_by: userId }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const member = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  if (member.error) throw member.error;
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "Learner" }).select("id").single();
  if (student.error) throw student.error;
  studentId = student.data.id;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function waitingQuestion(label: string) {
  const currentThreads = await admin.from("agent_threads").select("id").eq("family_id", familyId).in("status", ["active", "awaiting_parent", "replacing"]);
  if (currentThreads.error) throw currentThreads.error;
  if (currentThreads.data.length) await admin.from("agent_threads").update({ status: "archived" }).in("id", currentThreads.data.map((item) => item.id));
  const thread = await admin.from("agent_threads").insert({ family_id: familyId, provider: "codex_app_server", status: "awaiting_parent" }).select("id").single();
  if (thread.error) throw thread.error;
  const version = await admin.from("families").select("agent_context_version").eq("id", familyId).single();
  if (version.error) throw version.error;
  const turn = await admin.from("agent_turns").insert({
    thread_id: thread.data.id, family_id: familyId, requested_by: userId, trigger: "parent_message", goal: "weekly_plan",
    status: "awaiting_parent", idempotency_key: `waiting:${label}:${crypto.randomUUID()}`,
    initial_snapshot_version: version.data.agent_context_version, current_snapshot_version: version.data.agent_context_version,
    snapshot_hash: "a".repeat(64), student_id: studentId, snapshot_summary: { request: "Move science to later this week." },
  }).select("id").single();
  if (turn.error) throw turn.error;
  const question = await admin.from("question_threads").insert({ family_id: familyId, student_id: studentId, title: "Which day?", created_by: userId, agent_thread_id: thread.data.id, awaiting_turn_id: turn.data.id }).select("id").single();
  if (question.error) throw question.error;
  const message = await admin.from("question_messages").insert({ thread_id: question.data.id, family_id: familyId, role: "assistant", content: "Which day should science move to?", agent_turn_id: turn.data.id }).select("id").single();
  if (message.error) throw message.error;
  return { turnId: turn.data.id, questionId: question.data.id };
}

describe("workspace clarification continuation", () => {
  it("persists one answer and resumes the same persistent thread with a fresh snapshot", async () => {
    const waiting = await waitingQuestion("answer");
    const first = await answerWorkspaceClarification({ turnId: waiting.turnId, parentId: userId, answer: "Move it to Thursday.", requestId: crypto.randomUUID() });
    const duplicate = await answerWorkspaceClarification({ turnId: waiting.turnId, parentId: userId, answer: "A duplicate answer", requestId: crypto.randomUUID() });
    expect(duplicate).toMatchObject({ resumedTurnId: first.resumedTurnId, duplicate: true });
    const [messages, resumed, question] = await Promise.all([
      admin.from("question_messages").select("id,content").eq("thread_id", waiting.questionId).eq("role", "user"),
      admin.from("agent_turns").select("id,trigger,status,snapshot_summary,thread_id").eq("id", first.resumedTurnId).single(),
      admin.from("question_threads").select("status,resumed_by_turn_id").eq("id", waiting.questionId).single(),
    ]);
    expect(messages.data).toHaveLength(1);
    expect(messages.data?.[0]?.content).toBe("Move it to Thursday.");
    expect(resumed.data).toMatchObject({ trigger: "clarification_answer", status: "queued" });
    expect(question.data).toMatchObject({ status: "answered", resumed_by_turn_id: first.resumedTurnId });
    await admin.from("agent_turns").update({ status: "cancelled" }).eq("id", first.resumedTurnId);
    await admin.from("agent_threads").update({ status: "archived" }).eq("id", resumed.data!.thread_id);
  });

  it("cancels a waiting question without creating a resume turn", async () => {
    const waiting = await waitingQuestion("cancel");
    expect(await cancelWorkspaceClarification({ turnId: waiting.turnId, parentId: userId })).toEqual({ status: "cancelled" });
    const [turn, question] = await Promise.all([
      admin.from("agent_turns").select("status").eq("id", waiting.turnId).single(),
      admin.from("question_threads").select("status,resumed_by_turn_id").eq("id", waiting.questionId).single(),
    ]);
    expect(turn.data?.status).toBe("cancelled");
    expect(question.data).toMatchObject({ status: "cancelled", resumed_by_turn_id: null });
  });
});
