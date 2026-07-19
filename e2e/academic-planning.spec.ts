import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

test("a parent creates an academic term and a normalized subject pacing goal", async ({ page }) => {
  const suffix = crypto.randomUUID(); const email = `academic-plan-${suffix}@example.test`; const password = "KlioAcademic123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Planning Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Academic Plan Family");
    await page.getByLabel("Learner’s first name").fill("Morgan");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByLabel("Science course or curriculum").fill("Biology");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings?view=academic");

    await page.getByLabel("Name", { exact: true }).fill("2026–27 school year");
    await page.getByLabel("Starts").fill("2026-08-03");
    await page.getByLabel("Ends").fill("2027-05-28");
    await page.getByRole("button", { name: "Save term" }).click();
    await expect(page.getByText("Academic term saved.")).toBeVisible();
    await expect(page.getByLabel("Term")).toContainText("2026–27 school year");

    await page.getByLabel("Goal").fill("Complete Biology by the end of the term");
    await page.getByLabel("Target lesson").fill("36");
    await page.getByLabel("Complete by").fill("2027-05-28");
    await page.getByLabel("Times each week").fill("4");
    await page.getByLabel("Minutes each week").fill("180");
    await page.getByRole("button", { name: "Save pacing goal" }).click();
    await expect(page.getByText("Subject pacing goal saved.")).toBeVisible();

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Academic planning user not found");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();
    const goal = await admin.from("learning_goals").select("id,student_id,term_id,title,subject,status,weekly_cadence,weekly_effort_minutes,target_date,priority,academic_terms(name),curriculum_pacing_targets(target_sequence,target_completion_date,weekly_cadence)").eq("family_id", family.data!.id).single();
    expect(goal.data).toMatchObject({ title: "Complete Biology by the end of the term", subject: "Science", status: "active", weekly_cadence: 4, weekly_effort_minutes: 180 });
    expect(goal.data?.academic_terms).toMatchObject({ name: "2026–27 school year" });
    expect(goal.data?.curriculum_pacing_targets[0]).toMatchObject({ target_sequence: 36, target_completion_date: "2027-05-28", weekly_cadence: 4 });
    const current = await admin.from("families").select("agent_context_version").eq("id", family.data!.id).single();
    const proposal = await admin.from("planning_proposals").insert({ family_id: family.data!.id, student_id: goal.data!.student_id, proposal_kind: "learner_goal", action_name: "update_goal", risk: "moderate", title: "Prioritize Biology", summary: "Raise this parent-defined Biology goal priority.", reason: "The parent asked to focus the remaining term on Biology.", proposed_changes: { studentId: goal.data!.student_id, goalId: goal.data!.id, termId: goal.data!.term_id, title: "Complete Biology with priority", subject: goal.data!.subject, goalKind: "curriculum_progress", targetValue: 36, targetUnit: "assignments", targetDate: goal.data!.target_date, weeklyEffortMinutes: 180, weeklyCadence: 4, priority: 80 }, target_goal_id: goal.data!.id, snapshot_version: current.data!.agent_context_version, idempotency_key: `e2e-goal-proposal:${suffix}` }).select("id").single();
    if (proposal.error) throw proposal.error;
    await page.goto(`/app/adjustments?planning=${proposal.data.id}`);
    const card = page.locator(".adjustments-list article").filter({ hasText: "Prioritize Biology" });
    await expect(card.locator("header span")).toContainText("Learning goal");
    await card.getByRole("button", { name: "Approve proposal" }).click();
    await expect(page.getByText("The approved plan is now part of the family workspace.")).toBeVisible();
    expect((await admin.from("learning_goals").select("title,priority").eq("id", goal.data!.id).single()).data).toEqual({ title: "Complete Biology with priority", priority: 80 });
  } finally {
    if (!userId) {
      const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    }
    if (userId) { await admin.from("families").delete().eq("created_by", userId); await admin.auth.admin.deleteUser(userId); }
  }
});
