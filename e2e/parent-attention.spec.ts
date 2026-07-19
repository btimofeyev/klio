import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

test("parents classify support without moving lessons and see shared parent-time conflicts", async ({ page }) => {
  const email = `parent-attention-${crypto.randomUUID()}@example.test`;
  const password = "KlioAttention123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Attention Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Attention Family");
    await page.getByLabel("Learner’s first name").fill("Maya");
    await page.getByLabel("Add a subject").selectOption("Math");
    for (const subject of ["Reading", "Writing"]) {
      await page.getByLabel("Add a subject").selectOption("custom");
      await page.getByLabel("Subject name").fill(subject);
      await page.getByRole("button", { name: "Add subject", exact: true }).click();
    }
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Created user was not found.");
    const family = await admin.from("families").select("id").eq("created_by", userId).single();
    const maya = await admin.from("students").select("id").eq("family_id", family.data!.id).eq("display_name", "Maya").single();
    const units = await admin.from("curriculum_units").select("id,subject").eq("family_id", family.data!.id).eq("student_id", maya.data!.id);
    if (family.error ?? maya.error ?? units.error) throw family.error ?? maya.error ?? units.error;
    const theo = await admin.from("students").insert({ family_id: family.data!.id, display_name: "Theo", daily_capacity_minutes: 120, schedule_preferences: { learningDays: ["Mon"], teachingWindows: { Mon: { start: "09:00", end: "12:00" } } } }).select("id").single();
    if (theo.error) throw theo.error;
    const monday = nextMonday();
    const wednesday = addDays(monday, 2);
    const thursday = addDays(monday, 3);
    const mathUnit = units.data.find((unit) => unit.subject === "Math")!;
    const readingUnit = units.data.find((unit) => unit.subject === "Reading")!;
    const writingUnit = units.data.find((unit) => unit.subject === "Writing")!;
    const seeded = await admin.from("assignments").insert([
      { family_id: family.data!.id, student_id: maya.data!.id, curriculum_unit_id: mathUnit.id, created_by: userId, title: "Maya math", subject: "Math", scheduled_date: monday, scheduled_time: "09:00", estimated_minutes: 40 },
      { family_id: family.data!.id, student_id: maya.data!.id, curriculum_unit_id: readingUnit.id, created_by: userId, title: "Maya reading", subject: "Reading", scheduled_date: monday, scheduled_time: "09:45", estimated_minutes: 30 },
      { family_id: family.data!.id, student_id: maya.data!.id, curriculum_unit_id: writingUnit.id, created_by: userId, title: "Maya writing", subject: "Writing", scheduled_date: monday, scheduled_time: "10:20", estimated_minutes: 30 },
      { family_id: family.data!.id, student_id: theo.data.id, created_by: userId, title: "Theo phonics", subject: "Language Arts", scheduled_date: monday, scheduled_time: "09:00", estimated_minutes: 30, attention_mode: "parent_led" },
      { family_id: family.data!.id, student_id: theo.data.id, created_by: userId, title: "Theo tutorial", subject: "Language Arts", scheduled_date: wednesday, scheduled_time: "09:00", estimated_minutes: 30, attention_mode: "parent_led" },
      { family_id: family.data!.id, student_id: maya.data!.id, created_by: userId, title: "Maya movable", subject: "Math", scheduled_date: thursday, scheduled_time: "09:10", estimated_minutes: 30, attention_mode: "parent_led" },
    ]).select("id,title,scheduled_date,scheduled_time");
    if (seeded.error) throw seeded.error;
    const before = seeded.data.map(({ id, scheduled_date, scheduled_time }) => ({ id, scheduled_date, scheduled_time })).sort((a, b) => a.id.localeCompare(b.id));

    await page.goto(`/app/settings/learners/${maya.data!.id}`);
    await page.getByRole("tab", { name: "Subjects" }).click();
    await page.getByLabel("Math parent support").selectOption("parent_led");
    await page.getByLabel("Reading parent support").selectOption("independent");
    await page.getByLabel("Writing parent support").selectOption("flexible");
    await page.getByLabel("Minutes together").fill("10");
    await page.getByRole("button", { name: "Save learning setup" }).click();
    await expect(page.getByText("Current lessons were not moved.")).toBeVisible();
    const after = await admin.from("assignments").select("id,scheduled_date,scheduled_time").in("id", before.map((item) => item.id)).order("id");
    expect(after.data).toEqual(before);
    const savedUnits = await admin.from("curriculum_units").select("subject,attention_mode,parent_attention_minutes").in("id", [mathUnit.id, readingUnit.id, writingUnit.id]);
    expect(savedUnits.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "Math", attention_mode: "parent_led", parent_attention_minutes: null }),
      expect.objectContaining({ subject: "Reading", attention_mode: "independent", parent_attention_minutes: null }),
      expect.objectContaining({ subject: "Writing", attention_mode: "flexible", parent_attention_minutes: 10 }),
    ]));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/app/week?date=${monday}`);
    await expect(page.getByText("With you", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Independent", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("10 min together", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/80 min with you · overlap at 9:00 AM/)).toBeVisible();

    const movable = seeded.data.find((item) => item.title === "Maya movable")!;
    const rejectedMove = await page.evaluate(async ({ assignmentId, scheduledDate }) => {
      const response = await fetch(`/api/assignments/${assignmentId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledDate }) });
      return { status: response.status, body: await response.json() as { error?: string } };
    }, { assignmentId: movable.id, scheduledDate: wednesday });
    expect(rejectedMove).toEqual({ status: 409, body: { error: "Another lesson needs you at that time." } });
    expect((await admin.from("assignments").select("scheduled_date").eq("id", movable.id).single()).data?.scheduled_date).toBe(thursday);

    await page.locator(".teacher-week-item").filter({ hasText: "Maya math" }).click();
    const support = page.getByLabel("Lesson support");
    await expect(support).toHaveValue("inherit");
    await expect(page.getByText(/Learner 9:00 AM–9:40 AM/)).toBeVisible();
    await support.selectOption("independent");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved. Current lessons were not moved.")).toBeVisible();
    const mathAssignment = seeded.data.find((item) => item.title === "Maya math")!;
    expect((await admin.from("assignments").select("attention_mode,scheduled_date,scheduled_time").eq("id", mathAssignment.id).single()).data).toMatchObject({ attention_mode: "independent", scheduled_date: monday, scheduled_time: "09:00:00" });

    await support.selectOption("inherit");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Two lessons need you at 9:00 AM.")).toBeVisible();
    const turnsBefore = await admin.from("agent_turns").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id);
    await page.getByRole("button", { name: "Ask Klio to reorganize" }).click();
    await expect(page.getByRole("textbox", { name: "Hand something to Klio" })).toHaveValue(/Reorganize Maya math/);
    const turnsAfter = await admin.from("agent_turns").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id);
    expect(turnsAfter.count).toBe(turnsBefore.count);
    expect((await admin.from("assignments").select("attention_mode,scheduled_time").eq("id", mathAssignment.id).single()).data).toEqual({ attention_mode: null, scheduled_time: "09:00:00" });
    const audit = await admin.from("audit_events").select("action").eq("family_id", family.data!.id).in("action", ["curriculum.attention_preference_changed", "assignment.attention_override_changed", "assignment.attention_override_cleared"]);
    expect(audit.data?.map((event) => event.action)).toEqual(expect.arrayContaining(["curriculum.attention_preference_changed", "assignment.attention_override_changed", "assignment.attention_override_cleared"]));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/app/week?date=${monday}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByText("With you", { exact: true }).first()).toBeVisible();
    await page.locator(".teacher-week-item").filter({ hasText: "Maya math" }).focus();
    await expect(page.locator(".teacher-week-item").filter({ hasText: "Maya math" })).toBeFocused();
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

function nextMonday() { const value = new Date(); value.setUTCHours(12, 0, 0, 0); const offset = (8 - value.getUTCDay()) % 7 || 7; value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
