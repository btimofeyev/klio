import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
let ownerA = ""; let ownerB = ""; let familyA = ""; let familyB = ""; let studentA = ""; let studentB = ""; let turnA = "";

beforeAll(async () => {
  const [a, b] = await Promise.all([
    admin.auth.admin.createUser({ email: `grading-a-${crypto.randomUUID()}@example.test`, password: "KlioGrading123", email_confirm: true }),
    admin.auth.admin.createUser({ email: `grading-b-${crypto.randomUUID()}@example.test`, password: "KlioGrading123", email_confirm: true }),
  ]);
  if (a.error ?? b.error) throw a.error ?? b.error;
  ownerA = a.data.user.id; ownerB = b.data.user.id;
  const families = await admin.from("families").insert([{ name: "Grading A", created_by: ownerA }, { name: "Grading B", created_by: ownerB }]).select("id,name");
  if (families.error) throw families.error;
  familyA = families.data.find((item) => item.name === "Grading A")!.id;
  familyB = families.data.find((item) => item.name === "Grading B")!.id;
  await admin.from("family_members").insert([{ family_id: familyA, user_id: ownerA, role: "owner" }, { family_id: familyB, user_id: ownerB, role: "owner" }]);
  const students = await admin.from("students").insert([{ family_id: familyA, display_name: "Learner A" }, { family_id: familyB, display_name: "Learner B" }]).select("id,family_id");
  if (students.error) throw students.error;
  studentA = students.data.find((item) => item.family_id === familyA)!.id;
  studentB = students.data.find((item) => item.family_id === familyB)!.id;
  const thread = await admin.from("agent_threads").insert({ family_id: familyA, provider: "codex_app_server" }).select("id").single();
  if (thread.error) throw thread.error;
  const version = await admin.from("families").select("agent_context_version").eq("id", familyA).single();
  if (version.error) throw version.error;
  const turn = await admin.from("agent_turns").insert({ thread_id: thread.data.id, family_id: familyA, requested_by: ownerA, trigger: "parent_message", goal: "records", status: "running", idempotency_key: `grading:${crypto.randomUUID()}`, initial_snapshot_version: version.data.agent_context_version, current_snapshot_version: version.data.agent_context_version, snapshot_hash: "f".repeat(64) }).select("id").single();
  if (turn.error) throw turn.error; turnA = turn.data.id;
});

afterAll(async () => {
  if (familyA) await admin.from("families").delete().eq("id", familyA);
  if (familyB) await admin.from("families").delete().eq("id", familyB);
  if (ownerA) await admin.auth.admin.deleteUser(ownerA);
  if (ownerB) await admin.auth.admin.deleteUser(ownerB);
});

async function draft(input: { familyId?: string; studentId?: string; ownerId?: string; title: string; written: boolean; score: number | null; origin?: "agent_inferred" | "explicit_parent" | "imported_explicit" }) {
  const familyId = input.familyId ?? familyA; const studentId = input.studentId ?? studentA; const ownerId = input.ownerId ?? ownerA;
  const assignment = await admin.from("assignments").insert({ family_id: familyId, student_id: studentId, created_by: ownerId, title: input.title, subject: "Language Arts", status: "needs_review", source_kind: "curriculum" }).select("id").single();
  if (assignment.error) throw assignment.error;
  const submission = await admin.from("assignment_submissions").insert({ family_id: familyId, assignment_id: assignment.data.id, student_id: studentId, submitted_by: ownerId, status: "ready_for_review" }).select("id").single();
  if (submission.error) throw submission.error;
  const review = await admin.from("assignment_reviews").insert({ family_id: familyId, assignment_id: assignment.data.id, submission_id: submission.data.id, student_id: studentId, status: "draft", draft_score: input.score, grading_state: "provisional", written_review_required: input.written, written_review_completed: false, score_origin: input.origin ?? "agent_inferred", evidence_strength: "curriculum" }).select("id").single();
  if (review.error) throw review.error;
  return { assignmentId: assignment.data.id, submissionId: submission.data.id, reviewId: review.data.id };
}

describe("bounded grading and mastery loop", () => {
  it("finalizes fully objective work and records a parent-edited model draft distinctly", async () => {
    const objective = await draft({ title: "Objective quiz", written: false, score: 92 });
    const result = await admin.rpc("finalize_assignment_review", { p_review_id: objective.reviewId, p_actor_id: ownerA, p_decision: "approve", p_values: { score: 94, feedback: "Two corrected objective answers.", skillKey: "punctuation-commas", comparableKey: "language-arts:punctuation-commas", scoreEdited: true } });
    expect(result.error).toBeNull();
    expect((await admin.from("assignment_reviews").select("status,grading_state,score,score_origin,written_review_completed").eq("id", objective.reviewId).single()).data).toMatchObject({ status: "approved", grading_state: "final", score: 94, score_origin: "parent_edited_agent_draft", written_review_completed: true });
    expect((await admin.from("parent_agent_corrections").select("correction_kind,target_entity_id").eq("target_entity_id", objective.reviewId).single()).data).toEqual({ correction_kind: "parent_edited_score", target_entity_id: objective.reviewId });
  });

  it("keeps written and mixed work provisional until a parent review finalizes it", async () => {
    const written = await draft({ title: "Written essay", written: true, score: 88 });
    const illegal = await admin.from("assignment_reviews").update({ status: "approved", grading_state: "final", score: 88 }).eq("id", written.reviewId);
    expect(illegal.error?.code).toBe("23514");
    const mixed = await draft({ title: "Mixed quiz and explanation", written: true, score: 80 });
    const finalized = await admin.rpc("finalize_assignment_review", { p_review_id: mixed.reviewId, p_actor_id: ownerA, p_decision: "approve", p_values: { score: 82, feedback: "Objective items and written explanation were both checked.", skillKey: "textual-evidence", comparableKey: "language-arts:textual-evidence" } });
    expect(finalized.data).toMatchObject({ status: "approved", gradingState: "final" });
    expect((await admin.from("assignment_reviews").select("written_review_required,written_review_completed").eq("id", mixed.reviewId).single()).data).toEqual({ written_review_required: true, written_review_completed: true });
  });

  it("keeps illegible work and rejected drafts out of finalized learner facts", async () => {
    const illegible = await draft({ title: "Illegible scan", written: true, score: null });
    const rejected = await admin.rpc("finalize_assignment_review", { p_review_id: illegible.reviewId, p_actor_id: ownerA, p_decision: "reject", p_values: { feedback: "The scan cannot be read." } });
    expect(rejected.data).toMatchObject({ status: "rejected", gradingState: "provisional", score: null });
    expect((await admin.from("assignment_reviews").select("status,grading_state,score").eq("id", illegible.reviewId).single()).data).toEqual({ status: "rejected", grading_state: "provisional", score: null });
    expect((await admin.from("goal_progress_records").select("id", { count: "exact", head: true }).eq("source_review_id", illegible.reviewId)).count).toBe(0);
    expect((await admin.from("parent_agent_corrections").select("correction_kind").eq("target_entity_id", illegible.reviewId).single()).data?.correction_kind).toBe("parent_rejected_draft");
  });

  it("atomically preserves an explicit parent score and isolates cross-family decisions", async () => {
    const explicit = await draft({ title: "Parent-scored oral work", written: false, score: 96, origin: "explicit_parent" });
    const recorded = await admin.rpc("record_explicit_parent_score", { p_family_id: familyA, p_assignment_id: explicit.assignmentId, p_actor_id: ownerA, p_agent_turn_id: turnA, p_score: 96, p_submission_id: explicit.submissionId, p_score_label: "Excellent", p_feedback: "Parent observed the complete oral response." });
    expect(recorded.error).toBeNull();
    expect((await admin.from("assignment_reviews").select("score,score_origin,grading_state,status,evidence_strength").eq("submission_id", explicit.submissionId).single()).data).toMatchObject({ score: 96, score_origin: "explicit_parent", grading_state: "final", status: "approved", evidence_strength: "parent_report" });

    const other = await draft({ familyId: familyB, studentId: studentB, ownerId: ownerB, title: "Other family work", written: true, score: 75 });
    const forbidden = await admin.rpc("finalize_assignment_review", { p_review_id: other.reviewId, p_actor_id: ownerA, p_decision: "approve", p_values: { score: 75 } });
    expect(forbidden.error?.message).toContain("REVIEW_FORBIDDEN");
    expect((await admin.from("assignment_reviews").select("status,grading_state").eq("id", other.reviewId).single()).data).toEqual({ status: "draft", grading_state: "provisional" });
  });

  it("database constraints prevent provisional practice from declaring mastery", async () => {
    const artifact = await admin.from("artifacts").insert({ family_id: familyA, student_id: studentA, created_by: ownerA, type: "practice", title: "Written practice", status: "approved", content: {} }).select("id").single();
    if (artifact.error) throw artifact.error;
    const session = await admin.from("practice_sessions").insert({ family_id: familyA, student_id: studentA, artifact_id: artifact.data.id, created_by: ownerA, status: "ready", spec: { subject: "Language Arts", skill_key: "textual-evidence" } }).select("id").single();
    if (session.error) throw session.error;
    const rows = await admin.from("practice_results").insert([1, 2, 3].map((index) => ({ family_id: familyA, student_id: studentA, practice_session_id: session.data.id, answers: { index }, score: 100, auto_score: 100, final_score: null, scoring_state: "provisional" as const, written_review_required: true, written_review_completed: false, mastery_met: false })));
    expect(rows.error).toBeNull();
    const falseMastery = await admin.from("practice_results").insert({ family_id: familyA, student_id: studentA, practice_session_id: session.data.id, answers: {}, score: 100, auto_score: 100, final_score: null, scoring_state: "provisional", written_review_required: true, written_review_completed: false, mastery_met: true });
    expect(falseMastery.error?.code).toBe("23514");
  });
});
