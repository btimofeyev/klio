import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("students and records stay readable inside bounded dashboards", async ({ page }) => {
  test.skip(process.env.RUN_SEEDED_FAMILY_E2E !== "1", "Run against the local Timofeyev seed only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const email = `dashboard-viewer-${crypto.randomUUID()}@example.test`;
  const password = "KlioDashboard123";
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = users.data.users.find((user) => user.email === "btimofeyev@gmail.com");
  if (!owner) throw new Error("Seed owner not found");
  const family = await admin.from("family_members").select("family_id").eq("user_id", owner.id).eq("role", "owner").single();
  if (family.error) throw family.error;
  const viewer = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (viewer.error) throw viewer.error;

  try {
    const membership = await admin.from("family_members").insert({ family_id: family.data.family_id, user_id: viewer.data.user.id, role: "editor" });
    if (membership.error) throw membership.error;
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app/settings");
    await expect(page.locator(".learner-index-row")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Subjects and curriculum" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Student workspace sections" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);

    await page.getByRole("link", { name: "Edit setup" }).click();
    await expect(page.getByRole("tablist", { name: "Learning setup sections" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Keep Klio’s planning grounded in who they are." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.getByRole("tab", { name: "Schedule" }).click();
    await expect(page.getByText("Teaching hours", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Subjects" }).click();
    await expect(page.getByLabel("Selected subjects")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);

    await page.goto("/app/records");
    await expect(page.getByRole("heading", { name: "Family progress" })).toBeVisible();
    await expect(page.locator(".subject-folders")).toBeVisible();
    await expect(page.locator(".subject-records")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Learning progress" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/settings");
    await expect(page.locator(".learner-index-row")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByRole("link", { name: "Edit setup" }).click();
    await expect(page.getByRole("tablist", { name: "Learning setup sections" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("tab", { name: "Schedule" }).click();
    await expect(page.getByText("Teaching hours", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);

    await page.goto("/app/records");
    const recordsView = page.getByRole("navigation", { name: "Records view" });
    await expect(recordsView.getByRole("link", { name: "Files" })).toBeVisible();
    await expect(page.locator(".subject-records")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await recordsView.getByRole("link", { name: "Progress" }).click();
    await expect(page.getByRole("complementary", { name: "Learning progress" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  } finally {
    await admin.from("family_members").delete().eq("user_id", viewer.data.user.id);
    await admin.auth.admin.deleteUser(viewer.data.user.id);
  }
});
