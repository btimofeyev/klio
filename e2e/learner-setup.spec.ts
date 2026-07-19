import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("each learner keeps an independent subject and weekly setup", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `learner-setup-${suffix}@example.test`;
  const password = "KlioLearners123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Learner Setup Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Independent Learners Family");
    await page.getByLabel("Learner’s first name").fill("Noah");
    await page.getByLabel("Learning stage").selectOption("9-12");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Math course or curriculum").fill("Algebra I");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    const family = await admin.from("families").select("id").eq("created_by", userId!).single();

    await page.goto("/app/week");
    await page.getByRole("button", { name: "Build this week" }).click();
    await expect(page.getByText(/Klio planned Noah’s week: 1 subject across \d+ lessons\./)).toBeVisible();
    const initialAssignments = await admin.from("assignments").select("id").eq("family_id", family.data!.id);
    const initialNoahAssignmentCount = initialAssignments.data?.length ?? 0;
    expect(initialNoahAssignmentCount).toBeGreaterThan(0);

    await page.goto("/app/settings");
    await expect(page.locator(".learner-index-row")).toHaveCount(1);
    await expect(page.getByLabel("First name")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Student workspace sections" }).getByRole("link", { name: "Academic plan" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Student workspace sections" }).getByRole("link", { name: "Klio autonomy" })).toBeVisible();
    await page.getByRole("link", { name: "Add learner" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/learners\/new$/);
    await page.getByLabel("First name").fill("Eli");
    await page.getByLabel("Learning stage").selectOption("k-2");
    await page.getByRole("button", { name: "Continue to learning setup" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/learners\/[0-9a-f-]+$/);

    await page.getByRole("tab", { name: "Subjects" }).click();
    const siblingMath = page.getByRole("button", { name: "Add Math, used by Noah" });
    await expect(siblingMath).toBeVisible();
    await siblingMath.click();
    await expect(page.getByLabel("Math course or curriculum")).toHaveValue("");
    await page.getByRole("button", { name: "Remove Math" }).click();
    await page.getByLabel("Add a subject").selectOption("Language Arts");
    await page.getByLabel("Language Arts course or curriculum").fill("All About Reading 1");
    await page.getByLabel("Language Arts times per week").selectOption("4");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByLabel("Science times per week").selectOption("2");
    await page.getByRole("tab", { name: "Schedule" }).click();
    await page.getByLabel("Typical learning time").selectOption("90");
    await page.getByRole("group", { name: "Learning days" }).getByText("F").click();
    await page.locator('input[name="learningDays"][value="Sat"]').check({ force: true });
    await page.getByRole("button", { name: "Save learning setup" }).click();
    await expect(page.getByText("Eli’s learning setup is updated.")).toBeVisible();
    await page.getByRole("link", { name: "All learners" }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(page.locator(".learner-index-row").filter({ hasText: "Eli" })).toBeVisible();

    const students = await admin.from("students").select("id,display_name,grade_band,daily_capacity_minutes,schedule_preferences").eq("family_id", family.data!.id).order("display_name");
    const eli = students.data?.find((student) => student.display_name === "Eli");
    const noah = students.data?.find((student) => student.display_name === "Noah");
    expect(eli).toMatchObject({ grade_band: "k-2", daily_capacity_minutes: 90 });
    expect(noah).toMatchObject({ grade_band: "9-12", daily_capacity_minutes: 180 });
    const subjects = await admin.from("student_subjects").select("student_id,name,course_name,weekly_frequency").eq("family_id", family.data!.id);
    expect(subjects.data?.filter((subject) => subject.student_id === eli!.id)).toEqual(expect.arrayContaining([
      { student_id: eli!.id, name: "Language Arts", course_name: "All About Reading 1", weekly_frequency: 4 },
      { student_id: eli!.id, name: "Science", course_name: null, weekly_frequency: 2 },
    ]));
    expect(subjects.data?.filter((subject) => subject.student_id === noah!.id)).toEqual([{ student_id: noah!.id, name: "Math", course_name: "Algebra I", weekly_frequency: 5 }]);
    const eliCurricula = await admin.from("curriculum_units").select("subject,title,status").eq("family_id", family.data!.id).eq("student_id", eli!.id);
    expect(eliCurricula.data).toEqual(expect.arrayContaining([
      { subject: "Language Arts", title: "All About Reading 1", status: "active" },
      { subject: "Science", title: "Science", status: "active" },
    ]));

    await expect.poll(async () => {
      const result = await admin.from("assignments").select("id").eq("family_id", family.data!.id).eq("student_id", eli!.id);
      return result.data?.length ?? 0;
    }).toBeGreaterThan(0);

    await page.goto("/app/week");
    await expect(page.getByLabel("View schedule for")).toHaveValue("all");
    await expect(page.getByLabel("Learner for this handoff")).toHaveValue("");
    await expect(page.locator(".composer-interpretation")).toHaveCount(0);
    await page.getByLabel("Learner for this handoff").selectOption(eli!.id);
    await expect(page.getByLabel("Learner for this handoff")).toHaveValue(eli!.id);
    const familyAssignments = await admin.from("assignments").select("student_id,scheduled_date").eq("family_id", family.data!.id);
    const noahDate = familyAssignments.data?.find((assignment) => assignment.student_id === noah!.id)?.scheduled_date;
    const eliDate = familyAssignments.data?.find((assignment) => assignment.student_id === eli!.id)?.scheduled_date;
    expect(noahDate).toBeTruthy();
    expect(eliDate).toBeTruthy();
    await page.goto(`/app/week?date=${noahDate}`);
    await expect(page.locator(".teacher-week-learner-lane").filter({ hasText: "Noah" }).first()).toBeVisible();
    await page.goto(`/app/week?date=${eliDate}`);
    await expect(page.locator(".teacher-week-learner-lane").filter({ hasText: "Eli" }).first()).toBeVisible();
    expect(familyAssignments.data?.filter((assignment) => assignment.student_id === noah!.id)).toHaveLength(initialNoahAssignmentCount);
    expect(familyAssignments.data?.filter((assignment) => assignment.student_id === eli!.id).length).toBeGreaterThan(0);
    const totalAssignmentCount = familyAssignments.data?.length ?? 0;
    const retry = await page.evaluate(async ({ familyId, anchorDate }) => {
      const response = await fetch("/api/week-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, anchorDate }) });
      return { status: response.status, body: await response.json() };
    }, { familyId: family.data!.id, anchorDate: familyAssignments.data!.map((assignment) => assignment.scheduled_date!).sort()[0] });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ assignmentCount: 0, totalAssignmentCount, subjectCount: 3 });
    const assignmentsAfterRetry = await admin.from("assignments").select("id").eq("family_id", family.data!.id);
    expect(assignmentsAfterRetry.data).toHaveLength(totalAssignmentCount);

    await page.goto(`/app/records?student=${eli!.id}`);
    await expect(page.locator(".subject-folders").getByText("Language Arts", { exact: true })).toBeVisible();
    await expect(page.locator(".subject-folders").getByText("Math", { exact: true })).toHaveCount(0);
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
