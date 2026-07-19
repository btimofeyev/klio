import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("a stale worker heartbeat stops the working claim and keeps the source safe", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
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
    const toolCall = await admin.from("agent_tool_calls").insert({
      family_id: familyId,
      turn_id: turn.data.id,
      tool_name: "read_family_context",
      risk: "read",
      status: "requested",
      snapshot_version: 0,
      idempotency_key: `paused-read:${crypto.randomUUID()}`,
      arguments_redacted: { studentId: learner.data.id },
      started_at: staleAt,
    });
    if (toolCall.error) throw toolCall.error;

    await page.setViewportSize({ width: 1064, height: 1189 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const conversation = page.getByRole("dialog", { name: "Conversation with Klio" });
    await expect(conversation).toBeVisible();
    const homeComposer = page.locator(".spatial-assistant-surface");
    await expect(homeComposer).toBeHidden();
    await expect(conversation.getByLabel("Message Klio")).toBeVisible();
    await expect(conversation.getByLabel("Message Klio")).toHaveAttribute("placeholder", "Tell Klio what happened, ask a question, or hand off work…");
    await expect(conversation.getByRole("button", { name: "Attach photo" })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "Start voice input" })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "Attach file" })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "Add score" })).toBeVisible();
    await expect(conversation.getByLabel("Learner for this message")).toBeVisible();
    await expect(page.locator("textarea:visible")).toHaveCount(1);
    const [boardBounds, scheduleBounds, composerBounds] = await Promise.all([
      page.locator(".spatial-workspace").boundingBox(),
      page.locator("[data-spatial-id='schedule']").boundingBox(),
      conversation.locator(".conversation-followup").boundingBox(),
    ]);
    expect(boardBounds).not.toBeNull();
    expect(scheduleBounds).not.toBeNull();
    expect(composerBounds).not.toBeNull();
    expect(Math.abs(scheduleBounds!.x + scheduleBounds!.width / 2 - (boardBounds!.x + boardBounds!.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(composerBounds!.x + composerBounds!.width / 2 - (scheduleBounds!.x + scheduleBounds!.width / 2))).toBeLessThanOrEqual(1);
    expect(scheduleBounds!.height).toBeGreaterThan(boardBounds!.height * .6);
    expect(scheduleBounds!.height).toBeLessThanOrEqual(boardBounds!.height);
    await expect(conversation.getByText("Reviewing Maya’s worksheet", { exact: true })).toBeVisible();
    await expect(conversation.getByText("How should I teach this worksheet?", { exact: true })).toBeVisible();
    await expect(conversation.getByText("This stopped before finishing. Your original request is safe.", { exact: true })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "Close conversation" })).toBeVisible();
    const workTray = conversation.getByRole("region", { name: "Klio’s current work" });
    await expect(workTray).toBeVisible();
    await expect(workTray).toContainText("Reviewing Maya’s worksheet");
    await expect(conversation.getByText("View work")).toHaveCount(0);
    await expect(conversation.locator(".conversation-working")).toHaveCount(0);

    const visualState = await page.evaluate(() => {
      const parentMessage = document.querySelector<HTMLElement>(".conversation-parent > p");
      const backdrop = document.querySelector<HTMLElement>(".klio-conversation-backdrop");
      return {
        fontSize: parentMessage ? Number.parseFloat(getComputedStyle(parentMessage).fontSize) : 0,
        lineHeight: parentMessage ? Number.parseFloat(getComputedStyle(parentMessage).lineHeight) : 0,
        backdropFilter: backdrop ? getComputedStyle(backdrop).backdropFilter : "",
        conversationScrollbar: getComputedStyle(document.querySelector<HTMLElement>(".klio-conversation-scroll")!).scrollbarWidth,
        conversationMask: getComputedStyle(document.querySelector<HTMLElement>(".klio-conversation-scroll")!).maskImage,
        messageOpacities: [...document.querySelectorAll<HTMLElement>(".conversation-message")].map((message) => getComputedStyle(message).opacity),
        messageFilters: [...document.querySelectorAll<HTMLElement>(".conversation-message")].map((message) => getComputedStyle(message).filter),
        conversationBackground: getComputedStyle(document.querySelector<HTMLElement>(".klio-conversation")!).backgroundColor,
        conversationWidth: document.querySelector<HTMLElement>(".klio-conversation")?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(visualState.fontSize).toBeGreaterThanOrEqual(15);
    expect(visualState.lineHeight).toBeGreaterThanOrEqual(23);
    expect(visualState.backdropFilter).toBe("none");
    expect(visualState.conversationScrollbar).toBe("none");
    expect(visualState.conversationMask).toBe("none");
    expect(visualState.messageOpacities).toEqual(visualState.messageOpacities.map(() => "1"));
    expect(visualState.messageFilters).toEqual(visualState.messageFilters.map(() => "none"));
    expect(visualState.conversationBackground).toBe("rgba(0, 0, 0, 0)");
    expect(visualState.conversationWidth).toBe(page.viewportSize()!.width);

    await expect(workTray).toContainText("Received the submitted work");
    await expect(page).toHaveURL(/\/app$/);
    expect(pageErrors.filter((message) => /hydration/i.test(message))).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(workTray).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const stranded = await admin.from("agent_turns").update({ status: "awaiting_parent", normalized_step: "waiting_detail", last_progress_at: new Date().toISOString() }).eq("id", turn.data.id);
    if (stranded.error) throw stranded.error;
    await page.reload();
    await expect(conversation).toHaveCount(0);
    await expect(homeComposer).toBeVisible();
    const composerBox = await homeComposer.locator(".quiet-capture").boundingBox();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(homeComposer.locator(".quiet-capture > .klio-minimized")).toHaveCount(0);
    await expect(homeComposer).not.toContainText("Klio needs one detail");
    await expect(page.locator("body > .klio-minimized")).toHaveCount(0);
    await expect(homeComposer.getByRole("button", { name: "Save record" })).toHaveCount(0);
    await expect(homeComposer.getByRole("button", { name: "Ask Klio" })).toHaveCount(0);
    const universalInput = homeComposer.getByRole("textbox", { name: "Hand something to Klio" });
    await homeComposer.getByLabel("Learner for this handoff").selectOption("");
    await universalInput.fill("Hi");
    await expect(homeComposer.locator(".composer-interpretation")).toHaveCount(0);
    await expect(homeComposer.getByRole("button", { name: "Send to Klio" })).toBeEnabled();
    await universalInput.fill("What should we do tomorrow?");
    await expect(universalInput).toHaveValue("What should we do tomorrow?");
    await universalInput.fill("Maya scored 92% on the quiz");
    await expect(universalInput).toHaveValue("Maya scored 92% on the quiz");
    await expect(page.locator("textarea:visible")).toHaveCount(1);
    const cleared = await admin.from("agent_turns").update({ status: "cancelled", normalized_step: "paused", completed_at: new Date().toISOString() }).eq("id", turn.data.id);
    if (cleared.error) throw cleared.error;
    const turnsBeforeGreeting = await admin.from("agent_turns").select("id", { count: "exact", head: true }).eq("family_id", familyId);
    const directGreeting = await page.evaluate(async ({ familyId }) => {
      const response = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, studentId: null, evidenceIds: [], intent: "general", request: "Hello", requestId: crypto.randomUUID() }) });
      return { status: response.status, body: await response.json() as { turn?: { id: string }; conversationId?: string; interactionMode?: string } };
    }, { familyId });
    expect(directGreeting.status).toBe(202);
    expect(directGreeting.body.turn?.id).toBeTruthy();
    expect(directGreeting.body.conversationId).toBeTruthy();
    expect(directGreeting.body.interactionMode).toBe("act");
    await expect.poll(async () => (await admin.from("agent_turns").select("id", { count: "exact", head: true }).eq("family_id", familyId)).count).toBe((turnsBeforeGreeting.count ?? 0) + 1);
    const greetingTurn = await admin.from("agent_turns").select("id,interaction_mode").eq("id", directGreeting.body.turn!.id).single();
    expect(greetingTurn.data?.interaction_mode).toBe("act");
    await admin.from("agent_turns").update({ status: "cancelled", normalized_step: "paused", completed_at: new Date().toISOString(), cancel_requested_at: new Date().toISOString() }).eq("id", directGreeting.body.turn!.id).in("status", ["queued", "running"]);
    const nextTurnId = crypto.randomUUID();
    const nextConversationId = crypto.randomUUID();
    const agentRequests: Array<Record<string, unknown>> = [];
    await page.route("**/api/agent", async (route) => {
      agentRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ turn: { id: nextTurnId }, conversationId: nextConversationId, interactionMode: "act" }) });
    });
    await universalInput.fill("Hi");
    await homeComposer.getByRole("button", { name: "Send to Klio" }).click();
    await expect(conversation).toBeVisible();
    await expect(conversation.getByText("Hi", { exact: true })).toBeVisible();
    await expect(conversation.locator(".conversation-working")).toContainText("Thinking");
    await expect(conversation.getByRole("region", { name: "Klio’s current work" })).toHaveCount(0);
    expect(agentRequests).toHaveLength(1);
    expect(agentRequests[0].conversationId).toBeUndefined();
    await expect(conversation.getByRole("button", { name: "Conversations" })).toBeVisible();
    await expect(conversation.getByRole("button", { name: "New conversation" })).toBeVisible();
    await conversation.getByRole("button", { name: "Conversations" }).click();
    await expect(conversation.getByText("Recent conversations", { exact: true })).toBeVisible();
    await conversation.getByRole("button", { name: "Conversations" }).click();
    const attachmentId = crypto.randomUUID();
    let evidenceUploads = 0;
    await page.route("**/api/evidence", async (route) => {
      evidenceUploads += 1;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: attachmentId, ids: [attachmentId], status: "ready", studentId: learner.data.id }) });
    });
    await homeComposer.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles({ name: "maya-worksheet.png", mimeType: "image/png", buffer: Buffer.from("worksheet") });
    await expect(conversation.getByText("maya-worksheet.png", { exact: true })).toBeVisible();
    await conversation.getByLabel("Message Klio").fill("Review Maya's attached worksheet");
    await conversation.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => evidenceUploads).toBe(1);
    await expect.poll(() => agentRequests.at(-1)?.evidenceIds).toEqual([attachmentId]);
    await expect.poll(() => agentRequests.at(-1)?.conversationId).toBe(nextConversationId);
    await conversation.getByLabel("Message Klio").last().fill("Give Maya some math practice today");
    await conversation.getByRole("button", { name: "Send message" }).last().click();
    await expect.poll(() => agentRequests.at(-1)?.intent).toBe("general");
    await expect.poll(() => agentRequests.at(-1)?.conversationId).toBe(nextConversationId);
    await conversation.getByRole("button", { name: "New conversation" }).click();
    await expect(conversation).toHaveCount(0);
    await expect(homeComposer).toBeVisible();
    await expect(universalInput).toBeFocused();
    await homeComposer.getByRole("button", { name: "Open conversations" }).click();
    const historyPicker = page.getByRole("dialog", { name: "Recent conversations" });
    await expect(historyPicker).toBeVisible();
    await expect(historyPicker.getByText("Your last 10 threads with Klio", { exact: true })).toBeVisible();
    await expect(conversation).toHaveCount(0);
    const historyRows = historyPicker.locator(".conversation-history-list > button");
    await expect(historyRows.first()).toBeVisible();
    expect(await historyRows.count()).toBeLessThanOrEqual(10);
    await historyPicker.locator(".conversation-history-list").evaluate((list) => list.dispatchEvent(new Event("scroll")));
    await expect(historyPicker).toBeVisible();
    await historyRows.first().click();
    await expect(conversation).toBeVisible();
    await expect(historyPicker).toHaveCount(0);
    await expect(conversation.getByRole("button", { name: "Conversations" })).toBeVisible();
    const finished = await admin.from("agent_turns").update({
      status: "completed",
      normalized_step: "finished",
      public_result: { message: "Hello! How can I help today?", understood: [], used: [], changed: [], remaining: [], actions: [] },
      completed_at: new Date().toISOString(),
    }).eq("id", directGreeting.body.turn!.id);
    if (finished.error) throw finished.error;
    await page.reload();
    await expect(conversation).toHaveCount(0);
    await expect(homeComposer).toBeVisible();
    await expect(homeComposer.getByRole("button", { name: "Open conversations" })).toBeVisible();
  } finally {
    if (familyId) await admin.from("families").delete().eq("id", familyId);
    await admin.auth.admin.deleteUser(user.data.user.id);
  }
});
