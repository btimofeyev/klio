import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { moveUnfinishedWork, organizeDaySchedule } from "./adjustments";
import { scheduleDates } from "@/lib/assignments/dates";
import { dateInTimezone } from "@/lib/schedule/dates";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
let userId = "";
let familyId = "";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `unfinished-${crypto.randomUUID()}@example.test`, password: "KlioUnfinished123", email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Unfinished integration", created_by: userId, available_days: [1, 2, 3, 4, 5], timezone: "America/New_York" }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const membership = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  if (membership.error) throw membership.error;
  const policy = await admin.from("family_autonomy_policies").insert({ family_id: familyId, preset: "proactive", policies: {}, updated_by: userId });
  if (policy.error) throw policy.error;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("unfinished curriculum operations", () => {
  it("moves the curriculum chain within capacity, isolates siblings, deduplicates, and safely undoes", async () => {
    const today = dateInTimezone(new Date(), "America/New_York");
    const missedDate = shiftDate(today, -2);
    const nextDate = shiftDate(today, -1);
    const movedDates = scheduleDates(today, [1, 2, 3, 4, 5], 2);
    const students = await admin.from("students").insert([
      { family_id: familyId, display_name: "Jacob", daily_capacity_minutes: 60 },
      { family_id: familyId, display_name: "Maya", daily_capacity_minutes: 30 },
    ]).select("id,display_name");
    if (students.error) throw students.error;
    const jacob = students.data.find((item) => item.display_name === "Jacob")!.id;
    const maya = students.data.find((item) => item.display_name === "Maya")!.id;
    const unit = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: jacob, created_by: userId, subject: "History", title: "Ancient history" }).select("id").single();
    if (unit.error) throw unit.error;
    const assignments = await admin.from("assignments").insert([
      { family_id: familyId, student_id: jacob, curriculum_unit_id: unit.data.id, created_by: userId, title: "History · Lesson 1", subject: "History", sequence_number: 1, scheduled_date: missedDate, estimated_minutes: 45 },
      { family_id: familyId, student_id: jacob, curriculum_unit_id: unit.data.id, created_by: userId, title: "History · Lesson 2", subject: "History", sequence_number: 2, scheduled_date: nextDate, estimated_minutes: 45 },
      { family_id: familyId, student_id: maya, created_by: userId, title: "Math · Fractions", subject: "Math", scheduled_date: nextDate, estimated_minutes: 30 },
    ]).select("id,student_id,sequence_number");
    if (assignments.error) throw assignments.error;
    const missed = assignments.data.find((item) => item.student_id === jacob && item.sequence_number === 1)!;
    const next = assignments.data.find((item) => item.student_id === jacob && item.sequence_number === 2)!;
    const sibling = assignments.data.find((item) => item.student_id === maya)!;
    const key = `unfinished:${missed.id}`;
    const moved = await moveUnfinishedWork({ familyId, studentId: jacob, assignmentIds: [missed.id], actorId: userId, idempotencyKey: key });
    expect(moved.applied).toBe(true);
    expect((await admin.from("assignments").select("scheduled_date").eq("id", missed.id).single()).data?.scheduled_date).toBe(movedDates[0]);
    expect((await admin.from("assignments").select("scheduled_date").eq("id", next.id).single()).data?.scheduled_date).toBe(movedDates[1]);
    expect((await admin.from("assignments").select("scheduled_date").eq("id", sibling.id).single()).data?.scheduled_date).toBe(nextDate);
    const duplicate = await moveUnfinishedWork({ familyId, studentId: jacob, assignmentIds: [missed.id], actorId: userId, idempotencyKey: key });
    expect(duplicate).toMatchObject({ duplicate: true, applied: true });
    expect((await admin.from("adjustment_proposals").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("idempotency_key", key)).count).toBe(1);

    const undone = await admin.rpc("undo_klio_adjustment", { p_proposal_id: moved.proposal.id, p_actor_id: userId });
    expect(undone.error).toBeNull();
    expect(undone.data).toMatchObject({ status: "undone" });
    expect((await admin.from("assignments").select("scheduled_date").eq("id", missed.id).single()).data?.scheduled_date).toBe(missedDate);
    expect((await admin.from("assignments").select("scheduled_date").eq("id", next.id).single()).data?.scheduled_date).toBe(nextDate);
    expect((await admin.from("assignments").select("scheduled_date").eq("id", sibling.id).single()).data?.scheduled_date).toBe(nextDate);

    const reapplied = await moveUnfinishedWork({ familyId, studentId: jacob, assignmentIds: [missed.id], actorId: userId, idempotencyKey: `${key}:stale-undo` });
    expect(reapplied.applied).toBe(true);
    const laterChange = await admin.from("students").update({ learning_preferences: "A parent changed the workspace after Klio moved the lesson." }).eq("id", maya);
    if (laterChange.error) throw laterChange.error;
    const staleUndo = await admin.rpc("undo_klio_adjustment", { p_proposal_id: reapplied.proposal.id, p_actor_id: userId });
    expect(staleUndo.error).toBeNull();
    expect(staleUndo.data).toMatchObject({ status: "stale", error: "UNDO_SNAPSHOT_STALE" });
    expect((await admin.from("adjustment_proposals").select("status,undo_status").eq("id", reapplied.proposal.id).single()).data).toMatchObject({ status: "applied", undo_status: "stale" });
    expect((await admin.from("assignments").select("scheduled_date").eq("id", missed.id).single()).data?.scheduled_date).toBe(movedDates[0]);
  });

  it("turns overlapping work into one learner-scoped timed sequence and restores it with undo", async () => {
    const date = dateInTimezone(new Date(), "America/New_York");
    const learners = await admin.from("students").insert([
      { family_id: familyId, display_name: "Schedule learner", daily_capacity_minutes: 180 },
      { family_id: familyId, display_name: "Schedule sibling", daily_capacity_minutes: 90 },
    ]).select("id,display_name");
    if (learners.error) throw learners.error;
    const learnerId = learners.data.find((item) => item.display_name === "Schedule learner")!.id;
    const siblingId = learners.data.find((item) => item.display_name === "Schedule sibling")!.id;
    const work = await admin.from("assignments").insert([
      { family_id: familyId, student_id: learnerId, created_by: userId, title: "Math", subject: "Math", sequence_number: 1, scheduled_date: date, scheduled_time: "09:00:00", estimated_minutes: 30 },
      { family_id: familyId, student_id: learnerId, created_by: userId, title: "Reading", subject: "Reading", sequence_number: 2, scheduled_date: date, scheduled_time: "09:00:00", estimated_minutes: 30 },
      { family_id: familyId, student_id: learnerId, created_by: userId, title: "Science", subject: "Science", sequence_number: 3, scheduled_date: date, scheduled_time: "09:10:00", estimated_minutes: 30 },
      { family_id: familyId, student_id: siblingId, created_by: userId, title: "Sibling work", subject: "Math", scheduled_date: date, scheduled_time: "09:00:00", estimated_minutes: 25 },
    ]).select("id,title");
    if (work.error) throw work.error;
    const thread = await admin.from("agent_threads").insert({ family_id: familyId, provider: "codex_app_server" }).select("id").single();
    if (thread.error) throw thread.error;
    const version = await admin.from("families").select("agent_context_version").eq("id", familyId).single();
    if (version.error) throw version.error;
    const turn = await admin.from("agent_turns").insert({
      thread_id: thread.data.id, family_id: familyId, requested_by: userId, trigger: "parent_message", goal: "weekly_plan",
      status: "running", idempotency_key: `organize-turn:${crypto.randomUUID()}`, initial_snapshot_version: version.data.agent_context_version,
      current_snapshot_version: version.data.agent_context_version, snapshot_hash: "b".repeat(64),
    }).select("id").single();
    if (turn.error) throw turn.error;
    const key = `organize:${crypto.randomUUID()}`;
    const organized = await organizeDaySchedule({ familyId, studentId: learnerId, scheduledDate: date, actorId: userId, agentTurnId: turn.data.id, snapshotVersion: version.data.agent_context_version, idempotencyKey: key });
    expect(organized).toMatchObject({ outcome: "completed", changedCount: 2, overlapCount: 2, undoAvailable: true });
    expect((organized as { summary: string }).summary).toContain("9:00 AM");
    const changed = await admin.from("assignments").select("title,scheduled_time").in("id", work.data.map((item) => item.id));
    expect(changed.data?.find((item) => item.title === "Math")?.scheduled_time).toBe("09:00:00");
    expect(changed.data?.find((item) => item.title === "Reading")?.scheduled_time).toBe("09:40:00");
    expect(changed.data?.find((item) => item.title === "Science")?.scheduled_time).toBe("10:20:00");
    expect(changed.data?.find((item) => item.title === "Sibling work")?.scheduled_time).toBe("09:00:00");
    const duplicate = await organizeDaySchedule({ familyId, studentId: learnerId, scheduledDate: date, actorId: userId, agentTurnId: turn.data.id, snapshotVersion: version.data.agent_context_version, idempotencyKey: key });
    expect(duplicate).toMatchObject({ duplicate: true, undoAvailable: true });
    const undone = await admin.rpc("undo_klio_adjustment", { p_proposal_id: (organized as { proposalId: string }).proposalId, p_actor_id: userId });
    expect(undone.data).toMatchObject({ status: "undone" });
    const restored = await admin.from("assignments").select("title,scheduled_time").in("id", work.data.map((item) => item.id));
    expect(restored.data?.find((item) => item.title === "Reading")?.scheduled_time).toBe("09:00:00");
    expect(restored.data?.find((item) => item.title === "Science")?.scheduled_time).toBe("09:10:00");
  });
});

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
