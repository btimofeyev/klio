import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ownerA = ""; let ownerB = ""; let familyA = ""; let familyB = ""; let studentA = ""; let termId = "";

beforeAll(async () => {
  const [a, b] = await Promise.all([
    admin.auth.admin.createUser({ email: `proposal-a-${crypto.randomUUID()}@example.test`, password: "KlioProposal123", email_confirm: true }),
    admin.auth.admin.createUser({ email: `proposal-b-${crypto.randomUUID()}@example.test`, password: "KlioProposal123", email_confirm: true }),
  ]);
  if (a.error ?? b.error) throw a.error ?? b.error; ownerA = a.data.user.id; ownerB = b.data.user.id;
  const families = await admin.from("families").insert([{ name: "Proposal A", created_by: ownerA }, { name: "Proposal B", created_by: ownerB }]).select("id,name");
  if (families.error) throw families.error;
  familyA = families.data.find((item) => item.name === "Proposal A")!.id; familyB = families.data.find((item) => item.name === "Proposal B")!.id;
  await admin.from("family_members").insert([{ family_id: familyA, user_id: ownerA, role: "owner" }, { family_id: familyB, user_id: ownerB, role: "owner" }]);
  const student = await admin.from("students").insert({ family_id: familyA, display_name: "Proposal learner" }).select("id").single();
  if (student.error) throw student.error; studentA = student.data.id;
  const term = await admin.from("academic_terms").insert({ family_id: familyA, created_by: ownerA, name: "Proposal term", starts_on: "2026-08-01", ends_on: "2027-05-31", status: "active" }).select("id").single();
  if (term.error) throw term.error; termId = term.data.id;
});

afterAll(async () => {
  if (familyA || familyB) await admin.from("families").delete().in("id", [familyA, familyB].filter(Boolean));
  if (ownerA) await admin.auth.admin.deleteUser(ownerA); if (ownerB) await admin.auth.admin.deleteUser(ownerB);
});

async function version() {
  const row = await admin.from("families").select("agent_context_version").eq("id", familyA).single();
  if (row.error) throw row.error; return row.data.agent_context_version;
}

describe("stale-safe planning proposals", () => {
  it("applies a normalized learner goal once and rejects cross-family approval", async () => {
    const proposal = await admin.from("planning_proposals").insert({ family_id: familyA, student_id: studentA, proposal_kind: "learner_goal", action_name: "create_goal", risk: "moderate", title: "Complete Literature", summary: "Finish twelve literature assignments.", reason: "Parent requested a term goal.", proposed_changes: { studentId: studentA, termId, title: "Complete Literature", subject: "Language Arts", goalKind: "curriculum_progress", targetValue: 12, targetUnit: "assignments", targetDate: "2027-05-01", weeklyEffortMinutes: 120, weeklyCadence: 3, priority: 70 }, snapshot_version: await version(), idempotency_key: `goal:${crypto.randomUUID()}` }).select("id").single();
    if (proposal.error) throw proposal.error;
    const forbidden = await admin.rpc("apply_planning_proposal", { p_proposal_id: proposal.data.id, p_actor_id: ownerB });
    expect(forbidden.error?.message).toContain("PROPOSAL_FORBIDDEN");
    const applied = await admin.rpc("apply_planning_proposal", { p_proposal_id: proposal.data.id, p_actor_id: ownerA });
    expect(applied.data).toMatchObject({ status: "applied", duplicate: false });
    expect((await admin.rpc("apply_planning_proposal", { p_proposal_id: proposal.data.id, p_actor_id: ownerA })).data).toMatchObject({ status: "applied", duplicate: true });
    expect((await admin.from("learning_goals").select("title,status,target_value").eq("family_id", familyA).eq("student_id", studentA).single()).data).toMatchObject({ title: "Complete Literature", status: "active", target_value: 12 });
  });

  it("applies the bounded schedule payload and expires it after a newer parent change", async () => {
    const assignments = await admin.from("assignments").insert([
      { family_id: familyA, student_id: studentA, created_by: ownerA, title: "Move me", subject: "Math", scheduled_date: "2026-08-10", estimated_minutes: 30 },
      { family_id: familyA, student_id: studentA, created_by: ownerA, title: "Keep parent edit", subject: "Math", scheduled_date: "2026-08-11", estimated_minutes: 30 },
    ]).select("id,title");
    if (assignments.error) throw assignments.error;
    const move = assignments.data.find((item) => item.title === "Move me")!; const staleTarget = assignments.data.find((item) => item.title === "Keep parent edit")!;
    const currentVersion = await version();
    const first = await admin.from("planning_proposals").insert({ family_id: familyA, student_id: studentA, proposal_kind: "weekly_plan", action_name: "prepare_week", risk: "moderate", title: "Move scheduled work", summary: "Move one assignment.", reason: "Capacity changed.", proposed_changes: { assignmentIds: [move.id], changes: [{ assignmentId: move.id, scheduledDate: "2026-08-12", previousScheduledDate: "2026-08-10" }] }, snapshot_version: currentVersion, idempotency_key: `move:${crypto.randomUUID()}` }).select("id").single();
    if (first.error) throw first.error;
    expect((await admin.rpc("apply_planning_proposal", { p_proposal_id: first.data.id, p_actor_id: ownerA })).data).toMatchObject({ status: "applied" });
    expect((await admin.from("assignments").select("scheduled_date").eq("id", move.id).single()).data?.scheduled_date).toBe("2026-08-12");
    const stale = await admin.from("planning_proposals").insert({ family_id: familyA, student_id: studentA, proposal_kind: "weekly_plan", action_name: "prepare_week", risk: "moderate", title: "Stale move", summary: "Move one assignment.", reason: "Old context.", proposed_changes: { assignmentIds: [staleTarget.id], changes: [{ assignmentId: staleTarget.id, scheduledDate: "2026-08-13", previousScheduledDate: "2026-08-11" }] }, snapshot_version: await version(), idempotency_key: `stale:${crypto.randomUUID()}` }).select("id").single();
    if (stale.error) throw stale.error;
    await admin.from("assignments").update({ scheduled_date: "2026-08-20" }).eq("id", staleTarget.id);
    expect((await admin.rpc("apply_planning_proposal", { p_proposal_id: stale.data.id, p_actor_id: ownerA })).data).toMatchObject({ status: "expired", error: "PROPOSAL_SNAPSHOT_STALE" });
    expect((await admin.from("assignments").select("scheduled_date").eq("id", staleTarget.id).single()).data?.scheduled_date).toBe("2026-08-20");
  });
});
