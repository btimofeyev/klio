import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("an approved downward trend becomes evidence-linked, scheduled, undoable practice", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `autonomous-${suffix}@example.test`;
  const password = "KlioAutonomous123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Autonomous Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Autonomous Family");
    await page.getByLabel("Learner’s first name").fill("Jacob");
    await page.getByLabel("Learning stage").selectOption("6-8");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByLabel("Science course or curriculum").fill("Biology");
    await page.getByLabel("Autopilot", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Autonomous test user not found");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();
    const student = await admin.from("students").select("id").eq("family_id", family.data!.id).single();
    if (family.error ?? student.error) throw family.error ?? student.error;

    const scores = [86, 78, 69];
    const dates = ["2026-07-06", "2026-07-08", "2026-07-10"];
    let draftReviewId = "";
    for (let index = 0; index < scores.length; index += 1) {
      const assignment = await admin.from("assignments").insert({ family_id: family.data!.id, student_id: student.data!.id, created_by: userId, title: `Biology · Osmosis ${index + 1}`, subject: "Biology", scheduled_date: dates[index], estimated_minutes: 35, sequence_number: index + 1 }).select("id").single();
      if (assignment.error) throw assignment.error;
      const submission = await admin.from("assignment_submissions").insert({ family_id: family.data!.id, assignment_id: assignment.data.id, student_id: student.data!.id, submitted_by: userId, status: index === 2 ? "ready_for_review" : "reviewed", note: "Explain how concentration affects water movement across a membrane.", submitted_at: `${dates[index]}T15:00:00Z` }).select("id").single();
      if (submission.error) throw submission.error;
      const review = await admin.from("assignment_reviews").insert({ family_id: family.data!.id, assignment_id: assignment.data.id, submission_id: submission.data.id, student_id: student.data!.id, status: index === 2 ? "draft" : "approved", grading_state: index === 2 ? "provisional" : "final", written_review_required: true, written_review_completed: index !== 2, score: index === 2 ? null : scores[index], draft_score: index === 2 ? scores[index] : null, feedback: index === 2 ? null : "The explanation needs a clearer link between concentration and water movement.", draft_feedback: index === 2 ? "Jacob identifies water movement but does not consistently explain why it moves." : null, reviewed_by: index === 2 ? null : userId, reviewed_at: index === 2 ? null : `${dates[index]}T16:00:00Z`, skill_key: index === 2 ? null : "osmosis-explanations", comparable_key: index === 2 ? null : "osmosis-explanations", evidence_kind: "curriculum", mastery_signals: [{ skill: "Osmosis explanations", status: "developing" }] }).select("id").single();
      if (review.error) throw review.error;
      if (index === 2) draftReviewId = review.data.id;
    }

    expect((await admin.from("assignment_reviews").select("score,status").eq("id", draftReviewId).single()).data).toEqual({ score: null, status: "draft" });
    await page.goto("/app/review");
    const review = page.locator(".grade-review").filter({ hasText: "Biology · Osmosis 3" });
    await expect(review.getByRole("spinbutton", { name: "Klio’s suggested score %" })).toHaveValue("69");
    await review.getByRole("button", { name: "Looks right — approve" }).click();
    await expect(page.getByText(/review was approved/)).toBeVisible();
    expect((await admin.from("assignment_reviews").select("score,status").eq("id", draftReviewId).single()).data).toEqual({ score: 69, status: "approved" });
    await expect.poll(async () => (await admin.from("proactive_evaluations").select("status").eq("family_id", family.data!.id).eq("entity_id", draftReviewId).single()).data?.status, { timeout: 15_000 }).toBe("completed");
    const evaluationState = await admin.from("proactive_evaluations").select("status,outcome,error_code,summary").eq("family_id", family.data!.id).eq("entity_id", draftReviewId).single();
    expect(evaluationState.data).toMatchObject({ status: "completed", outcome: "automatic_action", error_code: null });

    await page.goto("/app");
    await page.getByRole("navigation", { name: "Right workspace tabs" }).getByRole("button", { name: /Klio noticed/ }).click();
    const noticedPanel = page.locator("aside[data-spatial-object]");
    await expect(noticedPanel.locator(".teacher-note-insight > strong")).toHaveText("Biology explanations have become less consistent", { timeout: 15_000 });
    await expect(noticedPanel.getByText(/made a \d+-minute osmosis explanations practice/)).toBeVisible();
    await expect(noticedPanel.locator("header")).toHaveText("Schedule");
    const panelBox = await noticedPanel.boundingBox();
    expect(panelBox?.height).toBeLessThan(400);
    await expect(noticedPanel.locator(".teacher-note-insight")).toHaveCSS("background-color", "rgb(255, 254, 250)");
    await expect(noticedPanel.getByRole("button", { name: "Start practice" })).toHaveCSS("background-color", "rgb(80, 106, 84)");
    await expect(noticedPanel.getByRole("button", { name: "Undo" })).toBeVisible();
    await noticedPanel.getByRole("link", { name: "Show evidence" }).click();
    await expect(page).toHaveURL(/\/app\/activity/);
    const evidenceRow = page.locator(".activity-row").filter({ hasText: "Biology explanations have become less consistent" });
    await evidenceRow.locator("summary").click();
    await expect(page.getByText(/86% · osmosis explanations/)).toBeVisible();
    await expect(page.getByText(/78% · osmosis explanations/)).toBeVisible();
    await expect(page.getByText(/69% · osmosis explanations/)).toBeVisible();

    const practiceAssignment = await admin.from("assignments").select("scheduled_date").eq("family_id", family.data!.id).eq("student_id", student.data!.id).eq("source_kind", "practice").single();
    if (practiceAssignment.error || !practiceAssignment.data.scheduled_date) throw practiceAssignment.error ?? new Error("Scheduled practice not found");
    await page.goto(`/app/week?date=${practiceAssignment.data.scheduled_date}`);
    await expect(page.locator(".teacher-week-item.supplemental").filter({ hasText: "Biology" })).toBeVisible();
    await page.goto(`/app/records?student=${student.data!.id}`);
    await expect(page.getByRole("heading", { name: "What Klio is watching" })).toBeVisible();
    await expect(page.getByText("3 supporting records")).toBeVisible();
    await page.goto("/app/settings?view=autonomy");
    await expect(page.getByRole("heading", { name: "How independently should Klio work?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Autopilot/ })).toHaveClass(/selected/);

    await page.goto("/app");
    await page.getByRole("navigation", { name: "Right workspace tabs" }).getByRole("button", { name: /Klio noticed/ }).click();
    await page.locator("aside[data-spatial-object]").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await admin.from("assignments").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id).eq("student_id", student.data!.id).eq("source_kind", "practice")).count).toBe(0);

    const dismissible = await admin.from("klio_insights").insert([1, 2].map((index) => ({
      family_id: family.data!.id,
      student_id: student.data!.id,
      kind: "noticed",
      title: "Filing is complete",
      summary: index === 1 ? "Klio organized the submitted Biology work." : "Klio filed the related review record.",
      priority: 100 - index,
      dedupe_key: `dismiss:${suffix}:${index}`,
    }))).select("id");
    expect(dismissible.error).toBeNull();
    await page.goto("/app");
    const dismissibleTab = page.getByRole("button", { name: /Filing is complete/ });
    await expect(dismissibleTab).toHaveCount(1);
    await dismissibleTab.click();
    await page.locator("aside[data-spatial-object]").getByRole("button", { name: "Dismiss" }).click();
    await expect(dismissibleTab).toHaveCount(0);
    await expect(page.locator("aside[data-spatial-object]")).toHaveCount(0);
    await expect.poll(async () => (await admin.from("klio_insights").select("id", { count: "exact", head: true }).in("id", dismissible.data!.map((item) => item.id)).eq("status", "dismissed")).count).toBe(2);
    const repeatedDismiss = await page.evaluate(async (insightId) => {
      const response = await fetch(`/api/insights/${insightId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) });
      return { status: response.status, body: await response.json() };
    }, dismissible.data![0].id);
    expect(repeatedDismiss).toMatchObject({ status: 200, body: { status: "dismissed", alreadyResolved: true, dismissedCount: 0 } });
    await page.reload();
    await expect(page.getByRole("button", { name: /Filing is complete/ })).toHaveCount(0);
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
