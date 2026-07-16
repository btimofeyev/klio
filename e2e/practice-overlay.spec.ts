import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const spec = {
  version: 2 as const,
  subject: "Math",
  skill_key: "adding-within-10",
  level_band: "k-2",
  instructions: "Take your time and show what you know.",
  mastery_percent: 80,
  activities: [
    { id: "choice-1", type: "multiple_choice" as const, prompt: "Which sum equals 7?", choices: ["3 + 4", "2 + 3"], correct_answer: "3 + 4", hints: ["Count on from 3."], explanation: "Three plus four equals seven." },
    { id: "answer-1", type: "short_answer" as const, prompt: "Solve 2 + 3.", accepted_answers: ["5"], placeholder: "Type the sum", hints: ["Count on three."], explanation: "Two plus three equals five." },
    { id: "choice-2", type: "multiple_choice" as const, prompt: "Which sum equals 9?", choices: ["4 + 5", "4 + 3"], correct_answer: "4 + 5", hints: ["Count on from 5."], explanation: "Four plus five equals nine." },
  ],
};

const guidedSpec = {
  version: 2 as const,
  subject: "Algebra I",
  skill_key: "algebra.graph-and-explain",
  level_band: "9-12",
  instructions: "Use the equation to graph the line and explain your reasoning. Source context: Internal review evidence should not appear in learner directions.",
  mastery_percent: 80,
  activities: [
    { id: "graph", type: "graph_line" as const, prompt: "Graph the line y = 2x - 3.", expected_slope: 2, expected_y_intercept: -3, x_min: -5, x_max: 5, y_min: -8, y_max: 8, hints: ["Start at the y-intercept."], explanation: "Plot (0, -3), then move right 1 and up 2 to (1, -1)." },
    { id: "explain", type: "written_response" as const, prompt: "Explain why dividing both sides by 4 preserves equality.", success_criteria: ["States that the same operation is used on both sides", "Connects the operation to keeping the equation balanced"], hints: ["Think of an equation as a balance."], explanation: "Dividing both sides by 4 preserves equality because the same nonzero operation is applied to both sides, so the equation remains balanced.", max_length: 400 },
    { id: "solve", type: "short_answer" as const, prompt: "Solve 4x = 20.", accepted_answers: ["5", "x = 5"], hints: ["Divide both sides by 4."], explanation: "Dividing both sides by 4 gives x = 5." },
  ],
};

test("practice stays in a focused overlay and becomes a concise parent outcome", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `practice-overlay-${suffix}@example.test`;
  const password = "KlioPractice123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Practice Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Practice Family");
    await page.getByLabel("Learner’s first name").fill("Noah");
    await page.getByLabel("Learning stage").selectOption("k-2");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Math course or curriculum").fill("Grade 2 Math");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Practice test user not found");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();
    const student = await admin.from("students").select("id").eq("family_id", family.data!.id).single();
    if (family.error ?? student.error) throw family.error ?? student.error;

    const dismissible = await seedPractice(admin, { familyId: family.data!.id, studentId: student.data!.id, userId, suffix: `${suffix}:dismiss`, title: "Curriculum-covered addition" });
    await page.goto("/app");
    await page.getByRole("button", { name: /Practice.*Curriculum-covered addition/ }).click();
    const practicePanel = page.locator("aside[data-spatial-object]");
    await practicePanel.getByRole("button", { name: "No longer needed" }).click();
    await expect(practicePanel.getByText("Why is this no longer needed?")).toBeVisible();
    await expect(practicePanel.getByText("Klio uses this correction when deciding what support to make next.")).toBeVisible();
    await practicePanel.getByRole("button", { name: "Learned it in curriculum" }).click();
    await expect(page.getByRole("status")).toContainText("curriculum work as the better signal");
    await expect(page.getByRole("button", { name: /Practice.*Curriculum-covered addition/ })).toHaveCount(0);
    expect((await admin.from("practice_sessions").select("status,dismissal_reason,dismissed_by,dismissed_at").eq("id", dismissible.sessionId).single()).data).toMatchObject({ status: "dismissed", dismissal_reason: "learned_in_curriculum", dismissed_by: userId });
    expect((await admin.from("parent_agent_corrections").select("correction_kind,domain,corrected_value").eq("target_type", "practice_session").eq("target_entity_id", dismissible.sessionId).single()).data).toMatchObject({ correction_kind: "practice_no_longer_needed", domain: "practice", corrected_value: { status: "dismissed", reason: "learned_in_curriculum" } });
    expect((await admin.from("audit_events").select("action").eq("entity_id", dismissible.sessionId).eq("action", "practice.dismissed").single()).data?.action).toBe("practice.dismissed");
    await expect.poll(async () => (await admin.from("proactive_evaluations").select("status").eq("entity_id", dismissible.sessionId).eq("event_kind", "parent_correction").single()).data?.status).toMatch(/queued|running|completed/);
    expect((await admin.from("klio_insights").select("status").eq("family_id", family.data!.id).contains("action_ref", { practiceSessionId: dismissible.sessionId }).single()).data?.status).toBe("superseded");
    await page.goto(`/app?practice=${dismissible.sessionId}`);
    await expect(page.getByRole("dialog", { name: "Noah practice" })).toHaveCount(0);

    const first = await seedPractice(admin, { familyId: family.data!.id, studentId: student.data!.id, userId, suffix: `${suffix}:mastered`, title: "Addition check" });
    await page.goto(`/app?artifact=${first.artifactId}`);
    const overlay = page.getByRole("dialog", { name: "Noah practice" });
    await expect(overlay).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/app\\?artifact=${first.artifactId}`));
    await expect(overlay.getByText("Addition check")).toBeVisible();
    await expect(overlay.getByText("Noah · Activity 1 of 3")).toBeVisible();
    await expect(overlay.getByRole("progressbar", { name: "Practice progress" })).toHaveAttribute("aria-valuenow", "1");
    await expect(overlay.getByText("Parent answer guide")).toHaveCount(0);
    await overlay.getByRole("button", { name: "Close practice" }).click();
    await expect(overlay).toHaveCount(0);
    await page.waitForTimeout(250);
    await expect(overlay).toHaveCount(0);
    await page.reload();
    await expect(overlay).toBeVisible();
    await overlay.getByRole("button", { name: "3 + 4" }).click();
    await overlay.getByRole("button", { name: "Check answer" }).click();
    await overlay.getByRole("button", { name: "Next" }).click();
    await overlay.getByRole("textbox", { name: "Your answer" }).fill("5");
    await overlay.getByRole("button", { name: "Check answer" }).click();
    await overlay.getByRole("button", { name: "Next" }).click();
    await overlay.getByRole("button", { name: "4 + 5" }).click();
    await overlay.getByRole("button", { name: "Check answer" }).click();
    await overlay.getByRole("button", { name: "Finish" }).click();
    await expect(overlay.getByText("Practice complete")).toBeVisible();
    await expect(overlay.getByText("100%")).toBeVisible();
    await overlay.getByRole("button", { name: "Done" }).click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Noah showed good understanding/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Practice.*Addition check/ })).toHaveCount(0);
    expect((await admin.from("practice_sessions").select("status").eq("id", first.sessionId).single()).data?.status).toBe("completed");
    const savedPracticeResult = await admin.from("practice_results").select("score,mastery_met,scoring_state,evidence_id").eq("practice_session_id", first.sessionId).single();
    expect(savedPracticeResult.data).toMatchObject({ score: 100, mastery_met: true, scoring_state: "final" });
    const filedPracticeEvidence = await admin.from("evidence_categories").select("document_type,categories(name)").eq("evidence_id", savedPracticeResult.data!.evidence_id!).single();
    expect(filedPracticeEvidence.data).toMatchObject({ document_type: "Practice result", categories: { name: "Math" } });

    const second = await seedPractice(admin, { familyId: family.data!.id, studentId: student.data!.id, userId, suffix: `${suffix}:support`, title: "Addition follow-up" });
    await page.goto(`/app?artifact=${second.artifactId}`);
    const supportOverlay = page.getByRole("dialog", { name: "Noah practice" });
    await expect(supportOverlay).toBeVisible();
    await expect(supportOverlay.getByText("Addition follow-up")).toBeVisible();
    await supportOverlay.getByRole("button", { name: "2 + 3" }).click();
    await supportOverlay.getByRole("button", { name: "Check answer" }).click();
    await expect(supportOverlay.getByText("Not yet")).toBeVisible();
    await expect(supportOverlay.getByText("Three plus four equals seven.")).toHaveCount(0);
    await supportOverlay.getByRole("button", { name: "Try again" }).click();
    await supportOverlay.getByRole("button", { name: "Check answer" }).click();
    await supportOverlay.getByRole("button", { name: "Move on for now" }).click();
    await supportOverlay.getByRole("textbox", { name: "Your answer" }).fill("4");
    await supportOverlay.getByRole("button", { name: "Check answer" }).click();
    await supportOverlay.getByRole("button", { name: "Try again" }).click();
    await supportOverlay.getByRole("button", { name: "Check answer" }).click();
    await supportOverlay.getByRole("button", { name: "Move on for now" }).click();
    await supportOverlay.getByRole("button", { name: "4 + 3" }).click();
    await supportOverlay.getByRole("button", { name: "Check answer" }).click();
    await supportOverlay.getByRole("button", { name: "Try again" }).click();
    await supportOverlay.getByRole("button", { name: "Check answer" }).click();
    await supportOverlay.getByRole("button", { name: "Move on for now" }).click();
    await expect(supportOverlay.getByText("0%")).toBeVisible();
    await supportOverlay.getByRole("button", { name: "Done" }).click();
    const supportTab = page.getByRole("button", { name: /still needs support with adding within 10/ });
    await expect(supportTab).toBeVisible();
    await supportTab.click();
    const supportPanel = page.locator("aside[data-spatial-object]");
    await expect(supportPanel.getByRole("button", { name: "Add 10 minutes" })).toBeVisible();
    await expect(supportPanel.getByRole("button", { name: "Make follow-up" })).toBeVisible();
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.route("**/api/practice/*/follow-up", (route) => route.abort("connectionrefused"), { times: 1 });
    await supportPanel.getByRole("button", { name: "Make follow-up" }).click({ force: true });
    await expect(page.getByRole("status")).toContainText("Your practice result is safe—try again");
    expect(pageErrors).toHaveLength(0);
    await supportPanel.getByRole("button", { name: "Make follow-up" }).click({ force: true });
    const followUpOverlay = page.getByRole("dialog", { name: "Noah practice" });
    await expect(followUpOverlay).toBeVisible();
    await expect.poll(async () => (await admin.from("practice_sessions").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id).eq("artifact_id", second.artifactId).eq("status", "ready")).count).toBe(1);
    await followUpOverlay.getByRole("button", { name: "Close practice" }).click();

    const guided = await seedPractice(admin, { familyId: family.data!.id, studentId: student.data!.id, userId, suffix: `${suffix}:guided`, title: "Graphing and explanation guide", practiceSpec: guidedSpec });
    await page.goto(`/app?artifact=${guided.artifactId}`);
    const guidedOverlay = page.getByRole("dialog", { name: "Noah practice" });
    await expect(guidedOverlay.getByText("Plot two points")).toBeVisible();
    await expect(guidedOverlay.getByText("A correct pair is")).toHaveCount(0);
    await expect(guidedOverlay.getByText("(0, -3) and (1, -1)")).toHaveCount(0);
    await expect(guidedOverlay.getByRole("button", { name: "Use these points" })).toHaveCount(0);
    await expect(guidedOverlay.getByText("Internal review evidence")).toHaveCount(0);
    await guidedOverlay.getByLabel("First point x").fill("0");
    await guidedOverlay.getByLabel("First point y").fill("0");
    await guidedOverlay.getByLabel("Second point x").fill("1");
    await guidedOverlay.getByLabel("Second point y").fill("0");
    await guidedOverlay.getByRole("button", { name: "Check answer" }).click();
    await expect(guidedOverlay.getByText("Not yet")).toBeVisible();
    await expect(guidedOverlay.getByText("Plot (0, -3), then move right 1 and up 2 to (1, -1).")).toHaveCount(0);
    await expect(guidedOverlay.getByText("Noah · Activity 1 of 3")).toBeVisible();
    await guidedOverlay.getByRole("button", { name: "Try again" }).click();
    await guidedOverlay.getByLabel("First point x").fill("0");
    await guidedOverlay.getByLabel("First point y").fill("-3");
    await guidedOverlay.getByLabel("Second point x").fill("1");
    await guidedOverlay.getByLabel("Second point y").fill("-1");
    await expect(guidedOverlay.getByLabel("First point x")).toHaveValue("0");
    await expect(guidedOverlay.getByLabel("First point y")).toHaveValue("-3");
    await expect(guidedOverlay.getByLabel("Second point x")).toHaveValue("1");
    await expect(guidedOverlay.getByLabel("Second point y")).toHaveValue("-1");
    await guidedOverlay.getByRole("button", { name: "Check answer" }).click();
    await guidedOverlay.getByRole("button", { name: "Next" }).click();
    await expect(guidedOverlay.getByText("Build a complete response")).toBeVisible();
    await expect(guidedOverlay.getByText("The expected answer stays hidden while you work.", { exact: false })).toBeVisible();
    await expect(guidedOverlay.getByText("A complete answer can say")).toHaveCount(0);
    await expect(guidedOverlay.getByText("Dividing both sides by 4 preserves equality because the same nonzero operation is applied to both sides, so the equation remains balanced.")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(guidedOverlay).toHaveCSS("position", "fixed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await guidedOverlay.locator(".practice-stage h1").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(28);
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

async function seedPractice(admin: SupabaseClient<Database>, input: { familyId: string; studentId: string; userId: string; suffix: string; title: string; practiceSpec?: typeof spec | typeof guidedSpec }) {
  const practiceSpec = input.practiceSpec ?? spec;
  const artifact = await admin.from("artifacts").insert({ family_id: input.familyId, student_id: input.studentId, created_by: input.userId, type: "practice", title: input.title, summary: "A short focused addition check.", content: { practice: practiceSpec }, rationale: "Recent work showed this exact skill needed a quick check.", status: "approved", reviewed_by: input.userId, reviewed_at: new Date().toISOString() }).select("id").single();
  if (artifact.error) throw artifact.error;
  const session = await admin.from("practice_sessions").insert({ family_id: input.familyId, student_id: input.studentId, artifact_id: artifact.data.id, created_by: input.userId, spec: practiceSpec, status: "ready" }).select("id").single();
  if (session.error) throw session.error;
  const insight = await admin.from("klio_insights").insert({ family_id: input.familyId, student_id: input.studentId, kind: "practice_ready", title: "Practice ready", summary: `${input.title} is ready for Noah.`, reason: "Focused support is ready.", priority: 99, evidence_refs: [], action_ref: { type: "practice", artifactId: artifact.data.id, practiceSessionId: session.data.id }, dedupe_key: `practice:${input.suffix}` });
  if (insight.error) throw insight.error;
  return { artifactId: artifact.data.id, sessionId: session.data.id };
}
