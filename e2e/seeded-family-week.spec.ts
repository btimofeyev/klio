import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("the seeded family uses a readable schedule-centered teaching board", async ({ page }) => {
  test.skip(process.env.RUN_SEEDED_FAMILY_E2E !== "1", "Run against the local Timofeyev seed only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const password = "KlioSeedViewer123";
  const email = `seed-viewer-${crypto.randomUUID()}@example.test`;
  const targetUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = targetUsers.data.users.find((user) => user.email === "btimofeyev@gmail.com");
  if (!owner) throw new Error("Seed owner not found");
  const family = await admin.from("family_members").select("family_id").eq("user_id", owner.id).eq("role", "owner").single();
  if (family.error) throw family.error;
  const originalLayout = await admin.from("family_workspace_layouts").select("*").eq("family_id", family.data.family_id).eq("surface", "week").eq("scope_key", "all").maybeSingle();
  if (originalLayout.error) throw originalLayout.error;
  const reorderDate = "2026-07-14";
  const originalDay = await admin.from("assignments").select("id,title,scheduled_time").eq("family_id", family.data.family_id).eq("scheduled_date", reorderDate).neq("status", "skipped").order("scheduled_time");
  if (originalDay.error) throw originalDay.error;
  if (originalDay.data.length < 2) throw new Error("Seeded day needs at least two lessons for reorder coverage");
  const originalPlacements = await admin.from("weekly_plan_items").select("id,assignment_id,scheduled_time,position").eq("family_id", family.data.family_id).in("assignment_id", originalDay.data.map((item) => item.id));
  if (originalPlacements.error) throw originalPlacements.error;
  const viewer = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (viewer.error) throw viewer.error;

  try {
    const membership = await admin.from("family_members").insert({ family_id: family.data.family_id, user_id: viewer.data.user.id, role: "editor" });
    if (membership.error) throw membership.error;
    await page.setViewportSize({ width: 1199, height: 1192 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/week");

    await expect(page.getByRole("heading", { name: "Jul 13 – Jul 17, 2026" })).toBeVisible();
    for (const learner of ["Jacob", "Maya", "Noah"]) {
      await expect(page.locator(".teacher-week-learner-lane").filter({ hasText: learner })).toHaveCount(5);
    }

    const board = page.locator(".spatial-workspace");
    const schedule = page.locator("[data-spatial-id='schedule']");
    const leftTabs = page.getByRole("navigation", { name: "Left workspace tabs" });
    const rightTabs = page.getByRole("navigation", { name: "Right workspace tabs" });
    await expect(board).toHaveAttribute("data-zoom", "working");
    await expect(schedule).toBeVisible();
    await expect(leftTabs).not.toContainText("Week shape");
    await expect(leftTabs).not.toContainText("Progress");
    await expect(rightTabs).not.toContainText("Attention");
    await expect(rightTabs).not.toContainText("Records");
    await expect(leftTabs.getByRole("button").or(rightTabs.getByRole("button")).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);

    const [boardBounds, scheduleBounds, assistantBounds] = await Promise.all([
      board.boundingBox(),
      schedule.boundingBox(),
      page.locator(".spatial-assistant-surface").boundingBox(),
    ]);
    expect(boardBounds).not.toBeNull();
    expect(scheduleBounds).not.toBeNull();
    expect(assistantBounds).not.toBeNull();
    expect(Math.abs(scheduleBounds!.x + scheduleBounds!.width / 2 - (boardBounds!.x + boardBounds!.width / 2))).toBeLessThanOrEqual(1);
    expect(scheduleBounds!.y + scheduleBounds!.height).toBeLessThanOrEqual(assistantBounds!.y - 4);

    const dayColumns = await page.locator(".teacher-week-sheet > section").evaluateAll((sections) => sections.map((section) => {
      const bounds = section.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, width: bounds.width };
    }));
    expect(dayColumns).toHaveLength(5);
    expect(Math.min(...dayColumns.map(({ width }) => width))).toBeGreaterThanOrEqual(120);
    expect(Math.max(...dayColumns.map(({ top }) => top)) - Math.min(...dayColumns.map(({ top }) => top))).toBeLessThanOrEqual(1);
    const weekType = await page.locator(".teacher-week-item").first().evaluate((item) => ({
      subject: parseFloat(getComputedStyle(item.querySelector(":scope > span")!).fontSize),
      title: parseFloat(getComputedStyle(item.querySelector(":scope > strong")!).fontSize),
      meta: parseFloat(getComputedStyle(item.querySelector(":scope > small")!).fontSize),
    }));
    expect(weekType.subject).toBeGreaterThanOrEqual(10);
    expect(weekType.title).toBeGreaterThanOrEqual(10);
    expect(weekType.meta).toBeGreaterThanOrEqual(9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1199);

    await rightTabs.getByRole("button").first().click();
    const updatePanel = page.locator("aside[data-spatial-object]");
    await expect(updatePanel).toBeVisible();
    await expect(schedule).toBeVisible();
    await updatePanel.getByRole("button", { name: /Close/ }).click();
    await expect(board).toHaveAttribute("data-camera-id", "schedule");

    await page.locator(".teacher-week-item").first().click();
    await expect(page.locator("[data-spatial-id='lesson']")).toBeVisible();
    await expect(board).toHaveAttribute("data-camera-id", "lesson");
    await page.getByRole("button", { name: "Back to schedule" }).click();
    await expect(page.locator("[data-spatial-id='lesson']")).toHaveCount(0);

    await page.getByRole("button", { name: "Arrange tabs" }).click();
    await expect(page.getByText("Use the arrows or drag a tab to place it where you want.")).toBeVisible();
    const movableLabel = await leftTabs.getByRole("button").first().locator("span").innerText();
    await page.getByRole("button", { name: `Move ${movableLabel} to the right` }).click();
    await expect(rightTabs).toContainText(movableLabel);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const saved = await admin.from("family_workspace_layouts").select("positions").eq("family_id", family.data.family_id).eq("surface", "week").eq("scope_key", "all").single();
      const positions = saved.data?.positions as Record<string, { x?: number }> | null;
      return Object.values(positions ?? {}).some((position) => position.x === 3200);
    }).toBe(true);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Right workspace tabs" })).toContainText(movableLabel);
    await page.getByRole("button", { name: "Arrange tabs" }).click();
    await page.getByRole("button", { name: "Reset tab arrangement" }).click();
    await expect(page.getByRole("navigation", { name: "Left workspace tabs" })).toContainText(movableLabel);
    await page.screenshot({ path: "/tmp/klio-schedule-centered-week.png", fullPage: true });

    await page.goto("/app/records");
    await expect(page.getByRole("heading", { name: "Family progress" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Activity" })).toBeVisible();

    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Wednesday, July 15" })).toBeVisible();
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page.getByRole("heading", { name: "Tuesday, July 14" })).toBeVisible();
    await expect(page.locator(".spatial-day-schedule .teacher-day-sheet")).toBeVisible();
    await expect(page.getByText("Drag lessons to reorder or drop one on Klio")).toBeVisible();
    const [firstLesson, secondLesson] = originalDay.data;
    const firstLessonRow = page.locator(".day-assignment").filter({ hasText: firstLesson.title }).first();
    await firstLessonRow.dragTo(page.locator(".day-assignment").filter({ hasText: secondLesson.title }).first(), { targetPosition: { x: 30, y: 70 } });
    await expect(page.getByText("Today’s lesson order was updated.")).toBeVisible();
    await expect(page.locator(".day-assignment").nth(0)).toContainText(secondLesson.title);
    await expect(page.locator(".day-assignment").nth(1)).toContainText(firstLesson.title);
    await expect.poll(async () => {
      const current = await admin.from("assignments").select("id,scheduled_time").in("id", [firstLesson.id, secondLesson.id]);
      return Object.fromEntries((current.data ?? []).map((item) => [item.id, item.scheduled_time]));
    }).toEqual({ [firstLesson.id]: secondLesson.scheduled_time, [secondLesson.id]: firstLesson.scheduled_time });
    await expect.poll(async () => {
      const current = await admin.from("weekly_plan_items").select("assignment_id,scheduled_time").in("assignment_id", [firstLesson.id, secondLesson.id]);
      return Object.fromEntries((current.data ?? []).map((item) => [item.assignment_id, item.scheduled_time]));
    }).toEqual({ [firstLesson.id]: secondLesson.scheduled_time, [secondLesson.id]: firstLesson.scheduled_time });

    await page.locator(".day-assignment").filter({ hasText: firstLesson.title }).first().dragTo(page.locator(".day-assignment").filter({ hasText: secondLesson.title }).first(), { targetPosition: { x: 30, y: 3 } });
    await expect(page.locator(".day-assignment").nth(0)).toContainText(firstLesson.title);
    await expect(page.locator(".day-assignment").nth(1)).toContainText(secondLesson.title);
    const restoredRow = page.locator(".day-assignment").filter({ hasText: firstLesson.title }).first();
    await restoredRow.click();
    await restoredRow.getByRole("button", { name: "Hand to Klio" }).click();
    await expect(page.locator(".quiet-assignment-context")).toContainText(firstLesson.title);
    await expect(page.getByRole("textbox", { name: "Hand something to Klio" })).toBeFocused();
    await page.getByRole("button", { name: `Remove ${firstLesson.title}` }).click();
    await expect(page.getByRole("navigation", { name: "Left workspace tabs" })).not.toContainText("Progress");
    await expect(page.getByRole("navigation", { name: "Right workspace tabs" })).not.toContainText("Attention");
    await page.locator(".day-assignment").first().click();
    await expect(page.locator(".lesson-focus-detail")).toBeVisible();
    await expect(page.locator(".spatial-workspace")).toHaveAttribute("data-camera-level", "nested");
    await page.keyboard.press("Escape");
    await expect(page.locator(".lesson-focus-detail")).toHaveCount(0);
    await page.screenshot({ path: "/tmp/klio-schedule-centered-day.png", fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const [mobileBoard, mobileSchedule, mobileAssistant, mobileLeft, mobileRight] = await Promise.all([
      page.locator(".spatial-workspace").boundingBox(),
      page.locator("[data-spatial-id='schedule']").boundingBox(),
      page.locator(".spatial-assistant-surface").boundingBox(),
      page.getByRole("navigation", { name: "Left workspace tabs" }).boundingBox(),
      page.getByRole("navigation", { name: "Right workspace tabs" }).boundingBox(),
    ]);
    expect(mobileBoard).not.toBeNull();
    expect(mobileSchedule).not.toBeNull();
    expect(mobileAssistant).not.toBeNull();
    expect(mobileLeft).not.toBeNull();
    expect(mobileRight).not.toBeNull();
    expect(mobileSchedule!.x - mobileBoard!.x).toBeGreaterThanOrEqual(7);
    expect(mobileSchedule!.x - mobileBoard!.x).toBeLessThanOrEqual(9);
    expect(mobileLeft!.y + mobileLeft!.height).toBeLessThanOrEqual(mobileRight!.y + 1);
    expect(mobileRight!.y + mobileRight!.height).toBeLessThanOrEqual(mobileSchedule!.y + 1);
    expect(mobileSchedule!.y + mobileSchedule!.height).toBeLessThanOrEqual(mobileAssistant!.y - 4);
    const mobileType = await page.locator(".day-assignment").first().evaluate((item) => ({
      title: parseFloat(getComputedStyle(item.querySelector(":scope strong")!).fontSize),
      context: parseFloat(getComputedStyle(item.querySelector(":scope small")!).fontSize),
    }));
    expect(mobileType.title).toBeGreaterThanOrEqual(10);
    expect(mobileType.context).toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "/tmp/klio-schedule-centered-day-mobile.png", fullPage: true });
  } finally {
    await Promise.all(originalDay.data.map((item) => admin.from("assignments").update({ scheduled_time: item.scheduled_time }).eq("id", item.id).eq("family_id", family.data.family_id)));
    await Promise.all(originalPlacements.data.map((item) => admin.from("weekly_plan_items").update({ scheduled_time: item.scheduled_time, position: item.position }).eq("id", item.id).eq("family_id", family.data.family_id)));
    if (originalLayout.data) await admin.from("family_workspace_layouts").upsert(originalLayout.data, { onConflict: "family_id,surface,scope_key" });
    else await admin.from("family_workspace_layouts").delete().eq("family_id", family.data.family_id).eq("surface", "week").eq("scope_key", "all");
    await admin.from("family_members").delete().eq("user_id", viewer.data.user.id);
    await admin.auth.admin.deleteUser(viewer.data.user.id);
  }
});
