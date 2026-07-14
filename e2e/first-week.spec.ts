import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("Klio builds a balanced first week from onboarding curriculum", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `first-week-${suffix}@example.test`;
  const password = "KlioFirstWeek123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("First Week Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("First Week Family");
    await page.getByLabel("Learner’s first name").fill("Mira");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Math course or curriculum").fill("Algebra I");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByLabel("Science course or curriculum").fill("Biology");
    await page.getByLabel("Add a subject").selectOption("History");
    await page.getByLabel("History course or curriculum").fill("World History");
    await page.getByLabel("Add a subject").selectOption("Language Arts");
    await page.getByLabel("Language Arts course or curriculum").fill("Writing and Grammar");
    await page.getByLabel("Add a subject").selectOption("Art");
    await page.getByLabel("Add a subject").selectOption("Music");
    await page.getByLabel("Music course or curriculum").fill("Music Theory");
    await expect(page.getByLabel("Math times per week")).toHaveValue("5");
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;

    await page.goto("/app/week");
    await expect(page.getByRole("button", { name: "Build this week" }).first()).toBeVisible();
    await expect(page.getByText("6 subjects are ready", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Build this week" }).first().click();
    await expect(page.getByText("Klio planned Mira’s week: 6 subjects across 30 lessons. Lesson lengths were adjusted to fit each learner’s available time.")).toBeVisible();
    await expect(page.locator(".teacher-week-item").first()).toBeVisible();
    await expect(page.getByText("Every subject has a place.")).toBeVisible();

    const family = await admin.from("families").select("id").eq("created_by", userId!).single();
    const artCurriculum = await admin.from("curriculum_units").select("subject,title,status").eq("family_id", family.data!.id).eq("subject", "Art").single();
    expect(artCurriculum.data).toMatchObject({ subject: "Art", title: "Art", status: "active" });
    const assignments = await admin.from("assignments").select("id,scheduled_date,estimated_minutes,curriculum_unit_id").eq("family_id", family.data!.id);
    expect(assignments.data).toHaveLength(30);
    expect(new Set(assignments.data?.map((item) => item.curriculum_unit_id)).size).toBe(6);
    expect(assignments.data?.every((item) => item.estimated_minutes === 30)).toBe(true);

    await page.goto("/app/assignments");
    await page.getByRole("button", { name: "Algebra I" }).click();
    await page.getByLabel("Math times per week").selectOption("3");
    await expect(page.getByText("Math will be taught 3 times per week.")).toBeVisible();
    await expect(page.getByLabel("Math times per week")).toHaveValue("3");
    const rhythm = await admin.from("student_subjects").select("weekly_frequency").eq("family_id", family.data!.id).eq("name", "Math").single();
    expect(rhythm.data?.weekly_frequency).toBe(3);

    await page.goto("/app/week");
    await page.getByRole("button", { name: "Plan next week" }).click();
    await expect(page.getByText("Klio planned Mira’s week: 6 subjects across 28 lessons. Lesson lengths were adjusted to fit each learner’s available time.")).toBeVisible();
    const nextAssignments = await admin.from("assignments").select("subject").eq("family_id", family.data!.id);
    expect(nextAssignments.data).toHaveLength(58);
    expect(nextAssignments.data?.filter((item) => item.subject === "Math")).toHaveLength(8);

    await page.goto("/app");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByText("Mira’s work")).toBeVisible();
    await expect(page.getByLabel("What happened in learning today?")).toBeVisible();
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
