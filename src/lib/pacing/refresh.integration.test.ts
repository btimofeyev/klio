import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { refreshFamilyPacingCheckpoints } from "./refresh";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
let userId = ""; let familyId = ""; let studentId = ""; let goalId = ""; let targetId = ""; let curriculumId = ""; let draftReviewId = "";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `pace-${crypto.randomUUID()}@example.test`, password: "KlioPace123", email_confirm: true });
  if (user.error) throw user.error; userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Pacing family", created_by: userId, timezone: "UTC" }).select("id").single();
  if (family.error) throw family.error; familyId = family.data.id;
  await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "Pacing learner", daily_capacity_minutes: 180 }).select("id").single();
  if (student.error) throw student.error; studentId = student.data.id;
  const term = await admin.from("academic_terms").insert({ family_id: familyId, created_by: userId, name: "January term", starts_on: "2026-01-05", ends_on: "2026-01-30", status: "active" }).select("id").single();
  if (term.error) throw term.error;
  await admin.from("academic_term_weekdays").insert([1, 2, 3, 4, 5].map((weekday) => ({ family_id: familyId, term_id: term.data.id, weekday })));
  const curriculum = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: studentId, created_by: userId, subject: "Science", title: "Biology" }).select("id").single();
  if (curriculum.error) throw curriculum.error; curriculumId = curriculum.data.id;
  const goal = await admin.from("learning_goals").insert({ family_id: familyId, student_id: studentId, term_id: term.data.id, created_by: userId, title: "Complete Biology", subject: "Science", status: "active" }).select("id").single();
  if (goal.error) throw goal.error; goalId = goal.data.id;
  const target = await admin.from("curriculum_pacing_targets").insert({ family_id: familyId, student_id: studentId, term_id: term.data.id, curriculum_unit_id: curriculumId, goal_id: goalId, created_by: userId, starts_on: "2026-01-05", target_completion_date: "2026-01-30", start_sequence: 1, target_sequence: 20, expected_assignments: 20, weekly_cadence: 5, weekly_effort_minutes: 200, status: "active" }).select("id").single();
  if (target.error) throw target.error; targetId = target.data.id;
  const assignments = await admin.from("assignments").insert(Array.from({ length: 5 }, (_, index) => ({ family_id: familyId, student_id: studentId, curriculum_unit_id: curriculumId, created_by: userId, title: `Biology ${index + 1}`, subject: "Science", sequence_number: index + 1, status: "completed" as const, scheduled_date: `2026-01-${String(5 + index).padStart(2, "0")}`, completed_at: "2026-01-10T12:00:00Z" }))).select("id,sequence_number");
  if (assignments.error) throw assignments.error;
  for (const assignment of assignments.data.slice(0, 2)) {
    const submission = await admin.from("assignment_submissions").insert({ family_id: familyId, assignment_id: assignment.id, student_id: studentId, submitted_by: userId, status: "ready_for_review" }).select("id").single();
    if (submission.error) throw submission.error;
    const review = await admin.from("assignment_reviews").insert({ family_id: familyId, assignment_id: assignment.id, submission_id: submission.data.id, student_id: studentId, status: assignment.sequence_number === 1 ? "approved" : "draft", grading_state: assignment.sequence_number === 1 ? "final" : "provisional", written_review_required: true, written_review_completed: assignment.sequence_number === 1, score: assignment.sequence_number === 1 ? 80 : null, draft_score: 85, reviewed_by: assignment.sequence_number === 1 ? userId : null, reviewed_at: assignment.sequence_number === 1 ? "2026-01-10T12:00:00Z" : null }).select("id").single();
    if (review.error) throw review.error;
    if (assignment.sequence_number === 2) draftReviewId = review.data.id;
  }
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("family pacing checkpoints", () => {
  it("calculates behind pace from actual records and counts only finalized approved evidence", async () => {
    const [result] = await refreshFamilyPacingCheckpoints({ familyId, studentId, asOfDate: "2026-01-16" });
    expect(result).toMatchObject({ goalId, state: "at_risk", actualValue: 5, approvedEvidenceCount: 1, plannedRecordCount: 4, basis: "mixed" });
    const checkpoint = await admin.from("pacing_checkpoints").select("id,state,basis,approved_evidence_count").eq("id", result.checkpointId).single();
    expect(checkpoint.data).toMatchObject({ state: "at_risk", basis: "mixed", approved_evidence_count: 1 });
  });

  it("atomically finalizes a parent-reviewed draft and records goal provenance", async () => {
    const finalized = await admin.rpc("finalize_assignment_review", { p_review_id: draftReviewId, p_actor_id: userId, p_decision: "approve", p_values: { score: 84, feedback: "Correct after review.", rubric: [], masterySignals: [{ skill: "osmosis", status: "developing" }], skillKey: "osmosis", comparableKey: "science:osmosis", scoreEdited: true } });
    expect(finalized.error).toBeNull();
    expect(finalized.data).toMatchObject({ status: "approved", gradingState: "final" });
    const duplicate = await admin.rpc("finalize_assignment_review", { p_review_id: draftReviewId, p_actor_id: userId, p_decision: "approve", p_values: { score: 50 } });
    expect(duplicate.data).toMatchObject({ status: "approved", duplicate: true });
    const provenance = await admin.from("goal_progress_records").select("goal_id,source_review_id,source_kind,progress_value").eq("goal_id", goalId).eq("source_review_id", draftReviewId);
    expect(provenance.data).toEqual([expect.objectContaining({ source_kind: "approved_review", progress_value: 2 })]);
    const [updated] = await refreshFamilyPacingCheckpoints({ familyId, studentId, asOfDate: "2026-01-17" });
    expect(updated.approvedEvidenceCount).toBe(2);
    expect(updated.change?.since).toBe("2026-01-16");
    expect(updated.checkpointId).not.toBe(targetId);
  });
});
