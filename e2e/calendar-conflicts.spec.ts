import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

test("parents set teaching hours and manage quick conflicts across Week and Month", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `calendar-conflicts-${suffix}@example.test`;
  const password = "KlioCalendar123";
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Calendar Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Teaching Hours Family");
    await page.getByLabel("Learner’s first name").fill("Maya");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Math course or curriculum").fill("Fractions");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    const family = await admin.from("families").select("id").eq("created_by", userId!).single();
    const maya = await admin.from("students").select("id").eq("family_id", family.data!.id).eq("display_name", "Maya").single();
    const theo = await admin.from("students").insert({ family_id: family.data!.id, display_name: "Theo", daily_capacity_minutes: 120, schedule_preferences: { learningDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] } }).select("id").single();
    if (family.error ?? maya.error ?? theo.error) throw family.error ?? maya.error ?? theo.error;
    const monday = nextMonday();
    const tuesday = addDays(monday, 1);
    const seeded = await admin.from("assignments").insert([
      { family_id: family.data!.id, student_id: maya.data.id, created_by: userId!, title: "Fractions lesson", subject: "Math", scheduled_date: monday, scheduled_time: "10:00", estimated_minutes: 60, status: "planned" },
      { family_id: family.data!.id, student_id: maya.data.id, created_by: userId!, title: "Reading lesson", subject: "Language Arts", scheduled_date: tuesday, estimated_minutes: 45, status: "planned" },
      { family_id: family.data!.id, student_id: theo.data.id, created_by: userId!, title: "Phonics lesson", subject: "Language Arts", scheduled_date: monday, scheduled_time: "09:00", estimated_minutes: 30, status: "planned" },
    ]).select("id,scheduled_date,scheduled_time");
    if (seeded.error) throw seeded.error;

    await page.goto("/app/settings");
    await page.locator(".learner-index-row").filter({ hasText: "Maya" }).click();
    await page.getByRole("link", { name: "Edit setup" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/learners\/[0-9a-f-]+$/);
    await page.getByRole("tab", { name: "Schedule" }).click();
    const mondayFlexible = page.locator(".teaching-hours-row").filter({ hasText: "Monday" }).getByRole("checkbox", { name: "Flexible" });
    await expect(mondayFlexible).toBeChecked();
    await mondayFlexible.uncheck();
    await page.getByLabel("Monday teaching start").fill("09:00");
    await page.getByLabel("Monday teaching end").fill("12:00");
    await page.getByRole("button", { name: "Save learning setup" }).click();
    await expect(page.getByText(/Maya’s learning setup is updated/)).toBeVisible();
    const savedPreferences = await admin.from("students").select("schedule_preferences").eq("id", maya.data.id).single();
    expect(savedPreferences.data?.schedule_preferences).toMatchObject({ teachingWindows: { Mon: { start: "09:00", end: "12:00" } } });

    const assignmentsBeforeConflict = await admin.from("assignments").select("id,scheduled_date,scheduled_time").eq("family_id", family.data!.id).order("id");
    await page.goto(`/app/week?date=${monday}`);
    await expect(page.getByLabel("View schedule for")).toHaveValue("all");
    const mondayAdd = page.getByRole("button", { name: `Add conflict on ${shortDate(monday)}` });
    await mondayAdd.click();
    const timedEditor = page.getByRole("dialog", { name: "Add a conflict" });
    await timedEditor.getByLabel("Title").fill("Dentist");
    await timedEditor.getByLabel("Applies to").selectOption(maya.data.id);
    await timedEditor.getByLabel("Custom").check();
    await timedEditor.getByLabel("Start", { exact: true }).fill("10:00");
    await timedEditor.getByLabel("End", { exact: true }).fill("11:30");
    await timedEditor.getByRole("button", { name: "Add conflict" }).click();
    await expect(page.getByText("Dentist was added. Existing lessons stayed where they were.")).toBeVisible();
    await expect(page.locator(".teacher-week-conflicts").getByRole("button", { name: /Dentist/ })).toBeVisible();
    await expect(page.getByText(/\d+ timed lessons? overlap/)).toBeVisible();
    await expect(mondayAdd).toBeFocused();
    const assignmentsAfterConflict = await admin.from("assignments").select("id,scheduled_date,scheduled_time").eq("family_id", family.data!.id).order("id");
    expect(assignmentsAfterConflict.data).toEqual(assignmentsBeforeConflict.data);

    const turnsBeforePrefill = await admin.from("agent_turns").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id);
    await page.getByRole("button", { name: "Ask Klio to reorganize" }).click();
    const composer = page.getByRole("textbox", { name: "Hand something to Klio" });
    await expect(composer).toHaveValue(/Reorganize Maya’s schedule around Dentist/);
    await expect(page.getByRole("button", { name: "Send to Klio" })).toBeEnabled();
    await expect(composer).toHaveValue(/Fractions lesson/);
    const turnsAfterPrefill = await admin.from("agent_turns").select("id", { count: "exact", head: true }).eq("family_id", family.data!.id);
    expect(turnsAfterPrefill.count).toBe(turnsBeforePrefill.count);

    await page.getByRole("button", { name: "Month" }).click();
    await expect(page.getByRole("main", { name: "Monthly calendar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dentist" })).toBeVisible();
    await expect(page.getByRole("region", { name: longDate(monday), exact: true })).toContainText(/lesson/);
    const tuesdayAdd = page.getByRole("button", { name: `Add conflict on ${longDate(tuesday)}` });
    await tuesdayAdd.click();
    const allDayEditor = page.getByRole("dialog", { name: "Add a conflict" });
    await allDayEditor.getByLabel("Title").fill("Family day");
    await expect(allDayEditor.getByLabel("Applies to")).toHaveValue("everyone");
    await expect(allDayEditor.getByLabel("All day")).toBeChecked();
    await allDayEditor.getByRole("button", { name: "Add conflict", exact: true }).click();
    await expect(page.getByRole("button", { name: "Family day" })).toBeVisible();

    await page.getByLabel("View schedule for").selectOption(theo.data.id);
    await expect(page).toHaveURL(new RegExp(`student=${theo.data.id}.*view=month`));
    await expect(page.getByRole("button", { name: "Family day" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dentist" })).toHaveCount(0);
    await page.getByRole("button", { name: "Family day" }).click();
    const editEditor = page.getByRole("dialog", { name: "Edit conflict" });
    await expect(editEditor.getByLabel("Applies to")).toHaveValue("everyone");
    await editEditor.getByLabel("Title").fill("Family museum day");
    await editEditor.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Family museum day" })).toBeVisible();
    await page.getByRole("button", { name: "Family museum day" }).click();
    const deleteEditor = page.getByRole("dialog", { name: "Edit conflict" });
    await deleteEditor.getByRole("button", { name: "Delete" }).click();
    await expect(deleteEditor.getByText("Delete this conflict?")).toBeVisible();
    await deleteEditor.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: "Family museum day" })).toHaveCount(0);

    const escapeTarget = page.getByRole("button", { name: `Add conflict on ${longDate(tuesday)}` });
    await escapeTarget.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(escapeTarget).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("main", { name: "Monthly calendar" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.locator(".calendar-month-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
    await expect(page.getByRole("button", { name: `Add conflict on ${longDate(monday)}` })).toBeVisible();
  } finally {
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

function nextMonday() { const value = new Date(); value.setUTCHours(12, 0, 0, 0); const offset = (8 - value.getUTCDay()) % 7 || 7; value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function shortDate(date: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
function longDate(date: string) { return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
