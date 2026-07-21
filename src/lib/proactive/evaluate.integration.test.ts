import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { enqueueProactiveEvaluation, enqueueScheduledFamilyEvaluations, processProactiveEvaluation } from "./evaluate";
import { dateInTimezone } from "@/lib/schedule/dates";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
let userId = "";
let familyId = "";
let trendStudentId = "";
let singleStudentId = "";
let improvementStudentId = "";

beforeAll(async () => {
  if (!url || !secret) throw new Error("Local Supabase is required for proactive integration tests.");
  const user = await admin.auth.admin.createUser({ email: `proactive-${crypto.randomUUID()}@example.test`, password: "KlioProactive123", email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Proactive integration", created_by: userId, available_days: [1, 2, 3, 4, 5], timezone: "America/New_York" }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const member = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  if (member.error) throw member.error;
  const students = await admin.from("students").insert([
    { family_id: familyId, display_name: "Trend learner", grade_band: "6-8", daily_capacity_minutes: 180 },
    { family_id: familyId, display_name: "Single result learner", grade_band: "6-8", daily_capacity_minutes: 180 },
    { family_id: familyId, display_name: "Improvement learner", grade_band: "6-8", daily_capacity_minutes: 180 },
  ]).select("id,display_name");
  if (students.error) throw students.error;
  trendStudentId = students.data.find((item) => item.display_name === "Trend learner")!.id;
  singleStudentId = students.data.find((item) => item.display_name === "Single result learner")!.id;
  improvementStudentId = students.data.find((item) => item.display_name === "Improvement learner")!.id;
  const policy = await admin.from("family_autonomy_policies").insert({ family_id: familyId, preset: "proactive", policies: {}, updated_by: userId });
  if (policy.error) throw policy.error;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function approvedResult(input: { studentId: string; score: number; date: string; sequence: number }) {
  const assignment = await admin.from("assignments").insert({ family_id: familyId, student_id: input.studentId, created_by: userId, title: `Biology · Osmosis ${input.sequence}`, subject: "Biology", scheduled_date: input.date, estimated_minutes: 35, sequence_number: input.sequence }).select("id").single();
  if (assignment.error) throw assignment.error;
  const submission = await admin.from("assignment_submissions").insert({ family_id: familyId, assignment_id: assignment.data.id, student_id: input.studentId, submitted_by: userId, status: "reviewed", submitted_at: `${input.date}T15:00:00.000Z` }).select("id").single();
  if (submission.error) throw submission.error;
  const review = await admin.from("assignment_reviews").insert({ family_id: familyId, assignment_id: assignment.data.id, submission_id: submission.data.id, student_id: input.studentId, status: "approved", grading_state: "final", written_review_required: true, written_review_completed: true, score: input.score, reviewed_by: userId, reviewed_at: `${input.date}T16:00:00.000Z`, skill_key: "biology.osmosis_explanations", evidence_kind: "curriculum", comparable_key: "biology:osmosis-explanations", feedback: "The explanation needs to connect water movement to concentration and water movement in osmosis." }).select("id").single();
  if (review.error) throw review.error;
  return review.data.id;
}

describe("proactive operating loop", () => {
  it("turns three related approved downward results into one grounded scheduled practice", async () => {
    await approvedResult({ studentId: trendStudentId, score: 86, date: "2026-07-06", sequence: 1 });
    await approvedResult({ studentId: trendStudentId, score: 78, date: "2026-07-08", sequence: 2 });
    const latestReviewId = await approvedResult({ studentId: trendStudentId, score: 69, date: "2026-07-10", sequence: 3 });
    const key = `grade-approved:${latestReviewId}`;
    const queued = await enqueueProactiveEvaluation({ familyId, studentId: trendStudentId, requestedBy: userId, eventKind: "grade_approved", entityType: "assignment_review", entityId: latestReviewId, idempotencyKey: key });
    const outcome = await processProactiveEvaluation(queued.evaluation.id);
    expect(outcome?.outcome).toBe("automatic_action");

    const [practice, scheduled, insights, proposals] = await Promise.all([
      admin.from("practice_sessions").select("id,spec").eq("family_id", familyId).eq("student_id", trendStudentId),
      admin.from("assignments").select("id,source_kind,subject,scheduled_date").eq("family_id", familyId).eq("student_id", trendStudentId).eq("source_kind", "practice"),
      admin.from("klio_insights").select("id,evidence_refs,action_ref").eq("family_id", familyId).eq("student_id", trendStudentId),
      admin.from("adjustment_proposals").select("id,status").eq("family_id", familyId).eq("student_id", trendStudentId),
    ]);
    expect(practice.error ?? scheduled.error ?? insights.error ?? proposals.error).toBeNull();
    expect(practice.data).toHaveLength(1);
    expect(scheduled.data).toHaveLength(1);
    expect(scheduled.data?.[0]).toMatchObject({ source_kind: "practice", subject: "Biology" });
    expect((scheduled.data?.[0]?.scheduled_date ?? "") >= "2026-07-15").toBe(true);
    expect(insights.data).toHaveLength(1);
    expect(insights.data?.[0]?.evidence_refs).toHaveLength(3);
    expect(proposals.data).toEqual([expect.objectContaining({ status: "applied" })]);

    const duplicate = await enqueueProactiveEvaluation({ familyId, studentId: trendStudentId, requestedBy: userId, eventKind: "grade_approved", entityType: "assignment_review", entityId: latestReviewId, idempotencyKey: key });
    expect(duplicate.duplicate).toBe(true);
    await processProactiveEvaluation(duplicate.evaluation.id);
    expect((await admin.from("practice_sessions").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("student_id", trendStudentId)).count).toBe(1);

    const proposalId = proposals.data![0].id;
    const undone = await admin.rpc("undo_klio_adjustment", { p_proposal_id: proposalId, p_actor_id: userId });
    expect(undone.error).toBeNull();
    expect(undone.data).toMatchObject({ status: "undone" });
    expect((await admin.from("assignments").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("student_id", trendStudentId).eq("source_kind", "practice")).count).toBe(0);
    expect((await admin.from("assignments").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("student_id", trendStudentId).eq("source_kind", "curriculum")).count).toBe(3);
  });

  it("records a quiet no-op for one low approved result", async () => {
    const reviewId = await approvedResult({ studentId: singleStudentId, score: 54, date: "2026-07-11", sequence: 1 });
    const queued = await enqueueProactiveEvaluation({ familyId, studentId: singleStudentId, requestedBy: userId, eventKind: "grade_approved", entityType: "assignment_review", entityId: reviewId, idempotencyKey: `single-low:${reviewId}` });
    const outcome = await processProactiveEvaluation(queued.evaluation.id);
    expect(outcome?.outcome).toBe("no_action");
    expect((await admin.from("assignments").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("student_id", singleStudentId).eq("source_kind", "practice")).count).toBe(0);
    expect((await admin.from("klio_insights").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("student_id", singleStudentId)).count).toBe(0);
  });

  it("retires a schedule question after its lessons are completed or manually moved", async () => {
    const sourceDate = "2026-07-24";
    const lessons = await admin.from("assignments").insert([
      { family_id: familyId, student_id: singleStudentId, created_by: userId, title: "Reading · Carryover A", subject: "Reading", status: "planned", scheduled_date: sourceDate, estimated_minutes: 20 },
      { family_id: familyId, student_id: singleStudentId, created_by: userId, title: "Reading · Carryover B", subject: "Reading", status: "planned", scheduled_date: sourceDate, estimated_minutes: 20 },
      { family_id: familyId, student_id: singleStudentId, created_by: userId, title: "Reading · Carryover C", subject: "Reading", status: "planned", scheduled_date: sourceDate, estimated_minutes: 20 },
    ]).select("id");
    if (lessons.error) throw lessons.error;
    const [first, second, moved] = lessons.data;
    const completionInsight = await admin.from("klio_insights").insert({
      family_id: familyId, student_id: singleStudentId, kind: "needs_detail", status: "active",
      title: "Two lessons need another day", summary: "The current day is full.", reason: "No safe slot.", priority: 93,
      evidence_refs: [first, second].map((assignment) => ({ type: "assignment", id: assignment.id })),
      action_ref: { type: "week", date: sourceDate, studentId: singleStudentId, assignmentIds: [first.id, second.id] },
      dedupe_key: `resolved-by-completion:${crypto.randomUUID()}`,
    }).select("id").single();
    if (completionInsight.error) throw completionInsight.error;
    const moveInsight = await admin.from("klio_insights").insert({
      family_id: familyId, student_id: singleStudentId, kind: "needs_detail", status: "active",
      title: "One lesson needs another day", summary: "The current day is full.", reason: "No safe slot.", priority: 93,
      evidence_refs: [{ type: "assignment", id: moved.id }],
      action_ref: { type: "week", date: sourceDate, studentId: singleStudentId, assignmentIds: [moved.id] },
      dedupe_key: `resolved-by-move:${crypto.randomUUID()}`,
    }).select("id").single();
    if (moveInsight.error) throw moveInsight.error;

    for (const assignment of [first, second]) {
      const completedAt = new Date().toISOString();
      await admin.from("assignments").update({ status: "completed", completed_at: completedAt }).eq("id", assignment.id);
      const queued = await enqueueProactiveEvaluation({ familyId, studentId: singleStudentId, requestedBy: userId, eventKind: "assignment_completed", entityType: "assignment", entityId: assignment.id, idempotencyKey: `resolve-completed:${assignment.id}:${completedAt}` });
      await processProactiveEvaluation(queued.evaluation.id);
      const status = (await admin.from("klio_insights").select("status").eq("id", completionInsight.data.id).single()).data?.status;
      expect(status).toBe(assignment.id === first.id ? "active" : "superseded");
    }

    const movedDate = "2026-07-27";
    await admin.from("assignments").update({ scheduled_date: movedDate }).eq("id", moved.id);
    const movedEvaluation = await enqueueProactiveEvaluation({ familyId, studentId: singleStudentId, requestedBy: userId, eventKind: "schedule_adjusted", entityType: "assignment", entityId: moved.id, idempotencyKey: `resolve-moved:${moved.id}:${movedDate}` });
    await processProactiveEvaluation(movedEvaluation.evaluation.id);
    expect((await admin.from("klio_insights").select("status").eq("id", moveInsight.data.id).single()).data?.status).toBe("superseded");
  });

  it("removes unnecessary supplemental practice after sustained improvement and can restore it", async () => {
    const curriculum = await admin.from("assignments").insert({ family_id: familyId, student_id: improvementStudentId, created_by: userId, title: "Biology · Curriculum lesson", subject: "Biology", source_kind: "curriculum", scheduled_date: "2026-07-21" }).select("id").single();
    if (curriculum.error) throw curriculum.error;
    const artifact = await admin.from("artifacts").insert({ family_id: familyId, student_id: improvementStudentId, created_by: userId, type: "practice", title: "Osmosis support", status: "approved", content: {} }).select("id").single();
    if (artifact.error) throw artifact.error;
    const session = await admin.from("practice_sessions").insert({ family_id: familyId, student_id: improvementStudentId, artifact_id: artifact.data.id, created_by: userId, status: "completed", spec: { subject: "Biology", skill_key: "biology.osmosis_explanations" } }).select("id").single();
    if (session.error) throw session.error;
    const extra = await admin.from("assignments").insert({ family_id: familyId, student_id: improvementStudentId, created_by: userId, created_by_type: "agent", title: "Biology · Osmosis support", subject: "Biology", source_kind: "practice", scheduled_date: "2026-07-20", estimated_minutes: 10 }).select("id").single();
    if (extra.error) throw extra.error;
    const results = await admin.from("practice_results").insert([82, 88, 94].map((score, index) => ({ family_id: familyId, student_id: improvementStudentId, practice_session_id: session.data.id, answers: {}, score, auto_score: score, final_score: score, scoring_state: "final" as const, written_review_completed: true, finalized_by: userId, finalized_at: `2026-07-${12 + index}T15:00:00Z`, mastery_met: true, created_at: `2026-07-${12 + index}T15:00:00Z` }))).select("id,score");
    if (results.error) throw results.error;
    const latest = results.data.find((item) => Number(item.score) === 94)!;
    const queued = await enqueueProactiveEvaluation({ familyId, studentId: improvementStudentId, requestedBy: userId, eventKind: "practice_completed", entityType: "practice_result", entityId: latest.id, idempotencyKey: `improvement:${latest.id}` });
    const outcome = await processProactiveEvaluation(queued.evaluation.id);
    expect(outcome?.outcome).toBe("automatic_action");
    expect((await admin.from("assignments").select("status,scheduled_date").eq("id", extra.data.id).single()).data).toMatchObject({ status: "skipped", scheduled_date: null });
    expect((await admin.from("assignments").select("status,scheduled_date").eq("id", curriculum.data.id).single()).data).toMatchObject({ status: "planned", scheduled_date: "2026-07-21" });
    const proposal = await admin.from("adjustment_proposals").select("id,status").eq("family_id", familyId).eq("student_id", improvementStudentId).eq("status", "applied").single();
    if (proposal.error) throw proposal.error;
    const undone = await admin.rpc("undo_klio_adjustment", { p_proposal_id: proposal.data.id, p_actor_id: userId });
    expect(undone.error).toBeNull();
    expect((await admin.from("assignments").select("status,scheduled_date").eq("id", extra.data.id).single()).data).toMatchObject({ status: "planned", scheduled_date: "2026-07-20" });
    expect((await admin.from("assignments").select("status,scheduled_date").eq("id", curriculum.data.id).single()).data).toMatchObject({ status: "planned", scheduled_date: "2026-07-21" });
  });

  it("routes daily and weekly boundaries idempotently and keeps their no-op quiet", async () => {
    const now = new Date("2026-07-13T22:00:00Z");
    await enqueueScheduledFamilyEvaluations(now, familyId);
    await enqueueScheduledFamilyEvaluations(now, familyId);
    const scheduled = await admin.from("proactive_evaluations").select("id,event_kind,status,idempotency_key").eq("family_id", familyId).in("event_kind", ["day_preparation", "day_reconciliation", "weekly_boundary"]);
    if (scheduled.error) throw scheduled.error;
    expect(scheduled.data.map((item) => item.event_kind).sort()).toEqual(["day_preparation", "day_reconciliation", "weekly_boundary"]);
    const preparation = scheduled.data.find((item) => item.event_kind === "day_preparation")!;
    const result = await processProactiveEvaluation(preparation.id);
    expect(result?.outcome).toBe("no_action");
    expect((await admin.from("klio_insights").select("id", { count: "exact", head: true }).eq("evaluation_id", preparation.id)).count).toBe(0);
    const weekly = scheduled.data.find((item) => item.event_kind === "weekly_boundary")!;
    await processProactiveEvaluation(weekly.id);
    const briefings = await admin.from("weekly_briefings").select("id,week_start,status,sections,evaluation_id").eq("family_id", familyId).eq("week_start", "2026-07-13");
    expect(briefings.error).toBeNull();
    expect(briefings.data).toHaveLength(1);
    expect(briefings.data![0]).toMatchObject({ week_start: "2026-07-13", status: "active", evaluation_id: weekly.id });
    expect(briefings.data![0].sections).toMatchObject({ headline: "Your week at a glance", weekStart: "2026-07-13" });
    await processProactiveEvaluation(weekly.id);
    expect((await admin.from("weekly_briefings").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("week_start", "2026-07-13")).count).toBe(1);
  });

  it("catches up after Monday and keeps one evaluation and briefing for the local week", async () => {
    const tuesday = new Date("2026-07-21T15:00:00Z");
    expect(await enqueueScheduledFamilyEvaluations(tuesday, familyId)).toBeGreaterThan(0);
    await enqueueScheduledFamilyEvaluations(tuesday, familyId);
    const weekly = await admin.from("proactive_evaluations").select("id,idempotency_key,status").eq("family_id", familyId).eq("idempotency_key", "weekly-briefing:2026-07-20");
    expect(weekly.error).toBeNull();
    expect(weekly.data).toHaveLength(1);
    const concurrent = await Promise.all([processProactiveEvaluation(weekly.data![0].id), processProactiveEvaluation(weekly.data![0].id)]);
    expect(concurrent.filter(Boolean)).toHaveLength(1);
    const briefings = await admin.from("weekly_briefings").select("id,week_start").eq("family_id", familyId).eq("week_start", "2026-07-20");
    expect(briefings.error).toBeNull();
    expect(briefings.data).toEqual([expect.objectContaining({ week_start: "2026-07-20" })]);
  });

  it("does not fail a scheduled sweep when its target family is already deleted", async () => {
    const deleted = await admin.from("families").insert({ name: "Deleted before sweep", created_by: userId, timezone: "America/New_York" }).select("id").single();
    if (deleted.error) throw deleted.error;
    await admin.from("families").delete().eq("id", deleted.data.id);
    await expect(enqueueScheduledFamilyEvaluations(new Date("2026-07-21T15:00:00Z"), deleted.data.id)).resolves.toBe(0);
  });

  it("keeps a failed weekly briefing durable and succeeds on its next retry", async () => {
    const family = await admin.from("families").insert({ name: "Weekly retry", created_by: userId, timezone: "Invalid/Timezone" }).select("id").single();
    if (family.error) throw family.error;
    try {
      const queued = await enqueueProactiveEvaluation({ familyId: family.data.id, requestedBy: userId, eventKind: "weekly_boundary", entityType: "family", entityId: family.data.id, idempotencyKey: "weekly-briefing:2026-07-20" });
      await expect(processProactiveEvaluation(queued.evaluation.id)).rejects.toThrow();
      expect((await admin.from("proactive_evaluations").select("status,attempt_count,error_code").eq("id", queued.evaluation.id).single()).data).toMatchObject({ status: "queued", attempt_count: 1 });
      await admin.from("families").update({ timezone: "America/New_York" }).eq("id", family.data.id);
      await expect(processProactiveEvaluation(queued.evaluation.id)).resolves.toMatchObject({ outcome: "no_action" });
      expect((await admin.from("proactive_evaluations").select("status,attempt_count").eq("id", queued.evaluation.id).single()).data).toMatchObject({ status: "completed", attempt_count: 2 });
      expect((await admin.from("weekly_briefings").select("id", { count: "exact", head: true }).eq("family_id", family.data.id).eq("week_start", "2026-07-20")).count).toBe(1);
    } finally {
      await admin.from("families").delete().eq("id", family.data.id);
    }
  });

  it("treats an ordinary planned teaching day as ready, not unfinished", async () => {
    const student = await admin.from("students").insert({ family_id: familyId, display_name: "Ready learner", grade_band: "3-5", daily_capacity_minutes: 120 }).select("id").single();
    if (student.error) throw student.error;
    const today = dateInTimezone(new Date(), "America/New_York");
    const assignment = await admin.from("assignments").insert({ family_id: familyId, student_id: student.data.id, created_by: userId, title: "Ordinary reading lesson", subject: "Reading", status: "planned", scheduled_date: today, estimated_minutes: 30 }).select("id").single();
    if (assignment.error) throw assignment.error;
    const morning = await enqueueProactiveEvaluation({ familyId, studentId: student.data.id, requestedBy: userId, eventKind: "day_preparation", entityType: "family", entityId: familyId, idempotencyKey: `ready-morning:${today}:${student.data.id}` });
    const outcome = await processProactiveEvaluation(morning.evaluation.id);
    expect(outcome?.outcome).toBe("no_action");
    expect(outcome?.summary).toContain("planned lessons are ready");
    expect((await admin.from("klio_insights").select("id", { count: "exact", head: true }).eq("evaluation_id", morning.evaluation.id)).count).toBe(0);
  });

  it("executes a due reschedule reminder and leaves an undoable outcome", async () => {
    const student = await admin.from("students").insert({ family_id: familyId, display_name: "Autopilot learner", grade_band: "3-5", daily_capacity_minutes: 120 }).select("id").single();
    if (student.error) throw student.error;
    const today = dateInTimezone(new Date(), "America/New_York");
    const previous = shiftDate(today, -1);
    const curriculum = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: student.data.id, created_by: userId, subject: "History", title: "World History" }).select("id").single();
    if (curriculum.error) throw curriculum.error;
    const assignments = await admin.from("assignments").insert([
      { family_id: familyId, student_id: student.data.id, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "World History · Lesson 12", subject: "History", sequence_number: 12, status: "planned", scheduled_date: previous, estimated_minutes: 30 },
      { family_id: familyId, student_id: student.data.id, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "World History · Lesson 13", subject: "History", sequence_number: 13, status: "planned", scheduled_date: shiftDate(today, 2), estimated_minutes: 30 },
    ]).select("id,title,scheduled_date");
    if (assignments.error) throw assignments.error;
    const reminder = await admin.from("reminders").insert({ family_id: familyId, student_id: student.data.id, title: "Reschedule World History · Lesson 12", due_at: `${today}T16:00:00Z`, status: "pending", created_by_type: "parent", created_by: userId }).select("id").single();
    if (reminder.error) throw reminder.error;
    const morning = await enqueueProactiveEvaluation({ familyId, studentId: student.data.id, requestedBy: userId, eventKind: "day_preparation", entityType: "family", entityId: familyId, idempotencyKey: `autopilot-morning:${today}:${student.data.id}` });
    const outcome = await processProactiveEvaluation(morning.evaluation.id);
    expect(outcome?.outcome).toBe("automatic_action");
    expect((await admin.from("reminders").select("status").eq("id", reminder.data.id).single()).data?.status).toBe("completed");
    const proposal = await admin.from("adjustment_proposals").select("id,status,undo_status").eq("family_id", familyId).eq("student_id", student.data.id).single();
    expect(proposal.data).toMatchObject({ status: "applied", undo_status: "available" });
    expect((await admin.from("klio_insights").select("title").eq("evaluation_id", morning.evaluation.id)).data?.some((item) => item.title === "Today’s plan needs a quick look")).toBe(false);
  });

  it("repairs an overdue curriculum prerequisite without waiting for a reminder", async () => {
    const student = await admin.from("students").insert({ family_id: familyId, display_name: "Sequence learner", grade_band: "6-8", daily_capacity_minutes: 140 }).select("id").single();
    if (student.error) throw student.error;
    const today = dateInTimezone(new Date(), "America/New_York");
    const curriculum = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: student.data.id, created_by: userId, subject: "Math", title: "Algebra" }).select("id").single();
    if (curriculum.error) throw curriculum.error;
    await admin.from("assignments").insert([
      { family_id: familyId, student_id: student.data.id, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "Algebra · Lesson 8", subject: "Math", sequence_number: 8, status: "planned", scheduled_date: shiftDate(today, -1), estimated_minutes: 35 },
      { family_id: familyId, student_id: student.data.id, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "Algebra · Lesson 9", subject: "Math", sequence_number: 9, status: "planned", scheduled_date: today, estimated_minutes: 35 },
      { family_id: familyId, student_id: student.data.id, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "Algebra · Lesson 10", subject: "Math", sequence_number: 10, status: "planned", scheduled_date: shiftDate(today, 1), estimated_minutes: 35 },
    ]);
    const morning = await enqueueProactiveEvaluation({ familyId, studentId: student.data.id, requestedBy: userId, eventKind: "day_preparation", entityType: "family", entityId: familyId, idempotencyKey: `sequence-morning:${today}:${student.data.id}` });
    const outcome = await processProactiveEvaluation(morning.evaluation.id);
    expect(outcome?.outcome).toBe("automatic_action");
    expect((outcome?.result as { missingPrerequisiteAssignmentIds: string[] }).missingPrerequisiteAssignmentIds).toEqual([]);
    expect((await admin.from("adjustment_proposals").select("status,undo_status").eq("family_id", familyId).eq("student_id", student.data.id).single()).data).toMatchObject({ status: "applied", undo_status: "available" });
    expect((await admin.from("klio_insights").select("title").eq("evaluation_id", morning.evaluation.id)).data?.some((item) => item.title.includes("out of sequence"))).toBe(false);
  });

  it("turns a submitted review and a conflicted morning plan into useful outcomes", async () => {
    const assignment = await admin.from("assignments").insert({ family_id: familyId, student_id: singleStudentId, created_by: userId, title: "Written science explanation", subject: "Science", status: "submitted" }).select("id").single();
    if (assignment.error) throw assignment.error;
    const submission = await admin.from("assignment_submissions").insert({ family_id: familyId, assignment_id: assignment.data.id, student_id: singleStudentId, submitted_by: userId, status: "ready_for_review" }).select("id").single();
    if (submission.error) throw submission.error;
    const review = await admin.from("assignment_reviews").insert({ family_id: familyId, assignment_id: assignment.data.id, submission_id: submission.data.id, student_id: singleStudentId, status: "draft", grading_state: "provisional", written_review_required: true, written_review_completed: false, uncertainty_flags: ["Written response requires parent review."] }).select("id").single();
    if (review.error) throw review.error;
    const submitted = await enqueueProactiveEvaluation({ familyId, studentId: singleStudentId, requestedBy: userId, eventKind: "assignment_submitted", entityType: "assignment_submission", entityId: submission.data.id, idempotencyKey: `meaningful-submission:${submission.data.id}` });
    expect((await processProactiveEvaluation(submitted.evaluation.id))?.outcome).toBe("insight");
    expect((await admin.from("klio_insights").select("action_ref").eq("evaluation_id", submitted.evaluation.id).single()).data?.action_ref).toMatchObject({ type: "assignment_review", reviewId: review.data.id });

    const today = dateInTimezone(new Date(), "America/New_York");
    const curriculum = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: singleStudentId, created_by: userId, subject: "Math", title: "Algebra sequence" }).select("id").single();
    if (curriculum.error) throw curriculum.error;
    await admin.from("assignments").insert([
      { family_id: familyId, student_id: singleStudentId, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "Prerequisite", subject: "Math", sequence_number: 1, status: "doing", estimated_minutes: 40 },
      { family_id: familyId, student_id: singleStudentId, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "Today 1", subject: "Math", sequence_number: 2, status: "planned", scheduled_date: today, estimated_minutes: 120 },
      { family_id: familyId, student_id: singleStudentId, curriculum_unit_id: curriculum.data.id, created_by: userId, title: "Today 2", subject: "Math", sequence_number: 3, status: "planned", scheduled_date: today, estimated_minutes: 120 },
    ]);
    const morning = await enqueueProactiveEvaluation({ familyId, studentId: singleStudentId, requestedBy: userId, eventKind: "day_preparation", entityType: "family", entityId: familyId, idempotencyKey: `meaningful-morning:${today}:${singleStudentId}` });
    const outcome = await processProactiveEvaluation(morning.evaluation.id);
    expect(outcome?.outcome).toBe("insight");
    expect(outcome?.result).toMatchObject({ capacityConflictStudentIds: [singleStudentId] });
    expect((outcome?.result as { missingPrerequisiteAssignmentIds: string[] }).missingPrerequisiteAssignmentIds).toHaveLength(2);
    const insightTitles = (await admin.from("klio_insights").select("title").eq("evaluation_id", morning.evaluation.id)).data?.map((item) => item.title) ?? [];
    expect(insightTitles).toContain("Math is out of sequence");
    expect(insightTitles.some((title) => title.includes("quick look"))).toBe(false);
  });

  it("enforces never and turns ask into an answerable clarification", async () => {
    const students = await admin.from("students").insert([
      { family_id: familyId, display_name: "Never learner", grade_band: "6-8" },
      { family_id: familyId, display_name: "Ask learner", grade_band: "6-8" },
    ]).select("id,display_name");
    if (students.error) throw students.error;
    const neverStudent = students.data.find((item) => item.display_name === "Never learner")!.id;
    const askStudent = students.data.find((item) => item.display_name === "Ask learner")!.id;
    const neverReviews = [];
    for (const [index, score] of [86, 76, 64].entries()) neverReviews.push(await approvedResult({ studentId: neverStudent, score, date: `2026-06-${String(10 + index).padStart(2, "0")}`, sequence: index + 1 }));
    await admin.from("family_autonomy_policies").update({ preset: "custom", policies: { build_supplemental_practice: "never" } }).eq("family_id", familyId);
    const denied = await enqueueProactiveEvaluation({ familyId, studentId: neverStudent, requestedBy: userId, eventKind: "grade_approved", entityType: "assignment_review", entityId: neverReviews.at(-1)!, idempotencyKey: `never-practice:${neverStudent}` });
    expect((await processProactiveEvaluation(denied.evaluation.id))?.outcome).toBe("no_action");
    expect((await admin.from("artifacts").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("student_id", neverStudent).eq("type", "practice")).count).toBe(0);

    const askReviews = [];
    for (const [index, score] of [88, 77, 62].entries()) askReviews.push(await approvedResult({ studentId: askStudent, score, date: `2026-06-${String(20 + index).padStart(2, "0")}`, sequence: index + 1 }));
    await admin.from("family_autonomy_policies").update({ preset: "custom", policies: { build_supplemental_practice: "ask" } }).eq("family_id", familyId);
    const asked = await enqueueProactiveEvaluation({ familyId, studentId: askStudent, requestedBy: userId, eventKind: "grade_approved", entityType: "assignment_review", entityId: askReviews.at(-1)!, idempotencyKey: `ask-practice:${askStudent}` });
    const askOutcome = await processProactiveEvaluation(asked.evaluation.id);
    expect(askOutcome?.outcome).toBe("review_required");
    const waiting = await admin.from("agent_turns").select("id,status,question_threads!question_threads_awaiting_turn_family_fkey(id,status,question_messages!question_messages_thread_id_fkey(role,content))").eq("id", (askOutcome?.result as { turnId: string }).turnId).single();
    expect(waiting.data?.status).toBe("awaiting_parent");
    expect(waiting.data?.question_threads[0]?.question_messages.some((message) => message.role === "assistant" && message.content.includes("Would you like"))).toBe(true);
  });
});

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
