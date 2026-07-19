import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { assertScheduleChangesFit } from "./placement-validation";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let userId = "";
let familyId = "";
let learnerA = "";
let learnerB = "";
let movingAssignmentId = "";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `placement-attention-${crypto.randomUUID()}@example.test`, password: "KlioPlacement123", email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Placement attention family", created_by: userId, available_days: ["Mon"] }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const students = await admin.from("students").insert([
    { family_id: familyId, display_name: "Placement A", daily_capacity_minutes: 180, schedule_preferences: { learningDays: ["Mon"], teachingWindows: { Mon: { start: "09:00", end: "12:00" } } } },
    { family_id: familyId, display_name: "Placement B", daily_capacity_minutes: 180, schedule_preferences: { learningDays: ["Mon"], teachingWindows: { Mon: { start: "09:00", end: "12:00" } } } },
  ]).select("id,display_name");
  if (students.error) throw students.error;
  learnerA = students.data.find((student) => student.display_name.endsWith("A"))!.id;
  learnerB = students.data.find((student) => student.display_name.endsWith("B"))!.id;
  const fixed = await admin.from("assignments").insert({ family_id: familyId, student_id: learnerB, created_by: userId, title: "Fixed instruction", subject: "Math", scheduled_date: "2026-08-17", scheduled_time: "09:00", estimated_minutes: 40, attention_mode: "parent_led" });
  if (fixed.error) throw fixed.error;
  const moving = await admin.from("assignments").insert({ family_id: familyId, student_id: learnerA, created_by: userId, title: "Movable lesson", subject: "Writing", scheduled_date: "2026-08-24", scheduled_time: "10:00", estimated_minutes: 30, attention_mode: "parent_led" }).select("id").single();
  if (moving.error) throw moving.error;
  movingAssignmentId = moving.data.id;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("parent-aware placement validation", () => {
  it("rejects a sibling parent-attention overlap", async () => {
    await expect(assertScheduleChangesFit({ supabase: admin, familyId, studentId: learnerA, changes: [{ assignmentId: movingAssignmentId, scheduledDate: "2026-08-17", scheduledTime: "09:10", estimatedMinutes: 30 }] })).rejects.toThrow("PARENT_ATTENTION_OVERLAP");
  });

  it("allows independent work beside sibling instruction", async () => {
    const changed = await admin.from("assignments").update({ attention_mode: "independent" }).eq("id", movingAssignmentId);
    if (changed.error) throw changed.error;
    await expect(assertScheduleChangesFit({ supabase: admin, familyId, studentId: learnerA, changes: [{ assignmentId: movingAssignmentId, scheduledDate: "2026-08-17", scheduledTime: "09:10", estimatedMinutes: 30 }] })).resolves.toBeUndefined();
  });

  it("rejects same-learner overlap even for independent work", async () => {
    const existing = await admin.from("assignments").insert({ family_id: familyId, student_id: learnerA, created_by: userId, title: "Independent reading", subject: "Reading", scheduled_date: "2026-08-17", scheduled_time: "10:00", estimated_minutes: 30, attention_mode: "independent" });
    if (existing.error) throw existing.error;
    await expect(assertScheduleChangesFit({ supabase: admin, familyId, studentId: learnerA, changes: [{ assignmentId: movingAssignmentId, scheduledDate: "2026-08-17", scheduledTime: "10:10", estimatedMinutes: 30 }] })).rejects.toThrow("LEARNER_SCHEDULE_OVERLAP");
  });
});
