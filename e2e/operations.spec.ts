import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

test("a family plans curriculum, reviews submitted work, and approves a coordinated replan", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = crypto.randomUUID();
  const email = `operations-${suffix}@example.test`;
  const password = "KlioOperations123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  let familyId: string | null = null;
  let studentId: string | null = null;
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
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("The operations test user was not created.");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();
    if (family.error) throw family.error;
    familyId = family.data.id;
    const student = await admin.from("students").select("id").eq("family_id", familyId).eq("display_name", "Rowan").single();
    if (student.error) throw student.error;
    studentId = student.data.id;
    const regression = await seedScopedOperationsRegression(admin, { familyId, studentId, userId, anchorDate: dateAfter(nextMonday(), 42) });

    await page.goto(`/app?date=${regression.dayAnchor}&student=${studentId}`);
    await expect(page.getByText("Scoped anchor day", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.previousDay}.*student=${studentId}`));
    await expect(page.getByText("Scoped previous day", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next day" }).click();
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.nextDay}.*student=${studentId}`));
    await expect(page.getByText("Scoped next day", { exact: true })).toBeVisible();

    await page.goto(`/app/week?date=${regression.weekAnchor}&student=${studentId}`);
    await expect(page.getByText("Scoped current week", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.nextWeek}.*student=${studentId}`));
    await expect(page.getByText("Scoped next week", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.weekAnchor}.*student=${studentId}`));
    await expect(page.getByText("Scoped current week", { exact: true })).toBeVisible();

    await page.goto(`/app/week?date=${regression.monthAnchor}&student=${studentId}&view=month`);
    await expect(page.getByRole("region", { name: monthDayLabel(regression.monthAnchor) })).toContainText("1 lesson");
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.nextMonth}.*student=${studentId}.*view=month`));
    await expect(page.getByRole("region", { name: monthDayLabel(regression.nextMonth) })).toContainText("1 lesson");
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.monthAnchor}.*student=${studentId}.*view=month`));
    await page.getByRole("button", { name: "Open this week" }).click();
    await expect(page).toHaveURL(`/app/week?date=${regression.monthAnchor}&student=${studentId}`);
    await expect(page.getByText("Scoped current month", { exact: true })).toBeVisible();

    await page.goto(`/app/assignments?student=${studentId}&unit=${regression.paginationUnitId}`);
    await expect(page.getByText("125 total · 25 completed · 100 active", { exact: true })).toBeVisible();
    await expect(page.locator(".assignment-library .ops-assignment")).toHaveCount(50);
    await page.getByRole("button", { name: "Load more lessons" }).click();
    await expect(page.locator(".assignment-library .ops-assignment")).toHaveCount(100);
    await page.getByRole("button", { name: "Load more lessons" }).click();
    await expect(page.locator(".assignment-library .ops-assignment")).toHaveCount(125);
    await expect(page.getByRole("button", { name: "Load more lessons" })).toHaveCount(0);
    expect(await page.locator(".assignment-library .ops-assignment").evaluateAll((rows) => new Set(rows.map((row) => row.textContent)).size)).toBe(125);

    await page.getByLabel("View").selectOption(regression.secondStudentId);
    await expect(page).toHaveURL(new RegExp(`student=${regression.secondStudentId}`));
    await expect(page.getByText("Sage Biology · Lesson 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Pagination Math · Lesson 1", { exact: true })).toHaveCount(0);
    await page.getByLabel("View").selectOption(studentId);
    await expect(page).toHaveURL(new RegExp(`student=${studentId}`));
    await expect(page.getByText("Algebra I", { exact: true }).first()).toBeVisible();

    await page.goto("/app/review");
    await expect(page.locator(".grade-review").filter({ hasText: "Review outside loaded dates" })).toBeVisible();
    await page.goto("/app/adjustments");
    await expect(page.locator(".adjustments-list article").filter({ hasText: "Adjustment outside loaded dates" })).toBeVisible();

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
    await lesson8.getByRole("button", { name: "Mark Algebra I · Lesson 8 done" }).click();
    await expect(page.getByText("Algebra I · Lesson 8 is done. Klio recorded it and is checking the follow-through.")).toBeVisible();
    await expect(lesson8).toHaveClass(/completed/);
    await lesson8.getByLabel("Actions for Algebra I · Lesson 8").click();
    const completedDetails = lesson8.getByRole("menuitem", { name: "View details for Algebra I · Lesson 8" });
    await expect(completedDetails).toHaveAttribute("aria-expanded", "false");
    expect((await lesson8.boundingBox())!.height).toBeLessThanOrEqual(56);
    await expect(lesson8.locator(".lesson-focus-detail")).toHaveCount(0);
    await expect(lesson8.getByRole("button", { name: "Hand to Klio" })).toHaveCount(0);
    await completedDetails.click();
    const hideCompletedDetails = lesson8.getByRole("menuitem", { name: "Hide details for Algebra I · Lesson 8" });
    await expect(hideCompletedDetails).toHaveAttribute("aria-expanded", "true");
    await expect(lesson8.getByRole("button", { name: "Hand to Klio" })).toBeVisible();
    await hideCompletedDetails.click();
    await expect(completedDetails).toHaveAttribute("aria-expanded", "false");
    await expect(lesson8).toHaveCSS("transform", "none");
    await expect(lesson8).toHaveAttribute("draggable", "true");
    await lesson8.dragTo(page.locator(".spatial-assistant-surface .quiet-capture"));
    const completedWorkInput = page.getByRole("textbox", { name: "Hand something to Klio" });
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
    await page.goto("/app/review");
    await expect(page.locator(".grade-review").filter({ hasText: "Algebra I · Lesson 8" })).toHaveCount(0);

    await page.goto(`/app?date=${dateAfter(nextMonday(), 2)}`);
    const completedLesson8 = page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 8" });
    await completedLesson8.dragTo(page.locator(".spatial-assistant-surface .quiet-capture"));
    await page.locator('.spatial-assistant-surface input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles({ name: "lesson-8.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
    await page.getByRole("textbox", { name: "Hand something to Klio" }).fill("Score: 92%. Completed worksheet attached for the record.");
    await page.getByRole("button", { name: "Send to Klio" }).click();
    await expect(page.getByText("Algebra I · Lesson 8 is complete and the submitted work is ready for review.")).toBeVisible();
    await expect(completedLesson8).toHaveClass(/completed/);
    await page.goto("/app/review");
    const lesson8Review = page.locator(".grade-review").filter({ hasText: "Algebra I · Lesson 8" });
    await expect(lesson8Review.getByRole("spinbutton", { name: "Klio’s suggested score %" })).toHaveValue("92");
    await lesson8Review.getByRole("button", { name: "Looks right — approve" }).click();
    await expect(page.getByText(/review was approved/)).toBeVisible();

    await page.goto(`/app?date=${nextMonday()}`);
    const lesson6 = page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 6" });
    await lesson6.dragTo(page.locator(".spatial-assistant-surface .quiet-capture"));
    const noteTurnId = crypto.randomUUID();
    const noteConversationId = crypto.randomUUID();
    let noteRequest: Record<string, unknown> | null = null;
    const captureNoteRequest = async (route: import("@playwright/test").Route) => {
      noteRequest = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ turn: { id: noteTurnId }, conversationId: noteConversationId, interactionMode: "act" }) });
    };
    await page.route("**/api/agent", captureNoteRequest);
    await page.getByRole("textbox", { name: "Hand something to Klio" }).fill("Did great on this today.");
    await page.getByRole("button", { name: "Send to Klio" }).click();
    const noteConversation = page.getByRole("dialog", { name: "Conversation with Klio" });
    await expect(noteConversation.getByText("Did great on this today.", { exact: true })).toBeVisible();
    expect(noteRequest).toMatchObject({ request: "Did great on this today." });
    await noteConversation.getByRole("button", { name: "New conversation" }).click();
    await page.unroute("**/api/agent", captureNoteRequest);
    await page.goto("/app/review");
    await expect(page.locator(".grade-review").filter({ hasText: "Algebra I · Lesson 6" })).toHaveCount(0);

    await page.goto(`/app?date=${nextMonday()}`);
    const lesson6ForReview = page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 6" });
    await lesson6ForReview.dragTo(page.locator(".spatial-assistant-surface .quiet-capture"));
    await expect(page.getByText("Working with")).toBeVisible();
    await expect(page.locator(".quiet-assignment-context").getByText("Algebra I · Lesson 6")).toBeVisible();
    await page.locator('.spatial-assistant-surface input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles({ name: "lesson-6.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
    await page.getByRole("textbox", { name: "Hand something to Klio" }).fill("Score: 68%. Negative slopes were reversed on two questions.");
    await page.getByRole("button", { name: "Send to Klio" }).click();
    await expect(page.getByText("Algebra I · Lesson 6 is filed and ready for review.")).toBeVisible();
    await page.goto("/app/review");
    const lesson6Review = page.locator(".grade-review").filter({ hasText: "Algebra I · Lesson 6" });
    await expect(lesson6Review.getByText("Reviewed by Klio", { exact: true })).toBeVisible();
    await expect(lesson6Review.getByRole("spinbutton", { name: "Klio’s suggested score %" })).toHaveValue("68");
    await lesson6Review.getByLabel("Klio’s feedback").fill("Review negative slopes, then retry two graphing problems.");
    await lesson6Review.getByRole("button", { name: "Looks right — approve" }).click();
    await expect(page.getByText(/review was approved/)).toBeVisible();
    await page.goto("/app/adjustments");
    await expect(page.getByText(/Add .*focused Math review/)).toHaveCount(0);

    await page.goto(`/app/week?date=${nextMonday()}`);
    await page.getByRole("button", { name: /Tue/ }).click();
    await page.locator(".teacher-week-item").filter({ hasText: "Algebra I · Lesson 7" }).click();
    const lesson7 = page.locator("[data-spatial-id='lesson']").filter({ hasText: "Algebra I · Lesson 7" });
    await expect(lesson7).toBeInViewport();
    await lesson7.getByRole("button", { name: "Hand to Klio" }).click();
    const attachedInput = page.getByRole("textbox", { name: "Hand something to Klio" });
    await expect(page.locator(".spatial-assistant-surface .quiet-capture")).toHaveClass(/assignment-context-mode/);
    await expect.poll(async () => (await attachedInput.boundingBox())?.height ?? 0).toBeGreaterThan(90);
    await attachedInput.fill("Push this to tomorrow and adjust accordingly.");
    await page.getByRole("button", { name: "Send to Klio" }).click();
    await expect(page.getByText(/Week updated\. Moved Algebra I · Lesson 7/)).toBeVisible();
    const movedLesson = await admin.from("assignments").select("scheduled_date").eq("family_id", familyId!).eq("title", "Algebra I · Lesson 7").single();
    if (movedLesson.error || !movedLesson.data.scheduled_date) throw movedLesson.error ?? new Error("The lesson was not rescheduled.");
    expect(movedLesson.data.scheduled_date).not.toBe(dateAfter(nextMonday(), 1));
    await page.goto(`/app?date=${movedLesson.data.scheduled_date}`);
    await expect(page.locator(".day-assignment").filter({ hasText: "Algebra I · Lesson 7" })).toBeVisible();
    await expect(page.getByText("Push this to tomorrow and adjust accordingly.")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/app?student=${studentId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByText("Rowan’s day")).toBeVisible();
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

function shiftMonthDate(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return value.toISOString().slice(0, 10);
}

function monthDayLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

async function seedScopedOperationsRegression(admin: SupabaseClient<Database>, input: { familyId: string; studentId: string; userId: string; anchorDate: string }) {
  for (let offset = 0; offset < 5100; offset += 500) {
    const count = Math.min(500, 5100 - offset);
    const historical = await admin.from("assignments").insert(Array.from({ length: count }, (_, index) => ({
      family_id: input.familyId,
      student_id: input.studentId,
      created_by: input.userId,
      title: `Browser historical lesson ${offset + index + 1}`,
      subject: "History",
      scheduled_date: "2020-01-02",
      scheduled_time: index % 2 ? "09:00" : null,
    })));
    if (historical.error) throw historical.error;
  }

  const dayAnchor = input.anchorDate;
  const previousDay = dateAfter(dayAnchor, -1);
  const nextDay = dateAfter(dayAnchor, 1);
  const weekAnchor = dateAfter(dayAnchor, 14);
  const nextWeek = dateAfter(weekAnchor, 7);
  const monthAnchor = shiftMonthDate(dateAfter(dayAnchor, 60), 0);
  const nextMonth = shiftMonthDate(monthAnchor, 1);
  const calendarRows = await admin.from("assignments").insert([
    { title: "Scoped previous day", scheduled_date: previousDay },
    { title: "Scoped anchor day", scheduled_date: dayAnchor },
    { title: "Scoped next day", scheduled_date: nextDay },
    { title: "Scoped current week", scheduled_date: weekAnchor },
    { title: "Scoped next week", scheduled_date: nextWeek },
    { title: "Scoped current month", scheduled_date: monthAnchor },
    { title: "Scoped next month", scheduled_date: nextMonth },
  ].map((row) => ({ ...row, family_id: input.familyId, student_id: input.studentId, created_by: input.userId, subject: "Scoped calendar", status: "planned" as const })));
  if (calendarRows.error) throw calendarRows.error;

  const paginationUnit = await admin.from("curriculum_units").insert({ family_id: input.familyId, student_id: input.studentId, created_by: input.userId, subject: "Math", title: "Pagination Math", next_sequence_number: 126 }).select("id").single();
  if (paginationUnit.error) throw paginationUnit.error;
  for (let offset = 0; offset < 125; offset += 50) {
    const count = Math.min(50, 125 - offset);
    const page = await admin.from("assignments").insert(Array.from({ length: count }, (_, index) => ({
      family_id: input.familyId,
      student_id: input.studentId,
      curriculum_unit_id: paginationUnit.data.id,
      created_by: input.userId,
      title: `Pagination Math · Lesson ${offset + index + 1}`,
      subject: "Math",
      sequence_number: offset + index + 1,
      estimated_minutes: 40,
      status: offset + index < 25 ? "completed" as const : "planned" as const,
    })));
    if (page.error) throw page.error;
  }

  const secondStudent = await admin.from("students").insert({ family_id: input.familyId, display_name: "Sage", schedule_preferences: {} }).select("id").single();
  if (secondStudent.error) throw secondStudent.error;
  const secondUnit = await admin.from("curriculum_units").insert({ family_id: input.familyId, student_id: secondStudent.data.id, created_by: input.userId, subject: "Science", title: "Sage Biology", next_sequence_number: 3 }).select("id").single();
  if (secondUnit.error) throw secondUnit.error;
  const secondAssignments = await admin.from("assignments").insert([1, 2].map((sequence) => ({ family_id: input.familyId, student_id: secondStudent.data.id, curriculum_unit_id: secondUnit.data.id, created_by: input.userId, title: `Sage Biology · Lesson ${sequence}`, subject: "Science", sequence_number: sequence, status: "planned" as const })));
  if (secondAssignments.error) throw secondAssignments.error;

  const reviewAssignment = await admin.from("assignments").insert({ family_id: input.familyId, student_id: input.studentId, created_by: input.userId, title: "Review outside loaded dates", subject: "Writing", scheduled_date: "2021-03-01", status: "needs_review", submitted_at: new Date().toISOString() }).select("id").single();
  if (reviewAssignment.error) throw reviewAssignment.error;
  const submission = await admin.from("assignment_submissions").insert({ family_id: input.familyId, assignment_id: reviewAssignment.data.id, student_id: input.studentId, submitted_by: input.userId, status: "ready_for_review", note: "Browser out-of-window review" }).select("id").single();
  if (submission.error) throw submission.error;
  const review = await admin.from("assignment_reviews").insert({ family_id: input.familyId, assignment_id: reviewAssignment.data.id, submission_id: submission.data.id, student_id: input.studentId, status: "draft", draft_feedback: "Browser targeted review hydration" });
  if (review.error) throw review.error;

  const adjustedAssignment = await admin.from("assignments").insert({ family_id: input.familyId, student_id: input.studentId, created_by: input.userId, title: "Adjustment outside loaded dates", subject: "Schedule", scheduled_date: "2021-04-01", status: "planned" }).select("id").single();
  if (adjustedAssignment.error) throw adjustedAssignment.error;
  const version = await admin.from("families").select("agent_context_version").eq("id", input.familyId).single();
  if (version.error) throw version.error;
  const adjustment = await admin.from("adjustment_proposals").insert({ family_id: input.familyId, student_id: input.studentId, week_start: weekAnchor, reason: "Browser targeted hydration", summary: "Adjustment outside loaded dates", status: "proposed", snapshot_version: version.data.agent_context_version }).select("id").single();
  if (adjustment.error) throw adjustment.error;
  const action = await admin.from("adjustment_actions").insert({ family_id: input.familyId, proposal_id: adjustment.data.id, assignment_id: adjustedAssignment.data.id, action_type: "move", before_state: { scheduledDate: "2021-04-01" }, after_state: { scheduledDate: weekAnchor }, position: 0 });
  if (action.error) throw action.error;

  return { dayAnchor, previousDay, nextDay, weekAnchor, nextWeek, monthAnchor, nextMonth, paginationUnitId: paginationUnit.data.id, secondStudentId: secondStudent.data.id };
}
