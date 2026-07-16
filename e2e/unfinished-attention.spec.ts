import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("marking unfinished work lets Klio move it automatically with undo", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `unfinished-${suffix}@example.test`;
  const password = "KlioUnfinished123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;

  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Schedule Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Carry Forward Family");
    await page.getByLabel("Learner’s first name").fill("Malachi");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Math course or curriculum").fill("Math Foundations");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    expect(userId).toBeTruthy();
    const family = await admin.from("families").select("id").eq("created_by", userId!).single();
    const student = await admin.from("students").select("id").eq("family_id", family.data!.id).single();
    const sibling = await admin.from("students").insert({ family_id: family.data!.id, display_name: "Jacob", grade_band: "3-5" }).select("id").single();
    expect(sibling.error).toBeNull();
    const missedDate = dateOffset(-1);
    const inserted = await admin.from("assignments").insert([
      { family_id: family.data!.id, student_id: student.data!.id, created_by: userId, title: "Math · Lesson 1", subject: "Math", status: "planned", scheduled_date: missedDate, estimated_minutes: 20, source_kind: "parent" },
      { family_id: family.data!.id, student_id: student.data!.id, created_by: userId, title: "Phonics · Lesson 1", subject: "Phonics", status: "planned", scheduled_date: missedDate, estimated_minutes: 20, source_kind: "parent" },
      { family_id: family.data!.id, student_id: student.data!.id, created_by: userId, title: "Spelling · Lesson 1", subject: "Spelling", status: "planned", scheduled_date: missedDate, estimated_minutes: 20, source_kind: "parent" },
    ]).select("id,title,scheduled_date");
    expect(inserted.error).toBeNull();
    const siblingAssignment = await admin.from("assignments").insert({ family_id: family.data!.id, student_id: sibling.data!.id, created_by: userId, title: "Reading · Lesson 1", subject: "Reading", status: "planned", scheduled_date: dateOffset(0), estimated_minutes: 25, source_kind: "parent" });
    expect(siblingAssignment.error).toBeNull();

    await page.goto("/app");
    await expect(page.getByLabel("View day plan for")).toHaveValue("all");
    await expect(page.getByText("Family work", { exact: true })).toBeVisible();
    await page.getByText("Jacob · Reading").scrollIntoViewIfNeeded();
    await expect(page.getByText("Jacob · Reading")).toBeVisible();
    await expect(page.getByRole("button", { name: /Attention/ })).toHaveCount(0);
    await page.getByLabel("View day plan for").selectOption(student.data!.id);
    await expect(page.getByText("Malachi’s work")).toBeVisible();

    await page.goto("/app/week");
    await expect(page.getByLabel("View schedule for")).toHaveValue("all");
    await expect(page.getByLabel("View schedule for").locator("option").first()).toHaveText("Family");
    await page.goto("/app/assignments");
    await expect(page.getByLabel("View")).toHaveValue("all");
    await expect(page.getByText(/Malachi · Math/).first()).toBeVisible();
    await page.goto("/app/review");
    await expect(page.getByLabel("View")).toHaveValue("all");
    await page.goto("/app/adjustments");
    await expect(page.getByLabel("View")).toHaveValue("all");
    await page.goto("/app/records");
    await expect(page.getByRole("heading", { name: "Family progress" })).toBeVisible();
    await expect(page.getByRole("link", { name: "F Family" })).toHaveClass(/active/);

    await page.goto("/app");
    await page.getByRole("button", { name: "Previous day" }).click();
    await page.locator(".day-assignment").filter({ hasText: "Math · Lesson 1" }).click();
    await page.getByRole("button", { name: "Not finished" }).click();
    await expect(page).toHaveURL(/\/app$/);
    const assignmentIds = [inserted.data!.find((item) => item.title === "Math · Lesson 1")!.id];
    await page.getByRole("button", { name: /Klio adjusted/ }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect.poll(async () => {
      const moved = await admin.from("assignments").select("id,scheduled_date").in("id", assignmentIds);
      return moved.data?.filter((item) => item.scheduled_date !== missedDate).length;
    }).toBe(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => {
      const restored = await admin.from("assignments").select("id,scheduled_date").in("id", assignmentIds);
      return restored.data?.filter((item) => item.scheduled_date === missedDate).length;
    }).toBe(1);

    await page.goto("/app");
    await page.getByRole("button", { name: "Previous day" }).click();
    await page.locator(".day-assignment").filter({ hasText: "Phonics · Lesson 1" }).click();
    await page.getByRole("button", { name: "Not finished" }).click();
    const adjustedTab = page.getByRole("button", { name: /Klio adjusted/ });
    await expect(adjustedTab).toBeVisible();
    await adjustedTab.click();
    const panel = page.locator("aside[data-spatial-object]");
    await expect(panel.getByRole("button", { name: "Acknowledge" })).toBeVisible();
    await panel.getByRole("button", { name: "Acknowledge" }).click();
    await expect(adjustedTab).toHaveCount(0);
    await expect(panel).toHaveCount(0);

    await expect.poll(async () => (await admin.from("adjustment_proposals").select("acknowledged_at").eq("family_id", family.data!.id).eq("status", "applied").order("created_at", { ascending: false }).limit(1).single()).data?.acknowledged_at).not.toBeNull();
    const acknowledged = await admin.from("adjustment_proposals").select("id,summary,status,undo_status,acknowledged_at").eq("family_id", family.data!.id).eq("status", "applied").order("created_at", { ascending: false }).limit(1).single();
    expect(acknowledged.error).toBeNull();
    expect(acknowledged.data).toMatchObject({ status: "applied", undo_status: "available" });
    expect(acknowledged.data!.acknowledged_at).toBeTruthy();
    const repeatedAcknowledgement = await page.evaluate(async (proposalId) => {
      const response = await fetch(`/api/adjustments/${proposalId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "acknowledge" }) });
      return { status: response.status, body: await response.json() };
    }, acknowledged.data!.id);
    expect(repeatedAcknowledgement).toMatchObject({ status: 200, body: { status: "acknowledged", alreadyAcknowledged: true, acknowledgedCount: 0 } });
    await page.reload();
    await expect(page.getByRole("button", { name: /Klio adjusted/ })).toHaveCount(0);
    await page.goto("/app/activity");
    const historyEntry = page.locator(".activity-row").filter({ hasText: acknowledged.data!.summary });
    await expect(historyEntry.getByText("Schedule update")).toBeVisible();
    await historyEntry.locator("summary").click();
    await expect(historyEntry.getByRole("button", { name: "Undo change" })).toBeVisible();
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

function dateOffset(days: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const part = (type: "year" | "month" | "day") => Number(parts.find((item) => item.type === type)?.value);
  const value = new Date(Date.UTC(part("year"), part("month") - 1, part("day"), 12));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
