import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { dateInTimezone } from "@/lib/schedule/dates";

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
    const family = await admin.from("families").select("id,timezone").eq("created_by", userId).single();
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
    await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "false");
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
    const currentDate = dateInTimezone(new Date(), family.data.timezone);
    const todayLink = page.getByRole("link", { name: "Today", exact: true });
    await expect(todayLink).toHaveAttribute("href", `/app?date=${currentDate}&student=${studentId}`);
    await todayLink.click();
    await expect(page).toHaveURL(`/app?date=${currentDate}&student=${studentId}`);
    await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.goto(`/app/week?date=${regression.monthAnchor}&student=${studentId}&view=month`);
    await expect(page.getByRole("region", { name: monthDayLabel(regression.monthLessonDate) })).toContainText("1 lesson");
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.nextMonth}.*student=${studentId}.*view=month`));
    await expect(page.getByRole("region", { name: monthDayLabel(regression.nextMonthLessonDate) })).toContainText("1 lesson");
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${regression.monthAnchor}.*student=${studentId}.*view=month`));
    await page.getByRole("region", { name: monthDayLabel(regression.monthLessonDate) }).getByRole("button", { name: String(Number(regression.monthLessonDate.slice(-2))), exact: true }).click();
    await page.getByRole("button", { name: "Open this week" }).click();
    await expect(page).toHaveURL(`/app/week?date=${regression.monthLessonDate}&student=${studentId}`);
    await expect(page.getByText("Scoped current month", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.goto(`/app/assignments?student=${studentId}&unit=${regression.paginationUnitId}`);
    await expect(page.getByText("125 lessons · 25 completed · 100 active", { exact: true })).toBeVisible();
    const seenLessons = new Set<string>();
    const nextLessons = page.getByRole("button", { name: "Next lessons" });
    const lessonRange = page.locator(".lesson-dashboard > header strong");
    for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
      const rangeStart = pageIndex * 5 + 1;
      await expect(lessonRange).toHaveText(`${rangeStart}–${rangeStart + 4} of 125`);
      await expect(page.locator(".assignment-library .ops-assignment")).toHaveCount(5);
      for (const title of await page.locator(".assignment-library .ops-assignment strong").allTextContents()) seenLessons.add(title);
      if (pageIndex < 24) await nextLessons.click();
    }
    expect(seenLessons.size).toBe(125);
    await expect(nextLessons).toBeDisabled();

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
    await expect(algebraCurriculum.getByText("0 of 100 completed")).toBeVisible();
    await algebraCurriculum.getByRole("button", { name: "Edit course details" }).click();
    await expect(page.getByLabel("Curriculum or course")).toHaveValue("Algebra I");
    await expect(page.getByLabel("Subject")).toHaveValue("Math");
    await expect(page.getByLabel("Items this school year")).toHaveValue("100");
    await page.getByLabel("Typical minutes").fill("45");
    await page.getByRole("button", { name: "Save course" }).click();
    await expect(page.getByText("100 unscheduled Math lessons are ready. Plan the week when you’re ready.")).toBeVisible();
    const algebraUnit = await admin.from("curriculum_units").select("id").eq("family_id", familyId).eq("title", "Algebra I").single();
    if (algebraUnit.error) throw algebraUnit.error;
    const stableLessons = await admin.from("assignments").select("id,title,subject,student_id,sequence_number").eq("family_id", familyId).eq("curriculum_unit_id", algebraUnit.data.id).in("sequence_number", [6, 7, 8]).order("sequence_number");
    if (stableLessons.error) throw stableLessons.error;
    for (const lesson of stableLessons.data) {
      const scheduledDate = dateAfter(nextMonday(), lesson.sequence_number! - 6);
      const updated = await admin.from("assignments").update({ scheduled_date: scheduledDate, scheduled_time: "09:00", estimated_minutes: 45 }).eq("id", lesson.id);
      if (updated.error) throw updated.error;
      const placement = await admin.from("weekly_plan_items").insert({ family_id: familyId, student_id: lesson.student_id, assignment_id: lesson.id, artifact_id: null, title: lesson.title, subject: lesson.subject, scheduled_date: scheduledDate, scheduled_time: "09:00", estimated_minutes: 45, source_kind: "klio", position: lesson.sequence_number! - 6 });
      if (placement.error) throw placement.error;
    }
    await page.reload();
    await page.getByRole("button", { name: "Next lessons" }).click();
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
    await expect(noteConversation.locator(".conversation-parent > p")).toHaveText("Did great on this today.");
    expect(noteRequest).toMatchObject({ request: "Did great on this today." });
    await noteConversation.locator(".klio-conversation-controls").getByRole("button", { name: "New conversation" }).click();
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

test("generic curriculum scope keeps stable IDs while materials and verified outlines enrich safe lessons", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = crypto.randomUUID();
  const email = `scope-${suffix}@example.test`;
  const password = "KlioScope123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  let otherUserId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Scope Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Scope Family");
    await page.getByLabel("Learner’s first name").fill("Avery");
    await page.getByLabel("Add a subject").selectOption("Language Arts");
    await page.getByLabel("Language Arts course or curriculum").fill("7th grade > English > Curriculum > BJU Press");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Scope user not found");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();
    const student = await admin.from("students").select("id").eq("family_id", family.data!.id).single();
    const unit = await admin.from("curriculum_units").select("id,identity_status").eq("family_id", family.data!.id).single();
    expect(unit.data?.identity_status).toBe("recognized");
    const initial = await admin.from("assignments").select("id,sequence_number,scheduled_date").eq("family_id", family.data!.id).eq("curriculum_unit_id", unit.data!.id).order("sequence_number");
    expect(initial.data).toHaveLength(100);
    expect(initial.data?.every((assignment) => assignment.scheduled_date === null)).toBe(true);
    expect((await admin.from("weekly_plan_items").select("id").eq("family_id", family.data!.id)).data).toEqual([]);
    const stableIds = new Set(initial.data!.map((assignment) => assignment.id));

    await page.goto("/app/assignments");
    await page.getByRole("button", { name: "7th grade > English > Curriculum > BJU Press", exact: true }).click();
    await expect(page.getByText("Recognized course · edition unverified", { exact: true })).toBeVisible();
    await page.goto("/app/week");
    await page.getByRole("button", { name: "Build this week" }).first().click();
    await expect(page.getByText(/Klio planned Avery’s week/)).toBeVisible();
    const planned = await admin.from("assignments").select("id,sequence_number,scheduled_date").eq("family_id", family.data!.id).eq("curriculum_unit_id", unit.data!.id).order("sequence_number");
    expect(planned.data).toHaveLength(100);
    expect(new Set(planned.data!.map((assignment) => assignment.id))).toEqual(stableIds);
    const scheduledSequences = planned.data!.filter((assignment) => assignment.scheduled_date).map((assignment) => assignment.sequence_number);
    expect(scheduledSequences.length).toBeGreaterThan(0);
    expect(scheduledSequences).toEqual(Array.from({ length: scheduledSequences.length }, (_, index) => index + 1));

    await page.goto(`/app/assignments?student=${student.data!.id}&unit=${unit.data!.id}`);
    const lessonOne = page.locator(".curriculum-assignment-row").filter({ hasText: "Lesson 1" }).first();
    await lessonOne.getByText("Add material", { exact: false }).click();
    await lessonOne.locator('input[type="file"]').setInputFiles({ name: "teacher-page.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
    await expect(lessonOne.getByText("Material saved.", { exact: false })).toBeVisible();
    const lessonOneId = initial.data!.find((assignment) => assignment.sequence_number === 1)!.id;
    await expect.poll(async () => (await admin.from("assignment_materials").select("evidence_id").eq("assignment_id", lessonOneId)).data?.length ?? 0).toBe(1);
    const material = await admin.from("assignment_materials").select("evidence_id").eq("assignment_id", lessonOneId).single();
    await expect.poll(async () => (await admin.from("curriculum_material_suggestions").select("id", { count: "exact", head: true }).eq("assignment_id", lessonOneId).eq("evidence_id", material.data!.evidence_id)).count ?? 0).toBeGreaterThan(0);
    const stoppedExtraction = await admin.from("curriculum_material_suggestions").update({ status: "failed", error_code: "EXTRACTION_FAILED" }).eq("assignment_id", lessonOneId).eq("evidence_id", material.data!.evidence_id).in("status", ["queued", "processing"]);
    if (stoppedExtraction.error) throw stoppedExtraction.error;
    const lessonBefore = await admin.from("assignments").select("version").eq("id", lessonOneId).single();
    const readyMaterial = await admin.from("curriculum_material_suggestions").insert({ family_id: family.data!.id, assignment_id: lessonOneId, evidence_id: material.data!.evidence_id, requested_by: userId, status: "ready", proposed_title: "Synthetic grammar review", proposed_kind: "review", proposed_instructions: "Review the examples, then discuss the pattern.", proposed_minutes: 25, proposed_path: ["Unit 1", "Grammar"], confidence: 0.9, rationale: "Synthetic browser fixture", before_snapshot: { version: lessonBefore.data!.version } }).select("id").single();
    if (readyMaterial.error) throw readyMaterial.error;
    await page.reload();
    const refreshedLessonOne = page.locator(".curriculum-assignment-row").filter({ hasText: "Lesson 1" }).first();
    await refreshedLessonOne.getByText("Add material", { exact: false }).click();
    await expect(refreshedLessonOne.getByText("Review Klio’s suggestion")).toBeVisible();
    await refreshedLessonOne.getByRole("button", { name: "Apply suggestion" }).click();
    await expect(refreshedLessonOne.getByText("Suggestion applied to this stable lesson.")).toBeVisible();
    const enriched = await admin.from("assignments").select("id,title,curriculum_item_kind,estimated_minutes,curriculum_path").eq("id", lessonOneId).single();
    expect(enriched.data).toMatchObject({ id: lessonOneId, title: "Synthetic grammar review", curriculum_item_kind: "review", estimated_minutes: 25, curriculum_path: ["Unit 1", "Grammar"] });
    expect((await admin.from("weekly_plan_items").select("title").eq("assignment_id", lessonOneId).single()).data?.title).toBe("Synthetic grammar review");

    const secondEvidence = await admin.from("evidence_items").insert({ family_id: family.data!.id, created_by: userId, kind: "note", raw_text: "Synthetic duration source" }).select("id").single();
    await admin.from("assignment_materials").insert({ family_id: family.data!.id, assignment_id: lessonOneId, evidence_id: secondEvidence.data!.id, role: "supporting", position: 2 });
    const currentVersion = await admin.from("assignments").select("version").eq("id", lessonOneId).single();
    const durationSuggestion = await admin.from("curriculum_material_suggestions").insert({ family_id: family.data!.id, assignment_id: lessonOneId, evidence_id: secondEvidence.data!.id, requested_by: userId, status: "ready", proposed_title: "Too-long grammar review", proposed_kind: "review", proposed_minutes: 480, before_snapshot: { version: currentVersion.data!.version } }).select("id").single();
    const rejectedDuration = await page.evaluate(async ({ assignmentId, suggestionId }) => { const response = await fetch(`/api/assignments/${assignmentId}/materials`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply", suggestionId }) }); return response.status; }, { assignmentId: lessonOneId, suggestionId: durationSuggestion.data!.id });
    expect(rejectedDuration).toBe(409);
    expect((await admin.from("assignments").select("estimated_minutes").eq("id", lessonOneId).single()).data?.estimated_minutes).toBe(25);
    expect((await admin.from("assignment_materials").select("evidence_id").eq("evidence_id", secondEvidence.data!.id)).data).toHaveLength(1);

    const lessonTwo = initial.data!.find((assignment) => assignment.sequence_number === 2)!;
    await admin.from("assignments").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", lessonTwo.id);
    const historyEvidence = await admin.from("evidence_items").insert({ family_id: family.data!.id, created_by: userId, kind: "note", raw_text: "Historical source" }).select("id").single();
    await admin.from("assignment_materials").insert({ family_id: family.data!.id, assignment_id: lessonTwo.id, evidence_id: historyEvidence.data!.id });
    const historyVersion = await admin.from("assignments").select("version,title").eq("id", lessonTwo.id).single();
    const historySuggestion = await admin.from("curriculum_material_suggestions").insert({ family_id: family.data!.id, assignment_id: lessonTwo.id, evidence_id: historyEvidence.data!.id, requested_by: userId, status: "ready", proposed_title: "Should not replace history", before_snapshot: { version: historyVersion.data!.version } }).select("id").single();
    const historicalDecision = await page.evaluate(async ({ assignmentId, suggestionId }) => { const response = await fetch(`/api/assignments/${assignmentId}/materials`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply", suggestionId }) }); return { status: response.status, body: await response.json() }; }, { assignmentId: lessonTwo.id, suggestionId: historySuggestion.data!.id });
    expect(historicalDecision).toMatchObject({ status: 200, body: { historicalProtected: true } });
    expect((await admin.from("assignments").select("title").eq("id", lessonTwo.id).single()).data?.title).toBe(historyVersion.data!.title);

    const increased = await page.evaluate(async (unitId) => { const response = await fetch(`/api/curriculum/${unitId}/scope`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetLessonCount: 110 }) }); return response.status; }, unit.data!.id);
    expect(increased).toBe(200);
    expect((await admin.from("assignments").select("id").eq("curriculum_unit_id", unit.data!.id)).data).toHaveLength(110);
    await admin.from("assignments").update({ curriculum_item_state: "enriched" }).eq("curriculum_unit_id", unit.data!.id).eq("sequence_number", 110);
    const unsafeReduction = await page.evaluate(async (unitId) => { const response = await fetch(`/api/curriculum/${unitId}/scope`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetLessonCount: 100 }) }); return response.status; }, unit.data!.id);
    expect(unsafeReduction).toBe(409);
    expect((await admin.from("assignments").select("id").eq("curriculum_unit_id", unit.data!.id)).data).toHaveLength(110);

    const scopeEvidence = await admin.from("evidence_items").insert({ family_id: family.data!.id, created_by: userId, kind: "note", raw_text: "Synthetic edition evidence" }).select("id").single();
    const verifiedProposal = await admin.from("curriculum_scope_suggestions").insert({ family_id: family.data!.id, curriculum_unit_id: unit.data!.id, requested_by: userId, status: "ready", publisher: "BJU Press", product_name: "Language Arts", grade_label: "Grade 7", edition_label: "2024", identity_status: "verified", source_kind: "parent_evidence", source_fingerprint: `edition-2024-${suffix}`, source_evidence_ids: [scopeEvidence.data!.id], confidence: 0.95, assumptions: [], proposed_target_count: 110, proposed_items: [{ sequenceNumber: 2, title: "Protected synthetic title", kind: "lesson", path: ["Unit 1"], minutes: 40, confidence: 0.9 }, { sequenceNumber: 3, title: "Verified synthetic title", kind: "assessment", path: ["Unit 1"], minutes: 40, confidence: 0.9 }], before_snapshot: { pacing: { sourceGranularity: "daily_session", containerLabel: null, containerCount: null, recommendedWeeklyFrequency: 3, recommendedWeekCount: null, recommendedSessionCount: 110, minutesPerSession: 50, confidence: 0.95 } } }).select("id,source_fingerprint").single();
    await admin.from("curriculum_scope_suggestion_evidence").insert({ family_id: family.data!.id, suggestion_id: verifiedProposal.data!.id, evidence_id: scopeEvidence.data!.id });
    await admin.from("curriculum_scope_suggestions").update({ status: "superseded" }).eq("family_id", family.data!.id).eq("curriculum_unit_id", unit.data!.id).in("source_kind", ["model_prior", "web_search"]).in("status", ["queued", "processing", "ready"]);
    await page.goto(`/app/assignments?student=${student.data!.id}&unit=${unit.data!.id}`);
    await expect(page.getByRole("button", { name: "Research again" })).toBeVisible();
    await page.getByRole("button", { name: "Review outline" }).click();
    await expect(page.getByRole("button", { name: "Use suggested outline" })).toBeVisible();
    await expect(page.locator('input[name="title-3"]')).toHaveValue("Verified synthetic title");
    await expect(page.getByRole("checkbox", { name: /Lesson 2/ })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /Lesson 3/ })).toBeChecked();
    await page.getByRole("button", { name: "Use suggested outline" }).click();
    await expect(page.getByText("Suggested outline applied to safe stable lessons.")).toBeVisible();
    const outlineRows = await admin.from("assignments").select("sequence_number,title,id").eq("curriculum_unit_id", unit.data!.id).in("sequence_number", [2, 3]).order("sequence_number");
    expect(outlineRows.data?.[0].title).toBe(historyVersion.data!.title);
    expect(outlineRows.data?.[1]).toMatchObject({ id: initial.data!.find((assignment) => assignment.sequence_number === 3)!.id, title: "Verified synthetic title" });
    expect((await admin.from("curriculum_units").select("identity_status,edition_label,default_minutes,schedule_rule").eq("id", unit.data!.id).single()).data).toMatchObject({ identity_status: "verified", edition_label: "2024", default_minutes: 50, schedule_rule: { weeklyFrequency: 3 } });
    const secondEdition = await admin.from("curriculum_scope_suggestions").insert({ family_id: family.data!.id, curriculum_unit_id: unit.data!.id, requested_by: userId, status: "dismissed", publisher: "BJU Press", product_name: "Language Arts", edition_label: "2025", identity_status: "verified", source_kind: "parent_evidence", source_fingerprint: `edition-2025-${suffix}` }).select("source_fingerprint").single();
    expect(secondEdition.data!.source_fingerprint).not.toBe(verifiedProposal.data!.source_fingerprint);

    const other = await admin.auth.admin.createUser({ email: `other-scope-${suffix}@example.test`, password, email_confirm: true });
    if (other.error || !other.data.user) throw other.error ?? new Error("Other scope user not found");
    otherUserId = other.data.user.id;
    const otherFamily = await admin.from("families").insert({ name: "Other scope family", created_by: otherUserId }).select("id").single();
    const otherStudent = await admin.from("students").insert({ family_id: otherFamily.data!.id, display_name: "Other learner" }).select("id").single();
    const otherAssignment = await admin.from("assignments").insert({ family_id: otherFamily.data!.id, student_id: otherStudent.data!.id, created_by: otherUserId, title: "Other private lesson", subject: "Math" }).select("id").single();
    const denied = await page.evaluate(async (assignmentId) => (await fetch(`/api/assignments/${assignmentId}/materials`)).status, otherAssignment.data!.id);
    expect(denied).toBe(404);
  } finally {
    if (userId) { await admin.from("families").delete().eq("created_by", userId); await admin.auth.admin.deleteUser(userId); }
    if (otherUserId) { await admin.from("families").delete().eq("created_by", otherUserId); await admin.auth.admin.deleteUser(otherUserId); }
  }
});

test("researches curriculum structure before creating stable assignments", async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = crypto.randomUUID();
  const email = `research-first-${suffix}@example.test`;
  const password = "KlioResearch123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Research Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Research First Family");
    await page.getByLabel("Learner’s first name").fill("Mara");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByLabel("Science course or curriculum").fill("General Science");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Research-first user not found");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();

    await page.route("**/api/curriculum/research", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ research: {
      proposal: {
        identity: { publisher: "Apologia", productName: "Physical Science", subject: "Science", gradeLabel: "Grade 8", editionLabel: "4th edition", isbn: null },
        targetLessonCount: 8,
        assumptions: ["The publisher confirms two modules paced over two weeks at four sessions per week."],
        items: Array.from({ length: 8 }, (_, index) => ({ sequenceNumber: index + 1, title: `Module ${index < 4 ? 1 : 2}: Source-backed topic · Session ${(index % 4) + 1}`, kind: "lesson", path: [`Module ${index < 4 ? 1 : 2}: Source-backed topic`], minutes: 60, confidence: 0.94 })),
        confidence: 0.94,
      },
      sources: [{ url: "https://publisher.example/physical-science", title: "Physical Science scope" }],
      pacing: { sourceGranularity: "container", containerLabel: "Module", containerCount: 2, recommendedWeeklyFrequency: 4, recommendedWeekCount: 2, recommendedSessionCount: 8, minutesPerSession: 60, confidence: 0.94 },
      structure: { sequenceLabel: "Lesson", detectedItemCount: 8, isCompleteDetectedOutline: true, containerLabel: "Module", containerCount: 2, expandedFromContainers: true },
    } }) }));

    await page.goto("/app/assignments");
    await page.getByRole("button", { name: "Add curriculum" }).click();
    await page.getByLabel("Curriculum or course").fill("Physical Science Research Edition");
    await page.getByLabel("Subject").fill("Science");
    await page.locator('input[name="file"]').setInputFiles({ name: "table-of-contents.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic curriculum source") });
    await page.getByRole("button", { name: "Research before creating" }).click();
    await expect(page.getByText("8 daily sessions", { exact: true })).toBeVisible();
    await expect(page.getByText("Use 8 daily sessions", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Items this school year")).toHaveValue("8");
    await expect(page.getByLabel("Numbering")).toHaveValue("Lesson");
    await expect(page.locator('.curriculum-drawer select[name="weeklyFrequency"]')).toHaveValue("4");
    await expect(page.locator('.curriculum-drawer input[name="estimatedMinutes"]')).toHaveValue("60");
    await page.getByRole("button", { name: "Create 8 daily sessions" }).click();
    await expect(page.getByText("8 unscheduled Science daily sessions are ready. Plan the week when you’re ready.")).toBeVisible();

    const unit = await admin.from("curriculum_units").select("id,target_lesson_count,sequence_label,default_minutes,schedule_rule").eq("family_id", family.data!.id).eq("title", "Physical Science Research Edition").single();
    expect(unit.data).toMatchObject({ target_lesson_count: 8, sequence_label: "Lesson", default_minutes: 60, schedule_rule: { weeklyFrequency: 4 } });
    const assignments = await admin.from("assignments").select("sequence_number,title,curriculum_item_state,curriculum_path").eq("curriculum_unit_id", unit.data!.id).order("sequence_number");
    expect(assignments.data).toHaveLength(8);
    expect(assignments.data?.[0]).toMatchObject({ sequence_number: 1, title: "Module 1: Source-backed topic · Session 1", curriculum_path: ["Module 1: Source-backed topic"] });
    expect(assignments.data?.at(-1)).toMatchObject({ sequence_number: 8, title: "Module 2: Source-backed topic · Session 4", curriculum_path: ["Module 2: Source-backed topic"] });
    expect(assignments.data?.every((assignment) => assignment.curriculum_item_state === "enriched")).toBe(true);
    const suggestion = await admin.from("curriculum_scope_suggestions").select("status,proposed_target_count,source_urls").eq("curriculum_unit_id", unit.data!.id).single();
    expect(suggestion.data).toMatchObject({ status: "applied", proposed_target_count: 8 });
    const pacingReview = await admin.from("curriculum_scope_suggestions").insert({ family_id: family.data!.id, curriculum_unit_id: unit.data!.id, requested_by: userId, status: "ready", publisher: "Apologia", product_name: "Physical Science", edition_label: "4th edition", identity_status: "verified", source_kind: "web_search", source_fingerprint: `pacing-review-${suffix}`, confidence: 0.94, assumptions: ["Synthetic pacing review"], proposed_target_count: 8, proposed_items: Array.from({ length: 8 }, (_, index) => ({ sequenceNumber: index + 1, title: `Module ${index < 4 ? 1 : 2}: Source-backed topic · Session ${(index % 4) + 1}`, kind: "lesson", path: [`Module ${index < 4 ? 1 : 2}: Source-backed topic`], minutes: 60, confidence: 0.94 })), before_snapshot: { pacing: { sourceGranularity: "container", containerLabel: "Module", containerCount: 2, recommendedWeeklyFrequency: 4, recommendedWeekCount: 2, recommendedSessionCount: 8, minutesPerSession: 60, confidence: 0.94 }, expandedFromContainers: true } }).select("id").single();
    if (pacingReview.error) throw pacingReview.error;
    await page.reload();
    await page.getByRole("button", { name: "Physical Science Research Edition", exact: true }).click();
    await page.getByRole("button", { name: "Review outline" }).click();
    await expect(page.getByRole("region", { name: "Proposed course pacing" })).toContainText("2 modules");
    await expect(page.getByRole("region", { name: "Proposed course pacing" })).toContainText("8 sessions");
    const pacingApplyResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/api/curriculum/${unit.data!.id}/scope-suggestions`));
    await page.getByRole("button", { name: "Use 2-week schedule" }).click();
    const pacingApply = await pacingApplyResponse;
    expect({ status: pacingApply.status(), body: await pacingApply.text() }).toMatchObject({ status: 200 });
    await expect(page.getByText("Suggested outline applied to safe stable lessons.")).toBeVisible({ timeout: 15_000 });
    expect((await admin.from("curriculum_scope_suggestions").select("status").eq("id", pacingReview.data.id).single()).data?.status).toBe("applied");
  } finally {
    if (userId) { await admin.from("families").delete().eq("created_by", userId); await admin.auth.admin.deleteUser(userId); }
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

function firstTeachingDayOfMonth(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
  if (value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() + 2);
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
  const monthLessonDate = firstTeachingDayOfMonth(monthAnchor);
  const nextMonthLessonDate = firstTeachingDayOfMonth(nextMonth);
  const calendarRows = await admin.from("assignments").insert([
    { title: "Scoped previous day", scheduled_date: previousDay },
    { title: "Scoped anchor day", scheduled_date: dayAnchor },
    { title: "Scoped next day", scheduled_date: nextDay },
    { title: "Scoped current week", scheduled_date: weekAnchor },
    { title: "Scoped next week", scheduled_date: nextWeek },
    { title: "Scoped current month", scheduled_date: monthLessonDate },
    { title: "Scoped next month", scheduled_date: nextMonthLessonDate },
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

  return { dayAnchor, previousDay, nextDay, weekAnchor, nextWeek, monthAnchor, monthLessonDate, nextMonth, nextMonthLessonDate, paginationUnitId: paginationUnit.data.id, secondStudentId: secondStudent.data.id };
}
