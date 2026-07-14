import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("a family plans curriculum, reviews submitted work, and approves a coordinated replan", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `operations-${suffix}@example.test`;
  const password = "KlioOperations123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Operations Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Moving Week Family");
    await page.getByLabel("Learner’s first name").fill("Rowan");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Math course or curriculum").fill("Algebra I");
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;

    await page.goto("/app/assignments");
    const algebraCurriculum = page.locator(".curriculum-index section").filter({ hasText: "Algebra I" });
    await expect(algebraCurriculum.getByText("Ready for Klio to plan")).toBeVisible();
    await algebraCurriculum.getByRole("button", { name: "Schedule lessons" }).click();
    await expect(page.getByLabel("Curriculum or course")).toHaveValue("Algebra I");
    await expect(page.getByLabel("Subject")).toHaveValue("Math");
    await page.getByLabel("Start at").fill("6");
    await page.getByLabel("How many").fill("3");
    await page.getByLabel("First date").fill(nextMonday());
    await page.getByLabel("Time", { exact: true }).fill("09:00");
    await page.getByLabel("Preferred minutes").fill("45");
    await page.getByRole("button", { name: "Create assignments" }).click();
    await expect(page.getByText("3 Math assignments added.")).toBeVisible();
    await expect(page.getByText("Algebra I · Lesson 6", { exact: true })).toBeVisible();

    await page.goto(`/app?date=${dateAfter(nextMonday(), 2)}`);
    const lesson8 = page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 8" });
    await lesson8.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Algebra I · Lesson 8 marked complete.")).toBeVisible();
    await expect(lesson8).toHaveCSS("transform", "none");
    await expect(lesson8).toHaveAttribute("draggable", "true");
    await expect(lesson8.getByRole("button", { name: "Add work" })).toBeVisible();
    await lesson8.dragTo(page.locator(".teacher-klio-dock .quiet-capture"));
    const completedWorkInput = page.getByLabel("What happened in learning today?");
    await expect(completedWorkInput).toHaveAttribute("spellcheck", "true");
    await expect(completedWorkInput).toHaveAttribute("autocorrect", "on");
    await expect(completedWorkInput).toHaveAttribute("autocapitalize", "sentences");
    await expect(completedWorkInput).toHaveAttribute("lang", "en");
    await completedWorkInput.fill("Finished in thrty mintues");
    const spellingSuggestions = page.getByLabel("Spelling suggestions");
    await expect(spellingSuggestions).toContainText("thrty might be misspelled");
    await spellingSuggestions.getByRole("button", { name: "thirty", exact: true }).click();
    await expect(spellingSuggestions).toContainText("mintues might be misspelled");
    await completedWorkInput.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      const caret = input.value.indexOf("mintues") + 2;
      input.focus();
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 500, clientY: 500 }));
    });
    const correctionMenu = page.getByRole("menu", { name: "Corrections for mintues" });
    await expect(correctionMenu).toBeVisible();
    await correctionMenu.getByRole("menuitem", { name: "minutes", exact: true }).click();
    await expect(completedWorkInput).toHaveValue("Finished in thirty minutes");
    await page.getByRole("button", { name: "Save to Klio" }).click();
    await expect(page.getByText("Algebra I · Lesson 8 marked complete. The note was filed in Math.")).toBeVisible();
    await page.goto("/app/review");
    await expect(page.locator(".grade-review").filter({ hasText: "Algebra I · Lesson 8" })).toHaveCount(0);

    await page.goto(`/app?date=${dateAfter(nextMonday(), 2)}`);
    const completedLesson8 = page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 8" });
    await completedLesson8.dragTo(page.locator(".teacher-klio-dock .quiet-capture"));
    await page.getByLabel("What happened in learning today?").fill("Score: 92%. Completed worksheet attached for the record.");
    await page.getByRole("button", { name: "Save to Klio" }).click();
    await expect(page.getByText("Algebra I · Lesson 8 is filed and ready for review.")).toBeVisible();
    await expect(completedLesson8).toHaveClass(/completed/);
    await page.goto("/app/review");
    const lesson8Review = page.locator(".grade-review").filter({ hasText: "Algebra I · Lesson 8" });
    await expect(lesson8Review.getByRole("spinbutton", { name: "Klio’s suggested score %" })).toHaveValue("92");
    await lesson8Review.getByRole("button", { name: "Looks right — approve" }).click();
    await expect(page.getByText(/review was approved/)).toBeVisible();

    await page.goto(`/app?date=${nextMonday()}`);
    const lesson6 = page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 6" });
    await lesson6.dragTo(page.locator(".teacher-klio-dock .quiet-capture"));
    await expect(page.getByText("Working with")).toBeVisible();
    await expect(page.locator(".quiet-assignment-context").getByText("Algebra I · Lesson 6")).toBeVisible();
    await page.getByLabel("What happened in learning today?").fill("Score: 68%. Negative slopes were reversed on two questions.");
    await page.getByRole("button", { name: "Save to Klio" }).click();
    await expect(page.getByText("Algebra I · Lesson 6 is filed and ready for review.")).toBeVisible();
    await page.goto("/app/review");
    const lesson6Review = page.locator(".grade-review").filter({ hasText: "Algebra I · Lesson 6" });
    await expect(lesson6Review.getByText("Reviewed by Klio", { exact: true })).toBeVisible();
    await expect(lesson6Review.getByRole("spinbutton", { name: "Klio’s suggested score %" })).toHaveValue("68");
    await lesson6Review.getByLabel("Klio’s feedback").fill("Review negative slopes, then retry two graphing problems.");
    await lesson6Review.getByRole("button", { name: "Looks right — approve" }).click();
    await expect(page.getByText(/review was approved/)).toBeVisible();
    await page.goto("/app/adjustments");
    await expect(page.getByText(/Add 15 minutes of focused Math review/)).toBeVisible();

    await page.goto("/app/week");
    await page.getByRole("button", { name: /Tue/ }).click();
    await page.locator(".teacher-week-item").filter({ hasText: "Algebra I · Lesson 7" }).click();
    const lesson7 = page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 7" });
    await lesson7.dragTo(page.locator(".teacher-klio-dock .quiet-capture"));
    const attachedInput = page.getByLabel("What happened in learning today?");
    await expect.poll(async () => (await attachedInput.boundingBox())?.height ?? 0).toBeGreaterThan(90);
    await attachedInput.fill("Push this to tomorrow and adjust accordingly.");
    await page.getByRole("button", { name: "Save to Klio" }).click();
    await expect(page.getByText(/Week updated\. Move Algebra I · Lesson 7/)).toBeVisible();
    await page.goto(`/app?date=${dateAfter(nextMonday(), 2)}`);
    await expect(page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 7" })).toBeVisible();
    await expect(page.getByText("Push this to tomorrow and adjust accordingly.")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByText("Rowan’s work")).toBeVisible();
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

function nextMonday() {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  const offset = (8 - value.getUTCDay()) % 7 || 7;
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function dateAfter(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
