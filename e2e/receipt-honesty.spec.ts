import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("a stale worker heartbeat stops the working claim and keeps the source safe", async ({ page }) => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const email = `paused-receipt-${crypto.randomUUID()}@example.test`;
  const password = "KlioPaused123";
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  let familyId = "";
  try {
    const family = await admin.from("families").insert({ name: "Paused Receipt Family", created_by: user.data.user.id }).select("id").single();
    if (family.error) throw family.error;
    familyId = family.data.id;
    const membership = await admin.from("family_members").insert({ family_id: familyId, user_id: user.data.user.id, role: "owner" });
    if (membership.error) throw membership.error;
    const learner = await admin.from("students").insert({ family_id: familyId, display_name: "Maya" }).select("id").single();
    if (learner.error) throw learner.error;
    const thread = await admin.from("agent_threads").insert({ family_id: familyId, provider: "codex_app_server" }).select("id").single();
    if (thread.error) throw thread.error;
    const staleAt = new Date(Date.now() - 60_000).toISOString();
    const turn = await admin.from("agent_turns").insert({
      thread_id: thread.data.id,
      family_id: familyId,
      requested_by: user.data.user.id,
      trigger: "parent_message",
      goal: "general",
      status: "running",
      idempotency_key: `paused:${crypto.randomUUID()}`,
      initial_snapshot_version: 0,
      current_snapshot_version: 0,
      snapshot_hash: "a".repeat(64),
      attempt_count: 1,
      started_at: staleAt,
      last_heartbeat_at: staleAt,
      last_progress_at: staleAt,
      normalized_step: "checking",
      task_name: "Reviewing Maya’s worksheet",
      subject: "Math",
      source_count: 1,
      expected_output: "Grounded feedback ready for review",
      snapshot_summary: { request: "How should I teach this worksheet?" },
    }).select("id").single();
    if (turn.error) throw turn.error;

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const conversation = page.getByRole("dialog", { name: "Conversation with Klio" });
    await expect(conversation).toBeVisible();
    await expect(conversation.getByText("Reviewing Maya’s worksheet", { exact: true })).toBeVisible();
    await expect(conversation.getByText("How should I teach this worksheet?", { exact: true })).toBeVisible();
    await expect(conversation.getByText("This stopped before finishing. Your original request is safe.", { exact: true })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "Close conversation" })).toBeVisible();
    const conductorLink = conversation.locator(".klio-conductor-status");
    await expect(conductorLink).toContainText("Open Conductor");
    await expect(conductorLink).toContainText("Reviewing Maya’s worksheet");
    await expect(conversation.locator(".conversation-working")).toHaveCount(0);

    const visualState = await page.evaluate(() => {
      const parentMessage = document.querySelector<HTMLElement>(".conversation-parent > p");
      const backdrop = document.querySelector<HTMLElement>(".klio-conversation-backdrop");
      return {
        fontSize: parentMessage ? Number.parseFloat(getComputedStyle(parentMessage).fontSize) : 0,
        lineHeight: parentMessage ? Number.parseFloat(getComputedStyle(parentMessage).lineHeight) : 0,
        backdropFilter: backdrop ? getComputedStyle(backdrop).backdropFilter : "",
        conversationBackground: getComputedStyle(document.querySelector<HTMLElement>(".klio-conversation")!).backgroundColor,
        conversationWidth: document.querySelector<HTMLElement>(".klio-conversation")?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(visualState.fontSize).toBeGreaterThanOrEqual(15);
    expect(visualState.lineHeight).toBeGreaterThanOrEqual(23);
    expect(visualState.backdropFilter).toContain("blur");
    expect(visualState.conversationBackground).toBe("rgba(0, 0, 0, 0)");
    expect(visualState.conversationWidth).toBe(page.viewportSize()!.width);

    await conductorLink.click();
    await expect(page).toHaveURL(new RegExp(`/app/activity\\?turn=${turn.data.id}#conductor`));
    await expect(page.getByRole("heading", { name: "Conductor", exact: true })).toBeVisible();
    await expect(page.locator(".conductor-inbox > a.selected")).toContainText("Reviewing Maya’s worksheet");
  } finally {
    if (familyId) await admin.from("families").delete().eq("id", familyId);
    await admin.auth.admin.deleteUser(user.data.user.id);
  }
});
