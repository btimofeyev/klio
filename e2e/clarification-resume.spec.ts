import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

test("an ambiguous handoff pauses, answers inline, resumes once, and does not duplicate", async ({ page }) => {
  const suffix = crypto.randomUUID(); const email = `clarification-${suffix}@example.test`; const password = "KlioClarify123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Clarification Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Clarification Family");
    await page.getByLabel("Learner’s first name").fill("Avery");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByLabel("Science course or curriculum").fill("Earth Science");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Clarification user not found");
    const family = await admin.from("families").select("id,agent_context_version").eq("created_by", userId).single();
    const student = await admin.from("students").select("id").eq("family_id", family.data!.id).single();
    const thread = await admin.from("agent_threads").insert({ family_id: family.data!.id, provider: "codex_app_server", status: "awaiting_parent" }).select("id").single();
    if (thread.error) throw thread.error;
    const turn = await admin.from("agent_turns").insert({ thread_id: thread.data.id, family_id: family.data!.id, requested_by: userId, trigger: "parent_message", goal: "general", status: "awaiting_parent", outcome: "question", idempotency_key: `ambiguous:${suffix}`, initial_snapshot_version: family.data!.agent_context_version, current_snapshot_version: family.data!.agent_context_version, snapshot_hash: "c".repeat(64), student_id: student.data!.id, task_name: "Create a science reminder", normalized_step: "waiting_detail", expected_output: "One scheduled reminder", last_progress_at: new Date().toISOString(), snapshot_summary: { student_id: student.data!.id, request: "Remind me about the Earth Science lab, but ask which morning first." } }).select("id").single();
    if (turn.error) throw turn.error;
    const question = "Which morning should I schedule the Earth Science lab reminder?";
    const questionThread = await admin.from("question_threads").insert({ family_id: family.data!.id, student_id: student.data!.id, title: "Choose a reminder time", created_by: userId, agent_thread_id: thread.data.id, awaiting_turn_id: turn.data.id }).select("id").single();
    if (questionThread.error) throw questionThread.error;
    await admin.from("question_messages").insert({ thread_id: questionThread.data.id, family_id: family.data!.id, role: "assistant", content: question, agent_turn_id: turn.data.id });
    await admin.from("agent_events").insert([{ family_id: family.data!.id, turn_id: turn.data.id, sequence: 1, kind: "turn.queued", payload: {} }, { family_id: family.data!.id, turn_id: turn.data.id, sequence: 2, kind: "clarification.requested", payload: { questionThreadId: questionThread.data.id } }]);

    await page.goto("/app");
    await expect(page.getByLabel(question)).toBeVisible();
    await page.getByLabel(question).fill("Tomorrow morning at 9.");
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.getByRole("dialog", { name: "Conversation with Klio" }).locator(".conversation-working")).toContainText("Thinking");
    await expect.poll(async () => (await admin.from("question_threads").select("resumed_by_turn_id").eq("id", questionThread.data.id).single()).data?.resumed_by_turn_id).not.toBeNull();
    const linked = await admin.from("question_threads").select("resumed_by_turn_id").eq("id", questionThread.data.id).single();
    const resumedTurnId = linked.data!.resumed_by_turn_id!;
    const fresh = await admin.from("families").select("agent_context_version").eq("id", family.data!.id).single();
    await admin.from("agent_turns").update({ status: "running", current_snapshot_version: fresh.data!.agent_context_version, initial_snapshot_version: fresh.data!.agent_context_version, started_at: new Date().toISOString() }).eq("id", resumedTurnId);
    const toolArgs = { title: "Earth Science lab", dueAt: "2026-07-15T13:00:00.000Z", studentId: student.data!.id, confidence: 1, rationale: "The parent selected tomorrow morning." };
    const first = await admin.rpc("apply_agent_workspace_tool", { p_turn_id: resumedTurnId, p_tool_name: "create_reminder", p_idempotency_key: `clarified-reminder:${suffix}`, p_arguments: toolArgs, p_arguments_redacted: { ...toolArgs, rationale: "[redacted]" } });
    if (first.error) throw first.error;
    const duplicate = await admin.rpc("apply_agent_workspace_tool", { p_turn_id: resumedTurnId, p_tool_name: "create_reminder", p_idempotency_key: `clarified-reminder:${suffix}`, p_arguments: toolArgs, p_arguments_redacted: { ...toolArgs, rationale: "[redacted]" } });
    expect(duplicate.data).toEqual(first.data);
    await admin.from("agent_turns").update({ status: "completed", outcome: "reminder", normalized_step: "finished", completed_at: new Date().toISOString(), public_result: { schemaVersion: 1, kind: "completed", message: "Earth Science lab reminder added for tomorrow morning.", understood: ["You chose tomorrow morning at 9."], used: ["Your inline clarification answer"], changed: ["Added one Earth Science lab reminder"], remaining: [], actions: [] } }).eq("id", resumedTurnId);

    await expect(page.getByText("Earth Science lab reminder added for tomorrow morning.")).toBeVisible({ timeout: 8_000 });
    await page.reload();
    expect((await admin.from("reminders").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id).eq("title", "Earth Science lab")).count).toBe(1);
    expect((await admin.from("question_messages").select("id", { count: "exact", head: true }).eq("thread_id", questionThread.data.id).eq("role", "user")).count).toBe(1);
  } finally {
    if (userId) { await admin.from("families").delete().eq("created_by", userId); await admin.auth.admin.deleteUser(userId); }
  }
});
