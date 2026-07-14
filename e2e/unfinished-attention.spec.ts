import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("unfinished work replaces the all-clear and offers a reviewable reschedule", async ({ page }) => {
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
    await expect(page.getByText("Family work")).toBeVisible();
    await expect(page.getByText("Jacob · Reading")).toBeVisible();
    await expect(page.getByText("Malachi has 3 lessons behind")).toBeVisible();
    await expect(page.getByText("Nothing needs attention.")).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "Family learning" })).toBeVisible();
    await expect(page.getByRole("link", { name: "F Family" })).toHaveClass(/active/);

    await page.goto("/app");
    await page.getByRole("button", { name: "Prepare a new schedule for Malachi’s 3 unfinished lessons" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(/Move 3 unfinished lessons/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept changes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review", exact: true })).toHaveAttribute("href", "/app/adjustments");

    const assignmentIds = inserted.data!.map((item) => item.id);
    const beforeApproval = await admin.from("assignments").select("id,scheduled_date").in("id", assignmentIds);
    expect(beforeApproval.data?.every((item) => item.scheduled_date === missedDate)).toBe(true);
    await page.getByRole("button", { name: "Accept changes" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("status")).toContainText("The week has been updated.");
    await expect.poll(async () => {
      const moved = await admin.from("assignments").select("id,scheduled_date").in("id", assignmentIds);
      return moved.data?.filter((item) => item.scheduled_date !== missedDate).length;
    }).toBe(3);
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

function dateOffset(days: number) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
