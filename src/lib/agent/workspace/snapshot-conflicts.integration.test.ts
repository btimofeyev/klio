import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { buildFamilyWorkspaceSnapshot } from "./snapshot";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let userA = ""; let userB = ""; let familyA = ""; let familyB = ""; let studentA = ""; let studentB = ""; let foreignStudent = "";

beforeAll(async () => {
  const users = await Promise.all([
    admin.auth.admin.createUser({ email: `snapshot-conflict-a-${crypto.randomUUID()}@example.test`, password: "KlioSnapshot123", email_confirm: true }),
    admin.auth.admin.createUser({ email: `snapshot-conflict-b-${crypto.randomUUID()}@example.test`, password: "KlioSnapshot123", email_confirm: true }),
  ]);
  if (users[0].error ?? users[1].error) throw users[0].error ?? users[1].error;
  userA = users[0].data.user.id; userB = users[1].data.user.id;
  const families = await admin.from("families").insert([{ name: "Snapshot conflicts A", created_by: userA, timezone: "UTC" }, { name: "Snapshot conflicts B", created_by: userB, timezone: "UTC" }]).select("id,name");
  if (families.error) throw families.error;
  familyA = families.data.find((family) => family.name.endsWith("A"))!.id; familyB = families.data.find((family) => family.name.endsWith("B"))!.id;
  const students = await admin.from("students").insert([{ family_id: familyA, display_name: "Snapshot learner A" }, { family_id: familyA, display_name: "Snapshot learner B" }, { family_id: familyB, display_name: "Snapshot foreign learner" }]).select("id,display_name");
  if (students.error) throw students.error;
  studentA = students.data.find((student) => student.display_name.endsWith("A"))!.id; studentB = students.data.find((student) => student.display_name.endsWith("B"))!.id;
  foreignStudent = students.data.find((student) => student.display_name.includes("foreign"))!.id;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await admin.from("calendar_conflicts").insert([
    { family_id: familyA, student_id: null, conflict_date: shift(today, 2), all_day: true, title: "Family block", created_by: userA },
    { family_id: familyA, student_id: studentA, conflict_date: shift(today, 3), all_day: false, starts_at: "10:00", ends_at: "11:00", title: "Learner A appointment", created_by: userA },
    { family_id: familyA, student_id: studentB, conflict_date: shift(today, 4), all_day: true, title: "Learner B only", created_by: userA },
    { family_id: familyA, student_id: null, conflict_date: shift(today, -20), all_day: true, title: "Expired old block", created_by: userA },
    { family_id: familyB, student_id: null, conflict_date: shift(today, 2), all_day: true, title: "Other family secret", created_by: userB },
  ]);
  if (rows.error) throw rows.error;
  const unit = await admin.from("curriculum_units").insert({ family_id: familyA, student_id: studentA, created_by: userA, subject: "Writing", title: "Snapshot Writing", default_minutes: 30, attention_mode: "flexible", parent_attention_minutes: 10 }).select("id").single();
  if (unit.error) throw unit.error;
  const attentionWork = await admin.from("assignments").insert([
    { family_id: familyA, student_id: studentA, curriculum_unit_id: unit.data.id, created_by: userA, title: "Flexible writing", subject: "Writing", scheduled_date: shift(today, 1), scheduled_time: "09:00", estimated_minutes: 30 },
    { family_id: familyA, student_id: studentB, created_by: userA, title: "Sibling instruction", subject: "Math", scheduled_date: shift(today, 1), scheduled_time: "09:05", estimated_minutes: 30, attention_mode: "parent_led" },
    { family_id: familyB, student_id: foreignStudent, created_by: userB, title: "Other family attention", subject: "Secret", scheduled_date: shift(today, 1), scheduled_time: "09:00", estimated_minutes: 30, attention_mode: "parent_led" },
  ]);
  if (attentionWork.error) throw attentionWork.error;
});

afterAll(async () => {
  if (familyA || familyB) await admin.from("families").delete().in("id", [familyA, familyB].filter(Boolean));
  if (userA) await admin.auth.admin.deleteUser(userA); if (userB) await admin.auth.admin.deleteUser(userB);
});

describe("family scheduling snapshot conflicts", () => {
  it("includes bounded family and learner constraints without cross-family leakage", async () => {
    const { snapshot } = await buildFamilyWorkspaceSnapshot({ familyId: familyA, studentId: studentA });
    const conflicts = snapshot.calendarConflicts as Array<{ title: string }>;
    expect(conflicts.map((conflict) => conflict.title)).toEqual(["Family block", "Learner A appointment"]);
    expect(conflicts.some((conflict) => conflict.title === "Expired old block")).toBe(false);
    expect(conflicts.some((conflict) => conflict.title === "Other family secret")).toBe(false);
    expect(conflicts.some((conflict) => conflict.title === "Learner B only")).toBe(false);
  });

  it("includes sibling-specific constraints only in an explicit family-wide snapshot", async () => {
    const { snapshot } = await buildFamilyWorkspaceSnapshot({ familyId: familyA, familyWide: true });
    const titles = (snapshot.calendarConflicts as Array<{ title: string }>).map((conflict) => conflict.title);
    expect(titles).toEqual(expect.arrayContaining(["Family block", "Learner A appointment", "Learner B only"]));
    expect(titles).not.toContain("Other family secret");
    const flexible = snapshot.currentAssignments.find((assignment) => assignment.title === "Flexible writing");
    expect(flexible).toMatchObject({ resolved_attention_mode: "flexible", resolved_parent_minutes: 10, attention_inherited: true, attention_source: "curriculum" });
    expect(snapshot.currentAssignments.some((assignment) => assignment.title === "Other family attention")).toBe(false);
    const attentionDay = snapshot.parentAttentionByDay.find((day) => day.conflicts.length);
    expect(attentionDay).toMatchObject({ totalParentMinutes: 40, concurrentIndependentMinutes: 0 });
    expect(attentionDay?.conflicts).toHaveLength(1);
  });
});

function shift(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
