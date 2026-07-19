import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("one open handoff coordinates completion and unfinished work", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_OPENAI_E2E !== "1", "Set RUN_LIVE_OPENAI_E2E=1 for the live autonomous handoff verification");
  test.setTimeout(180_000);
  const suffix = crypto.randomUUID();
  const email = `handoff-${suffix}@example.test`;
  const password = "KlioHandoff123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Handoff Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Handoff Family");
    await page.getByLabel("Learner’s first name").fill("Jacob");
    await page.getByLabel("Add a subject").selectOption("History");
    await page.getByLabel("History course or curriculum").fill("World History");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByLabel("Science course or curriculum").fill("Biology");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Handoff user not found");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();
    const student = await admin.from("students").select("id").eq("family_id", family.data!.id).single();
    const today = new Date().toISOString().slice(0, 10);
    const inserted = await admin.from("assignments").insert([
      { family_id: family.data!.id, student_id: student.data!.id, created_by: userId, title: "World History · Lesson 3", subject: "History", scheduled_date: today, estimated_minutes: 35 },
      { family_id: family.data!.id, student_id: student.data!.id, created_by: userId, title: "Biology · Lesson 4", subject: "Biology", scheduled_date: today, estimated_minutes: 40 },
    ]).select("id,subject");
    if (inserted.error) throw inserted.error;

    await page.goto(`/app?date=${today}`);
    await page.getByRole("textbox", { name: "Hand something to Klio" }).fill("Jacob finished History but struggled with the essay questions. We also did not get to Biology today.");
    await page.getByRole("button", { name: "Send to Klio" }).click();
    await expect(page.getByText("On Klio’s desk", { exact: true })).toBeVisible();
    await expect(page.getByText(/Waiting to start|Reading submitted work|Updating the week/, { exact: true })).toBeVisible();
    await expect(page.getByText("Finished", { exact: true })).toBeVisible({ timeout: 150_000 });

    const historyId = inserted.data.find((item) => item.subject === "History")!.id;
    const biologyId = inserted.data.find((item) => item.subject === "Biology")!.id;
    await expect.poll(async () => (await admin.from("assignments").select("status").eq("id", historyId).single()).data?.status).toBe("completed");
    await expect.poll(async () => (await admin.from("assignments").select("scheduled_date").eq("id", biologyId).single()).data?.scheduled_date).not.toBe(today);
    expect((await admin.from("artifacts").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id).eq("type", "practice")).count).toBe(0);
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
