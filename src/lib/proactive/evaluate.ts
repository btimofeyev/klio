import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { learnerWeekdays, scheduleDates } from "@/lib/assignments/dates";
import { dateInTimezone } from "@/lib/schedule/dates";
import { buildTargetedPractice } from "./practice";
import { detectLearningTrend, type TrendEvidence } from "./trends";
import { policyDecision, policyForPreset, sanitizePolicy, type AutonomyPreset } from "@/lib/autonomy/policy";
import type { Json } from "@/lib/supabase/database.types";
import { fairFamilyQueue, runBounded } from "@/lib/worker/concurrency";
import { findFamilyCrowdedOutSubjects, refreshFamilyPacingCheckpoints } from "@/lib/pacing/refresh";
import { enqueueWorkspaceTurn } from "@/lib/agent/workspace/turns";
import { moveUnfinishedWork, recordExplicitCompletion } from "./adjustments";
import { enqueueProactiveEvaluation } from "./queue";
import { weeklyBriefingSchedule } from "./weekly-schedule";
import { createWeeklyFamilyBriefing } from "./weekly-briefing-store";
import { loadAvailabilityByDate } from "@/lib/schedule/availability-data";

export { enqueueProactiveEvaluation } from "./queue";

export type ProactiveEventKind =
  | "assignment_completed" | "assignment_submitted" | "grade_approved" | "practice_completed"
  | "assignment_unfinished" | "schedule_adjusted" | "capture_filed" | "parent_correction"
  | "day_reconciliation" | "day_preparation" | "weekly_boundary" | "evidence_changed" | "manual";

export async function processProactiveEvaluation(evaluationId: string) {
  const admin = createAdminClient();
  const current = await admin.from("proactive_evaluations").select("*").eq("id", evaluationId).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data || ["completed", "failed", "cancelled"].includes(current.data.status)) return;
  if (current.data.status !== "queued") return;
  const leaseToken = crypto.randomUUID();
  const lease = await admin.rpc("acquire_family_execution_lease", { p_family_id: current.data.family_id, p_owner_token: leaseToken, p_work_kind: "proactive_evaluation", p_work_id: current.data.id, p_ttl_seconds: 120 });
  if (lease.error) throw lease.error;
  if (!lease.data) return;
  const now = new Date().toISOString();
  const claimed = await admin.from("proactive_evaluations").update({
    status: "running", started_at: current.data.started_at ?? now, last_heartbeat_at: now,
    last_progress_at: now, attempt_count: Math.min(current.data.attempt_count + 1, 3), error_code: null,
  }).eq("id", evaluationId).eq("status", "queued").select("*").maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) {
    await admin.rpc("release_family_execution_lease", { p_family_id: current.data.family_id, p_owner_token: leaseToken });
    return;
  }
  const evaluation = { ...claimed.data, event_kind: claimed.data.event_kind as ProactiveEventKind };
  try {
    const result = evaluation.event_kind === "grade_approved"
      ? await evaluateApprovedGrade(evaluation)
      : evaluation.event_kind === "practice_completed"
        ? await evaluatePracticeCompletion(evaluation)
        : await evaluateOperationalEvent(evaluation);
    const completedAt = new Date().toISOString();
    await admin.from("proactive_evaluations").update({
      status: "completed", outcome: result.outcome, summary: result.summary, result: result.result as Json,
      completed_at: completedAt, last_heartbeat_at: completedAt, last_progress_at: completedAt,
    }).eq("id", evaluationId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 120) : "PROACTIVE_EVALUATION_FAILED";
    await admin.from("proactive_evaluations").update({
      status: claimed.data.attempt_count >= 2 ? "failed" : "queued",
      error_code: message,
      completed_at: claimed.data.attempt_count >= 2 ? new Date().toISOString() : null,
      last_heartbeat_at: new Date().toISOString(),
    }).eq("id", evaluationId);
    throw error;
  } finally {
    await admin.rpc("release_family_execution_lease", { p_family_id: evaluation.family_id, p_owner_token: leaseToken });
  }
}

export async function processQueuedProactiveEvaluations(limit = 8, concurrency = 4) {
  const admin = createAdminClient();
  const staleBefore = new Date(Date.now() - 90_000).toISOString();
  await admin.from("proactive_evaluations").update({ status: "queued", error_code: "RECOVERED_STALE_EVALUATION" })
    .eq("status", "running").lt("last_heartbeat_at", staleBefore).lt("attempt_count", 3);
  await admin.from("proactive_evaluations").update({ status: "failed", outcome: "no_action", error_code: "RETRY_LIMIT_REACHED", completed_at: new Date().toISOString() })
    .in("status", ["queued", "running"]).gte("attempt_count", 3);
  const queued = await admin.from("proactive_evaluations").select("id,family_id").eq("status", "queued").order("queued_at").limit(Math.max(limit * 5, 40));
  if (queued.error) throw queued.error;
  await runBounded(fairFamilyQueue(queued.data, limit), concurrency, async (item) => {
    try { await processProactiveEvaluation(item.id); }
    catch { /* The durable row records retry or terminal failure. */ }
  });
}

export async function enqueueScheduledFamilyEvaluations(now = new Date(), familyId?: string) {
  const admin = createAdminClient();
  let query = admin.from("families").select("id,timezone");
  if (familyId) query = query.eq("id", familyId);
  const families = await query;
  if (families.error) throw families.error;
  let queued = 0;
  for (const family of families.data) {
    const local = safeLocalClock(now, family.timezone);
    if (!local) continue;
    const weekly = weeklyBriefingSchedule(now, family.timezone);
    const events: Array<{ kind: ProactiveEventKind; idempotencyKey: string }> = [];
    if (local.hour >= 5) events.push({ kind: "day_preparation", idempotencyKey: `morning:${local.date}` });
    if (local.hour >= 17) events.push({ kind: "day_reconciliation", idempotencyKey: `evening:${local.date}` });
    if (weekly?.due) events.push({ kind: "weekly_boundary", idempotencyKey: weekly.idempotencyKey });
    for (const event of events) {
      try {
        const result = await enqueueProactiveEvaluation({ familyId: family.id, eventKind: event.kind, entityType: "family", entityId: family.id, idempotencyKey: event.idempotencyKey });
        if (!result.duplicate) queued += 1;
      } catch (error) {
        // A family can be deleted after the sweep reads it. That is a completed
        // lifecycle transition, not a reason to take the durable worker down.
        if (databaseErrorCode(error) !== "23503") throw error;
        break;
      }
    }
  }
  return queued;
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function safeLocalClock(now: Date, timeZone: string) {
  try { return localClock(now, timeZone); }
  catch (error) { if (error instanceof RangeError) return null; throw error; }
}

async function evaluateOperationalEvent(evaluation: EvaluationRow) {
  switch (evaluation.event_kind) {
    case "assignment_submitted": return evaluateSubmission(evaluation);
    case "assignment_completed": return evaluateCompletion(evaluation);
    case "assignment_unfinished": return evaluateUnfinished(evaluation);
    case "schedule_adjusted": return evaluateScheduleChange(evaluation);
    case "capture_filed": return evaluateCaptureFiled(evaluation);
    case "parent_correction":
    case "evidence_changed": return evaluateCorrection(evaluation);
    case "day_preparation": return evaluateDayBoundary(evaluation, "morning");
    case "day_reconciliation": return evaluateDayBoundary(evaluation, "evening");
    case "weekly_boundary": return evaluateWeeklyBoundary(evaluation);
    case "manual": return evaluation.student_id ? evaluateDayBoundary(evaluation, "morning") : evaluateWeeklyBoundary(evaluation);
    default: return noAction("The event was recorded and required no follow-through.");
  }
}

async function evaluateSubmission(evaluation: EvaluationRow) {
  if (!evaluation.entity_id) return noAction("The submission event had no source reference.");
  const admin = createAdminClient();
  const submission = await admin.from("assignment_submissions").select("id,assignment_id,student_id,status,submitted_at,assignments(title,subject)")
    .eq("family_id", evaluation.family_id).eq("id", evaluation.entity_id).maybeSingle();
  if (submission.error) throw submission.error;
  if (!submission.data) return noAction("The submission is no longer active.");
  const review = await admin.from("assignment_reviews").select("id,status,uncertainty_flags").eq("family_id", evaluation.family_id).eq("submission_id", submission.data.id).in("status", ["draft", "approved"]).maybeSingle();
  if (review.error) throw review.error;
  const assignment = Array.isArray(submission.data.assignments) ? submission.data.assignments[0] : submission.data.assignments;
  if (!review.data) return noAction("The submission is saved and waiting for the bounded review draft worker.", { submissionId: submission.data.id, pendingReviewDraft: true });
  if (review.data.status === "approved") return noAction("The submitted work has already been reviewed.", { reviewId: review.data.id });
  await upsertInsight({ evaluation, kind: "review_ready", title: `${assignment?.title ?? "Submitted work"} is ready to review`, summary: "Klio prepared a draft from the assignment directions and submitted evidence. The parent still controls the score and feedback.", reason: "A submitted assignment has a provisional draft review.", priority: 94, evidenceRefs: [{ type: "assignment_submission", id: submission.data.id }], actionRef: { type: "assignment_review", reviewId: review.data.id } });
  return { outcome: "insight" as const, summary: "A submitted assignment is ready for parent review.", result: { submissionId: submission.data.id, reviewId: review.data.id } };
}

async function evaluateCompletion(evaluation: EvaluationRow) {
  if (!evaluation.entity_id) return noAction("The completion event had no assignment reference.");
  const admin = createAdminClient();
  const assignment = await admin.from("assignments").select("id,student_id,curriculum_unit_id,title,subject,status,sequence_number")
    .eq("family_id", evaluation.family_id).eq("id", evaluation.entity_id).maybeSingle();
  if (assignment.error) throw assignment.error;
  if (!assignment.data || assignment.data.status !== "completed") return noAction("The assignment is not recorded as completed.");
  await supersedeResolvedScheduleQuestions(admin, evaluation.family_id, assignment.data.student_id, assignment.data.id);
  const next = assignment.data.curriculum_unit_id && assignment.data.sequence_number
    ? await admin.from("assignments").select("id,title,scheduled_date,status,sequence_number").eq("family_id", evaluation.family_id).eq("student_id", assignment.data.student_id).eq("curriculum_unit_id", assignment.data.curriculum_unit_id).gt("sequence_number", assignment.data.sequence_number).in("status", ["planned", "doing"]).order("sequence_number").limit(1).maybeSingle()
    : { data: null, error: null };
  if (next.error) throw next.error;
  return noAction(next.data ? "Completion recorded; the next curriculum assignment remains in sequence." : "Completion recorded; no additional operation was needed.", { assignmentId: assignment.data.id, nextAssignmentId: next.data?.id ?? null });
}

async function evaluateUnfinished(evaluation: EvaluationRow) {
  if (!evaluation.entity_id) return noAction("The unfinished-work event had no proposal reference.");
  const admin = createAdminClient();
  const proposal = await admin.from("adjustment_proposals").select("id,status,summary,reason,undo_status,student_id")
    .eq("family_id", evaluation.family_id).eq("id", evaluation.entity_id).maybeSingle();
  if (proposal.error) throw proposal.error;
  if (!proposal.data) return noAction("The unfinished-work proposal is no longer active.");
  await upsertInsight({ evaluation, kind: proposal.data.status === "applied" ? "adjusted" : "noticed", title: proposal.data.status === "applied" ? "Unfinished work was moved" : "Unfinished work needs a schedule decision", summary: proposal.data.summary, reason: proposal.data.reason, priority: 82, evidenceRefs: [], actionRef: { type: "adjustment_proposal", proposalId: proposal.data.id, undoAvailable: proposal.data.undo_status === "available" } });
  return { outcome: proposal.data.status === "applied" ? "automatic_action" as const : "review_required" as const, summary: proposal.data.summary, result: { proposalId: proposal.data.id, status: proposal.data.status } };
}

async function evaluateScheduleChange(evaluation: EvaluationRow) {
  if (!evaluation.entity_id || !evaluation.student_id) return noAction("The schedule change had no learner or assignment reference.");
  const admin = createAdminClient();
  const assignment = await admin.from("assignments").select("id,title,scheduled_date,estimated_minutes").eq("family_id", evaluation.family_id).eq("student_id", evaluation.student_id).eq("id", evaluation.entity_id).maybeSingle();
  if (assignment.error) throw assignment.error;
  if (assignment.data) await supersedeResolvedScheduleQuestions(admin, evaluation.family_id, evaluation.student_id, assignment.data.id);
  if (!assignment.data?.scheduled_date) return noAction("The schedule change left no dated work to evaluate.");
  const [student, day] = await Promise.all([
    admin.from("students").select("daily_capacity_minutes").eq("family_id", evaluation.family_id).eq("id", evaluation.student_id).single(),
    admin.from("assignments").select("estimated_minutes,status").eq("family_id", evaluation.family_id).eq("student_id", evaluation.student_id).eq("scheduled_date", assignment.data.scheduled_date).neq("status", "skipped"),
  ]);
  if (student.error ?? day.error) throw student.error ?? day.error;
  const plannedMinutes = day.data.reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0);
  if (plannedMinutes <= student.data.daily_capacity_minutes) return noAction("The adjusted day remains within the learner’s parent-set capacity.", { plannedMinutes, capacityMinutes: student.data.daily_capacity_minutes });
  await upsertInsight({ evaluation, kind: "noticed", title: `${assignment.data.scheduled_date} is over capacity`, summary: `${plannedMinutes} minutes are planned against a ${student.data.daily_capacity_minutes}-minute daily capacity.`, reason: "A parent schedule adjustment created a capacity conflict.", priority: 90, evidenceRefs: [{ type: "assignment", id: assignment.data.id }], actionRef: { type: "week", date: assignment.data.scheduled_date } });
  return { outcome: "insight" as const, summary: "The adjusted day exceeds learner capacity.", result: { plannedMinutes, capacityMinutes: student.data.daily_capacity_minutes } };
}

async function evaluateCaptureFiled(evaluation: EvaluationRow) {
  if (!evaluation.entity_id) return noAction("The capture event had no evidence reference.");
  const admin = createAdminClient();
  const evidence = await admin.from("evidence_items").select("id,processing_status,capture_route").eq("family_id", evaluation.family_id).eq("id", evaluation.entity_id).maybeSingle();
  if (evidence.error) throw evidence.error;
  if (!evidence.data) return noAction("The capture is no longer in the family record.");
  return noAction(evidence.data.processing_status === "ready" ? "The source was filed and needs no additional visible note." : "The source remains queued for organization.", { evidenceId: evidence.data.id, status: evidence.data.processing_status });
}

async function evaluateCorrection(evaluation: EvaluationRow) {
  const admin = createAdminClient();
  let query = admin.from("klio_insights").update({ status: "superseded" }).eq("family_id", evaluation.family_id).eq("status", "active");
  if (evaluation.student_id) query = query.eq("student_id", evaluation.student_id);
  const invalidated = await query.select("id");
  if (invalidated.error) throw invalidated.error;
  return noAction("The parent correction was saved and earlier recommendations for this learner were retired before future evaluation.", { supersededInsightCount: invalidated.data.length });
}

async function evaluateDayBoundary(evaluation: EvaluationRow, period: "morning" | "evening") {
  const admin = createAdminClient();
  const family = await admin.from("families").select("timezone").eq("id", evaluation.family_id).single();
  if (family.error) throw family.error;
  const today = dateInTimezone(new Date(), family.data.timezone);
  const dueReminders = await admin.from("reminders").select("id,title,due_at,student_id")
    .eq("family_id", evaluation.family_id).eq("status", "pending").lte("due_at", `${today}T23:59:59.999Z`);
  if (dueReminders.error) throw dueReminders.error;
  const reminderActions = await reconcileOperationalReminders({ evaluation, reminders: dueReminders.data, today });
  const [assignments, submissions, reminders, students, completedPlanRows] = await Promise.all([
    admin.from("assignments").select("id,student_id,title,subject,status,scheduled_date,estimated_minutes,due_at,curriculum_unit_id,sequence_number").eq("family_id", evaluation.family_id).eq("scheduled_date", today).neq("status", "skipped"),
    admin.from("assignment_submissions").select("id,student_id,status").eq("family_id", evaluation.family_id).in("status", ["received", "processing", "ready_for_review"]),
    admin.from("reminders").select("id,title,due_at,student_id").eq("family_id", evaluation.family_id).eq("status", "pending").lte("due_at", `${today}T23:59:59.999Z`),
    admin.from("students").select("id,display_name,daily_capacity_minutes").eq("family_id", evaluation.family_id).eq("active", true),
    admin.from("weekly_plan_items").select("id,assignment_id,student_id,assignments(status)").eq("family_id", evaluation.family_id).eq("scheduled_date", today).not("completed_at", "is", null).not("assignment_id", "is", null),
  ]);
  const error = assignments.error ?? submissions.error ?? reminders.error ?? students.error ?? completedPlanRows.error;
  if (error) throw error;
  const assignmentRows = assignments.data ?? [];
  const submissionRows = submissions.data ?? [];
  const reminderRows = reminders.data ?? [];
  const scopedAssignments = evaluation.student_id ? assignmentRows.filter((item) => item.student_id === evaluation.student_id) : assignmentRows;
  const unfinishedAssignments = period === "evening"
    ? scopedAssignments.filter((item) => ["planned", "doing"].includes(item.status))
    : [];
  const relevantSubmissions = evaluation.student_id ? submissionRows.filter((item) => item.student_id === evaluation.student_id) : submissionRows;
  const relevantReminders = (evaluation.student_id ? reminderRows.filter((item) => !item.student_id || item.student_id === evaluation.student_id) : reminderRows)
    .filter((item) => !isOperationalScheduleReminder(item.title));
  const unitIds = [...new Set(scopedAssignments.map((item) => item.curriculum_unit_id).filter((id): id is string => Boolean(id)))];
  const predecessors = unitIds.length ? await admin.from("assignments").select("id,student_id,title,subject,scheduled_date,curriculum_unit_id,sequence_number,status").eq("family_id", evaluation.family_id).in("curriculum_unit_id", unitIds).not("sequence_number", "is", null).not("status", "in", "(completed,skipped)").limit(500) : { data: [], error: null };
  if (predecessors.error) throw predecessors.error;
  const missingPrerequisites = scopedAssignments.filter((todayItem) => todayItem.curriculum_unit_id && todayItem.sequence_number !== null && predecessors.data.some((prior) => prior.student_id === todayItem.student_id && prior.curriculum_unit_id === todayItem.curriculum_unit_id && prior.sequence_number !== null && prior.sequence_number < todayItem.sequence_number!));
  const capacityConflicts = (students.data ?? []).filter((student) => (!evaluation.student_id || student.id === evaluation.student_id) && scopedAssignments.filter((item) => item.student_id === student.id && item.status !== "completed").reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0) > student.daily_capacity_minutes);
  const completedNotRecorded = (completedPlanRows.data ?? []).filter((item) => {
    if (evaluation.student_id && item.student_id !== evaluation.student_id) return false;
    const assignment = Array.isArray(item.assignments) ? item.assignments[0] : item.assignments;
    return assignment?.status !== "completed";
  });
  const actorId = evaluation.requested_by ?? await familyOwner(evaluation.family_id);
  const sequenceAppliedProposalIds: string[] = [];
  const sequenceReviewProposalIds: string[] = [];
  const repairedPrerequisiteIds = new Set<string>();
  const blockingPrerequisites = [...new Map(missingPrerequisites.flatMap((todayItem) => predecessors.data
    .filter((prior) => prior.student_id === todayItem.student_id && prior.curriculum_unit_id === todayItem.curriculum_unit_id && prior.sequence_number !== null && todayItem.sequence_number !== null && prior.sequence_number < todayItem.sequence_number && prior.scheduled_date && prior.scheduled_date < today)
    .map((prior) => [prior.id, prior] as const))).values()];
  const blockingByStudent = new Map<string, string[]>();
  for (const prior of blockingPrerequisites) blockingByStudent.set(prior.student_id, [...(blockingByStudent.get(prior.student_id) ?? []), prior.id]);
  for (const [studentId, assignmentIds] of blockingByStudent) {
    try {
      const moved = await moveUnfinishedWork({ familyId: evaluation.family_id, studentId, assignmentIds, actorId, idempotencyKey: `sequence-repair:${today}:${studentId}`, evaluationId: evaluation.id });
      if (moved.applied) {
        sequenceAppliedProposalIds.push(moved.proposal.id);
        assignmentIds.forEach((id) => repairedPrerequisiteIds.add(id));
        const retired = await admin.from("klio_insights").update({ status: "superseded" }).eq("family_id", evaluation.family_id).eq("student_id", studentId).eq("status", "active").ilike("title", "% is out of sequence");
        if (retired.error) throw retired.error;
      } else sequenceReviewProposalIds.push(moved.proposal.id);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "NO_CAPACITY_FOR_UNFINISHED_WORK") throw error;
    }
  }
  const unresolvedMissingPrerequisites = missingPrerequisites.filter((todayItem) => predecessors.data.some((prior) => prior.student_id === todayItem.student_id && prior.curriculum_unit_id === todayItem.curriculum_unit_id && prior.sequence_number !== null && todayItem.sequence_number !== null && prior.sequence_number < todayItem.sequence_number && !repairedPrerequisiteIds.has(prior.id)));
  const recordedCompletions: string[] = [];
  for (const item of completedNotRecorded) {
    if (!item.assignment_id) continue;
    await recordExplicitCompletion({ familyId: evaluation.family_id, assignmentId: item.assignment_id, actorId, idempotencyKey: `day-reconcile:${today}:${item.id}` });
    recordedCompletions.push(item.assignment_id);
  }
  const movedAppliedProposalIds: string[] = [];
  const movedReviewProposalIds: string[] = [];
  if (unfinishedAssignments.length) {
    const byStudent = new Map<string, string[]>();
    for (const assignment of unfinishedAssignments) byStudent.set(assignment.student_id, [...(byStudent.get(assignment.student_id) ?? []), assignment.id]);
    for (const [studentId, assignmentIds] of byStudent) {
      try {
        const moved = await moveUnfinishedWork({ familyId: evaluation.family_id, studentId, assignmentIds, actorId, idempotencyKey: `day-reconcile:${today}:${studentId}`, evaluationId: evaluation.id });
        (moved.applied ? movedAppliedProposalIds : movedReviewProposalIds).push(moved.proposal.id);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "NO_CAPACITY_FOR_UNFINISHED_WORK") throw error;
        const learner = (students.data ?? []).find((student) => student.id === studentId);
        const affected = unfinishedAssignments.filter((assignment) => assignmentIds.includes(assignment.id));
        const learnerName = learner?.display_name ?? "This learner";
        const learnerPossessive = `${learnerName}${learnerName.endsWith("s") ? "’" : "’s"}`;
        const title = affected.length === 1
          ? `${learnerPossessive} ${affected[0].title} needs another day`
          : `${learnerName} has ${affected.length} lessons that need another day`;
        await upsertInsight({ evaluation: { ...evaluation, student_id: studentId }, kind: "needs_detail", title, summary: `Klio checked the rest of the week and could not move ${affected.length === 1 ? "it" : "them"} without exceeding ${learnerPossessive} daily limit.`, reason: "Evening reconciliation could not find a safe slot without overloading the learner.", priority: 93, evidenceRefs: assignmentIds.map((id) => ({ type: "assignment", id })), actionRef: { type: "week", date: today, studentId, assignmentIds } });
      }
    }
  }

  let targetedInsights = 0;
  if (unresolvedMissingPrerequisites.length && !sequenceReviewProposalIds.length) {
    const first = unresolvedMissingPrerequisites[0];
    const prior = predecessors.data.find((item) => item.student_id === first.student_id && item.curriculum_unit_id === first.curriculum_unit_id && item.sequence_number !== null && first.sequence_number !== null && item.sequence_number < first.sequence_number);
    await upsertInsight({ evaluation: { ...evaluation, student_id: first.student_id }, kind: "noticed", title: `${first.subject} is out of sequence`, summary: `${prior?.title ?? "An earlier lesson"} needs a place before ${first.title}. Klio left today’s curriculum intact because the missing lesson has no confirmed schedule context.`, reason: "An earlier curriculum lesson is still open.", priority: 94, evidenceRefs: [prior?.id, first.id].filter(Boolean).map((id) => ({ type: "assignment", id })), actionRef: { type: "week", date: today } });
    targetedInsights += 1;
  }
  if (capacityConflicts.length && !unresolvedMissingPrerequisites.length) {
    const student = capacityConflicts[0];
    const plannedMinutes = scopedAssignments.filter((item) => item.student_id === student.id && item.status !== "completed").reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0);
    await upsertInsight({ evaluation: { ...evaluation, student_id: student.id }, kind: "noticed", title: `${student.display_name}’s plan is over capacity`, summary: `${plannedMinutes} minutes are scheduled against a ${student.daily_capacity_minutes}-minute limit. Klio preserved curriculum order and flagged the tradeoff instead of silently dropping work.`, reason: "The current day exceeds the parent-set learner capacity.", priority: 92, evidenceRefs: scopedAssignments.filter((item) => item.student_id === student.id).map((item) => ({ type: "assignment", id: item.id })), actionRef: { type: "week", date: today } });
    targetedInsights += 1;
  }
  const appliedProposalIds = [...reminderActions.appliedProposalIds, ...sequenceAppliedProposalIds, ...movedAppliedProposalIds];
  const reviewProposalIds = [...reminderActions.reviewProposalIds, ...sequenceReviewProposalIds, ...movedReviewProposalIds];
  const automaticActionCount = appliedProposalIds.length + recordedCompletions.length;
  const result = {
    date: today,
    automaticallyHandled: automaticActionCount,
    proposalIds: [...appliedProposalIds, ...reviewProposalIds],
    recordedCompletionAssignmentIds: recordedCompletions,
    submissionIds: relevantSubmissions.map((item) => item.id),
    reminderIds: relevantReminders.map((item) => item.id),
    missingPrerequisiteAssignmentIds: unresolvedMissingPrerequisites.map((item) => item.id),
    capacityConflictStudentIds: capacityConflicts.map((item) => item.id),
  };
  if (automaticActionCount) return { outcome: "automatic_action" as const, summary: `Klio handled ${automaticActionCount} routine ${automaticActionCount === 1 ? "item" : "items"} and left only meaningful exceptions visible.`, result };
  if (reviewProposalIds.length) return { outcome: "review_required" as const, summary: "Family policy requires review before Klio applies the prepared schedule repair.", result };
  if (targetedInsights) return { outcome: "insight" as const, summary: "Klio found a specific schedule exception that should remain visible.", result };
  return noAction(period === "morning" ? "Today’s planned lessons are ready; no operational intervention is needed." : "The day reconciled without unfinished work that needed moving.", result);
}

export function isOperationalScheduleReminder(title: string) {
  return /^Reschedule .+ · Lesson \d+$/i.test(title.trim());
}

async function reconcileOperationalReminders(input: { evaluation: EvaluationRow; reminders: Array<{ id: string; title: string; due_at: string | null; student_id: string | null }>; today: string }) {
  const operational = input.reminders.filter((item) => item.student_id && isOperationalScheduleReminder(item.title));
  if (!operational.length) return { appliedProposalIds: [] as string[], reviewProposalIds: [] as string[] };
  const admin = createAdminClient();
  const actorId = input.evaluation.requested_by ?? await familyOwner(input.evaluation.family_id);
  const completedReminderIds: string[] = [];
  const appliedProposalIds: string[] = [];
  const reviewProposalIds: string[] = [];
  for (const reminder of operational) {
    const assignmentTitle = reminder.title.trim().replace(/^Reschedule\s+/i, "");
    const assignment = await admin.from("assignments").select("id,status").eq("family_id", input.evaluation.family_id).eq("student_id", reminder.student_id!).eq("title", assignmentTitle).in("status", ["planned", "doing", "completed"]).order("scheduled_date").limit(1).maybeSingle();
    if (assignment.error) throw assignment.error;
    if (!assignment.data) continue;
    if (assignment.data.status === "completed") {
      completedReminderIds.push(reminder.id);
      continue;
    }
    try {
      const moved = await moveUnfinishedWork({ familyId: input.evaluation.family_id, studentId: reminder.student_id!, assignmentIds: [assignment.data.id], actorId, idempotencyKey: `operational-reminder:${reminder.id}`, evaluationId: input.evaluation.id });
      (moved.applied ? appliedProposalIds : reviewProposalIds).push(moved.proposal.id);
      if (moved.applied) completedReminderIds.push(reminder.id);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "NO_CAPACITY_FOR_UNFINISHED_WORK") throw error;
    }
  }
  if (completedReminderIds.length) {
    const completed = await admin.from("reminders").update({ status: "completed" }).eq("family_id", input.evaluation.family_id).in("id", completedReminderIds);
    if (completed.error) throw completed.error;
  }
  return { appliedProposalIds, reviewProposalIds };
}

async function evaluateWeeklyBoundary(evaluation: EvaluationRow) {
  const admin = createAdminClient();
  await refreshFamilyPacingCheckpoints({ familyId: evaluation.family_id, studentId: evaluation.student_id });
  const crowded = await findFamilyCrowdedOutSubjects({ familyId: evaluation.family_id, studentId: evaluation.student_id });
  const checkpoints = await admin.from("pacing_checkpoints").select("id,goal_id,student_id,state,feasible,actual_value,expected_value,as_of_date")
    .eq("family_id", evaluation.family_id).order("as_of_date", { ascending: false }).limit(100);
  if (checkpoints.error) throw checkpoints.error;
  const latestByGoal = [...new Map(checkpoints.data.map((checkpoint) => [checkpoint.goal_id, checkpoint])).values()];
  const concern = latestByGoal.filter((checkpoint) => ["at_risk", "blocked"].includes(checkpoint.state) || !checkpoint.feasible)
    .sort((a, b) => Number(b.expected_value) - Number(b.actual_value) - (Number(a.expected_value) - Number(a.actual_value)))[0];
  let evaluationResult: ReturnType<typeof noAction> | { outcome: "review_required"; summary: string; result: Record<string, unknown> };
  if (!concern && !crowded.length) {
    evaluationResult = noAction(latestByGoal.length ? "Current pacing checkpoints do not require a recommendation." : "No active pacing checkpoint exists yet; Klio left the weekly review quiet.", { checkpointCount: latestByGoal.length });
  } else if (!concern && crowded.length) {
    const first = crowded[0];
    await upsertInsight({ evaluation: { ...evaluation, student_id: first.studentId }, kind: "noticed", title: `${first.subject} is being crowded out`, summary: `${first.scheduledWeeklyMinutes} of ${first.expectedWeeklyMinutes} parent-planned minutes are scheduled while overall capacity is already ${Math.round(first.learnerCapacityConsumedRatio * 100)}% used.`, reason: "The parent-defined subject effort is short while the learner's week is nearly full.", priority: 89, evidenceRefs: [], actionRef: { type: "week" } });
    evaluationResult = { outcome: "review_required", summary: "Weekly capacity found a subject being crowded out.", result: { crowdedOut: crowded.slice(0, 5) } };
  } else {
    const prior = checkpoints.data.find((checkpoint) => checkpoint.goal_id === concern!.goal_id && checkpoint.id !== concern!.id);
    const change = prior ? { since: prior.as_of_date, actualDelta: Number(concern!.actual_value) - Number(prior.actual_value), expectedDelta: Number(concern!.expected_value) - Number(prior.expected_value), stateChanged: concern!.state !== prior.state, feasibilityChanged: concern!.feasible !== prior.feasible } : null;
    const crowdedForLearner = crowded.filter((item) => item.studentId === concern!.student_id).slice(0, 5);
    await upsertInsight({ evaluation: { ...evaluation, student_id: concern!.student_id }, kind: "noticed", title: concern!.state === "blocked" ? "A learning goal is blocked" : "A learning goal is behind pace", summary: `Actual progress is ${concern!.actual_value}; expected progress is ${concern!.expected_value}.${change ? ` Since ${change.since}, actual progress changed by ${change.actualDelta} while expected progress changed by ${change.expectedDelta}.` : ""}${crowdedForLearner.length ? ` ${crowdedForLearner[0].subject} is also short ${crowdedForLearner[0].shortfallMinutes} planned minutes.` : ""}`, reason: concern!.feasible ? "The learner is behind the parent-defined term pace." : "The remaining target does not fit the current parent-defined cadence or capacity.", priority: concern!.state === "blocked" ? 97 : 93, evidenceRefs: [{ type: "pacing_checkpoint", id: concern!.id }], actionRef: { type: "goal", goalId: concern!.goal_id } });
    evaluationResult = { outcome: "review_required", summary: "Weekly pacing found one goal that needs a bounded planning decision.", result: { goalId: concern!.goal_id, checkpointId: concern!.id, state: concern!.state, feasible: concern!.feasible, change, crowdedOut: crowdedForLearner } };
  }
  const briefing = await createWeeklyFamilyBriefing({ evaluationId: evaluation.id, familyId: evaluation.family_id, studentId: evaluation.student_id, idempotencyKey: evaluation.idempotency_key });
  return {
    ...evaluationResult,
    summary: briefing ? `${evaluationResult.summary} The weekly family briefing is ready.` : evaluationResult.summary,
    result: { ...evaluationResult.result, briefingId: briefing?.id ?? null, briefingWeekStart: briefing?.snapshot.weekStart ?? null, briefingCreated: briefing?.created ?? false },
  };
}

async function evaluateApprovedGrade(evaluation: EvaluationRow) {
  if (!evaluation.entity_id || !evaluation.student_id) return noAction("The approved result had no learner or review reference.");
  const admin = createAdminClient();
  await refreshFamilyPacingCheckpoints({ familyId: evaluation.family_id, studentId: evaluation.student_id });
  const reviewed = await admin.from("assignment_reviews").select("id,assignment_id,submission_id,student_id,score,feedback,mastery_signals,skill_key,evidence_kind,reviewed_at,status,grading_state,written_review_required,written_review_completed")
    .eq("id", evaluation.entity_id).eq("family_id", evaluation.family_id).eq("status", "approved").eq("grading_state", "final").maybeSingle();
  if (reviewed.error) throw reviewed.error;
  if (!reviewed.data || reviewed.data.score === null) return noAction("No approved numeric result was available for trend evaluation.");
  if (reviewed.data.written_review_required && !reviewed.data.written_review_completed) return noAction("Written responses are still provisional and cannot affect trends.");
  const sourceAssignment = await admin.from("assignments").select("id,title,subject,instructions,scheduled_date,sequence_number,curriculum_units(title,sequence_label)").eq("id", reviewed.data.assignment_id).eq("family_id", evaluation.family_id).single();
  if (sourceAssignment.error) throw sourceAssignment.error;
  const skillKey = reviewed.data.skill_key ?? primarySkill(reviewed.data.mastery_signals) ?? normalizeSkill(sourceAssignment.data.subject);
  const reviews = await admin.from("assignment_reviews").select("id,assignment_id,submission_id,score,feedback,skill_key,evidence_kind,reviewed_at,status,grading_state,written_review_required,written_review_completed")
    .eq("family_id", evaluation.family_id).eq("student_id", evaluation.student_id).eq("status", "approved").eq("grading_state", "final")
    .not("score", "is", null).order("reviewed_at", { ascending: false }).limit(20);
  if (reviews.error) throw reviews.error;
  const assignmentIds = [...new Set(reviews.data.map((item) => item.assignment_id))];
  const assignments = await admin.from("assignments").select("id,subject").eq("family_id", evaluation.family_id).in("id", assignmentIds);
  if (assignments.error) throw assignments.error;
  const subjectByAssignment = new Map(assignments.data.map((item) => [item.id, item.subject]));
  const finalReviews = reviews.data.filter((item) => !item.written_review_required || item.written_review_completed);
  const evidence: TrendEvidence[] = finalReviews.map((item) => ({
    id: item.id, studentId: evaluation.student_id!, subject: subjectByAssignment.get(item.assignment_id) ?? "",
    skillKey: item.skill_key ?? normalizeSkill(subjectByAssignment.get(item.assignment_id) ?? "learning"),
    score: Number(item.score), approved: item.status === "approved", occurredAt: item.reviewed_at ?? "",
    kind: item.evidence_kind as "curriculum" | "practice",
  }));
  const trend = detectLearningTrend(evidence.filter((item) => item.subject.toLocaleLowerCase() === sourceAssignment.data.subject.toLocaleLowerCase() && item.skillKey === skillKey));
  if (trend.kind !== "downward") return noAction(trend.reason, { trend: trend.kind, evidenceIds: trend.evidence.map((item) => item.id) });

  const { policy, preset } = await loadPolicy(evaluation.family_id);
  const buildDecision = policyDecision(policy, "build_supplemental_practice");
  if (buildDecision.denied) return noAction("A downward trend was recorded, but the family policy forbids Klio from building supplemental practice.", { trend: "downward", policy: buildDecision.level });
  if (buildDecision.interaction === "clarification") {
    const question = await createPolicyClarification({ evaluation, actorId: evaluation.requested_by ?? await familyOwner(evaluation.family_id), goal: "practice", question: `${sourceAssignment.data.subject} results show a related downward trend. Would you like Klio to build focused ${readableSkill(skillKey)} practice from the approved work?`, request: `Use the parent's answer to decide whether to build evidence-grounded ${sourceAssignment.data.subject} practice for ${readableSkill(skillKey)}. Do not schedule it unless the scheduling policy separately allows that.` });
    await upsertInsight({ evaluation, kind: "noticed", title: `${sourceAssignment.data.subject} needs a closer look`, summary: `${trend.reason} Klio asked before building anything.`, reason: trend.reason, priority: 86, evidenceRefs: trend.evidence.map(reviewRef), actionRef: { type: "clarification", turnId: question.turnId, questionThreadId: question.questionThreadId } });
    return { outcome: "review_required" as const, summary: trend.reason, result: { trend: "downward", policy: buildDecision, ...question } };
  }

  const student = await admin.from("students").select("id,grade_band,daily_capacity_minutes,schedule_preferences").eq("id", evaluation.student_id).eq("family_id", evaluation.family_id).single();
  const family = await admin.from("families").select("agent_context_version,timezone,available_days").eq("id", evaluation.family_id).single();
  if (student.error ?? family.error) throw student.error ?? family.error;
  const grounding = await practiceGrounding({ familyId: evaluation.family_id, studentId: evaluation.student_id, sourceAssignment: sourceAssignment.data, reviews: finalReviews.filter((item) => trend.evidence.some((evidenceItem) => evidenceItem.id === item.id)) });
  const practice = buildTargetedPractice({
    subject: sourceAssignment.data.subject, skillKey, levelBand: student.data.grade_band,
    assignmentDirections: sourceAssignment.data.instructions,
    reviewFeedback: grounding.reviewFeedback,
    evidenceExcerpts: grounding.evidenceExcerpts,
    priorPracticeNotes: grounding.priorPracticeNotes,
    parentCorrections: grounding.parentCorrections,
    curriculumPosition: grounding.curriculumPosition,
  });
  if (!practice) {
    await upsertInsight({ evaluation, kind: "needs_detail", title: `${sourceAssignment.data.subject} practice needs one more detail`, summary: "The reviewed evidence identifies a gap but does not contain enough subject-specific material to make accurate practice.", reason: trend.reason, priority: 84, evidenceRefs: trend.evidence.map(reviewRef), actionRef: { type: "needs_detail", assignmentId: sourceAssignment.data.id } });
    return { outcome: "needs_detail" as const, summary: "The source evidence was insufficient for accurate practice.", result: { assignmentId: sourceAssignment.data.id, reviewIds: trend.evidence.map((item) => item.id) } };
  }
  const practiceMinutes = Math.min(35, Math.max(10, practice.activities.length * 5));
  const actorId = evaluation.requested_by ?? await familyOwner(evaluation.family_id);
  const artifact = await findOrCreatePracticeArtifact({ evaluation, actorId, title: `${sourceAssignment.data.subject} · ${readableSkill(skillKey)}`, summary: `${practiceMinutes}-minute practice for ${readableSkill(skillKey)}.`, reason: trend.reason, practice, reviewIds: trend.evidence.map((item) => item.id), approvalRequired: !buildDecision.appliesAutomatically });
  if (!buildDecision.appliesAutomatically) {
    await upsertInsight({ evaluation, kind: "practice_ready", title: `${sourceAssignment.data.subject} practice is ready to review`, summary: `Klio prepared focused ${readableSkill(skillKey)} practice from approved work. Nothing is scheduled until you approve it.`, reason: trend.reason, priority: 89, evidenceRefs: trend.evidence.map(reviewRef), actionRef: { type: "practice", artifactId: artifact.id, approvalRequired: true } });
    return { outcome: "review_required" as const, summary: "Evidence-grounded practice is ready for parent review.", result: { artifactId: artifact.id, trend: "downward", policy: buildDecision } };
  }
  const session = await findOrCreatePracticeSession({ evaluation, actorId, artifactId: artifact.id, practice });
  const currentDate = dateInTimezone(new Date(), family.data.timezone);
  const scheduledDate = await nextOpenPracticeDate({ familyId: evaluation.family_id, studentId: evaluation.student_id, anchor: sourceAssignment.data.scheduled_date && sourceAssignment.data.scheduled_date > currentDate ? sourceAssignment.data.scheduled_date : currentDate, capacity: student.data.daily_capacity_minutes, weekdays: learnerWeekdays(student.data.schedule_preferences, family.data.available_days), practiceMinutes, schedulePreferences: student.data.schedule_preferences, familyLearningDays: family.data.available_days });
  if (!scheduledDate) {
    await upsertInsight({ evaluation, kind: "practice_ready", title: `${sourceAssignment.data.subject} practice is ready`, summary: `I made a focused practice from the last three results, but the next learning days are at capacity.`, reason: trend.reason, priority: 88, evidenceRefs: trend.evidence.map(reviewRef), actionRef: { type: "practice", artifactId: artifact.id, practiceSessionId: session.id } });
    return { outcome: "review_required" as const, summary: "Practice is ready but needs a schedule tradeoff.", result: { artifactId: artifact.id, practiceSessionId: session.id, trend: "downward" } };
  }

  const freshFamily = await admin.from("families").select("agent_context_version").eq("id", evaluation.family_id).single();
  if (freshFamily.error) throw freshFamily.error;
  const scheduleDecision = policyDecision(policy, "schedule_supplemental_practice");
  if (scheduleDecision.denied) {
    await upsertInsight({ evaluation, kind: "practice_ready", title: `${sourceAssignment.data.subject} practice is ready`, summary: "Focused practice was prepared, but family policy does not allow Klio to schedule it.", reason: trend.reason, priority: 88, evidenceRefs: trend.evidence.map(reviewRef), actionRef: { type: "practice", artifactId: artifact.id, practiceSessionId: session.id } });
    return { outcome: "review_required" as const, summary: "Practice is ready and remains unscheduled by policy.", result: { artifactId: artifact.id, practiceSessionId: session.id, policy: scheduleDecision } };
  }
  if (scheduleDecision.interaction === "clarification") {
    const question = await createPolicyClarification({ evaluation, actorId, goal: "weekly_plan", question: `Focused ${sourceAssignment.data.subject} practice is ready and fits on ${weekday(scheduledDate)}. Would you like Klio to add it to the week?`, request: `Use the parent's answer to decide whether to schedule artifact ${artifact.id} on ${scheduledDate}. Preserve capacity and do not replace curriculum.` });
    await upsertInsight({ evaluation, kind: "practice_ready", title: `${sourceAssignment.data.subject} practice is ready`, summary: `The practice fits ${weekday(scheduledDate)}; Klio asked before adding it.`, reason: trend.reason, priority: 89, evidenceRefs: trend.evidence.map(reviewRef), actionRef: { type: "clarification", artifactId: artifact.id, turnId: question.turnId, questionThreadId: question.questionThreadId } });
    return { outcome: "review_required" as const, summary: "Practice is ready and waiting for one scheduling answer.", result: { artifactId: artifact.id, practiceSessionId: session.id, ...question } };
  }
  const proposal = await findOrCreatePracticeProposal({ evaluation, actorId, artifactId: artifact.id, sessionId: session.id, subject: sourceAssignment.data.subject, skillKey, scheduledDate, practiceMinutes, reason: trend.reason, snapshotVersion: freshFamily.data.agent_context_version, decision: scheduleDecision, preset });
  if (scheduleDecision.appliesAutomatically) {
    const applied = await admin.rpc("apply_klio_adjustment", { p_proposal_id: proposal.id, p_actor_id: actorId });
    if (applied.error) throw applied.error;
    if (rpcStatus(applied.data) !== "applied") throw new Error("ADJUSTMENT_SNAPSHOT_STALE");
  }
  await upsertInsight({
    evaluation, kind: scheduleDecision.appliesAutomatically ? "noticed" : "practice_ready",
    title: `${sourceAssignment.data.subject} explanations have become less consistent`,
    summary: scheduleDecision.appliesAutomatically
      ? `I made a ${practiceMinutes}-minute ${readableSkill(skillKey)} practice and added it ${weekday(scheduledDate)} before the next lesson.`
      : `I made a ${practiceMinutes}-minute ${readableSkill(skillKey)} practice. It is ready to add ${weekday(scheduledDate)}.`,
    reason: trend.reason, priority: 92, evidenceRefs: trend.evidence.map(reviewRef),
    actionRef: { type: "practice_adjustment", proposalId: proposal.id, artifactId: artifact.id, practiceSessionId: session.id, scheduledDate, undoAvailable: scheduleDecision.undoRequired },
  });
  return { outcome: scheduleDecision.appliesAutomatically ? "automatic_action" as const : "review_required" as const, summary: trend.reason, result: { trend: "downward", proposalId: proposal.id, artifactId: artifact.id, practiceSessionId: session.id, evidenceIds: trend.evidence.map((item) => item.id) } };
}

async function evaluatePracticeCompletion(evaluation: EvaluationRow) {
  if (!evaluation.student_id || !evaluation.entity_id) return noAction("The practice result had no learner reference.");
  const admin = createAdminClient();
  const result = await admin.from("practice_results").select("id,score,final_score,mastery_met,scoring_state,written_review_required,written_review_completed,created_at,practice_session_id")
    .eq("id", evaluation.entity_id).eq("family_id", evaluation.family_id).eq("student_id", evaluation.student_id).eq("scoring_state", "final").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || (result.data.written_review_required && !result.data.written_review_completed) || !result.data.mastery_met || Number(result.data.final_score ?? result.data.score) < 80) return noAction("The latest finalized practice result does not yet show sustained improvement.");
  const session = await admin.from("practice_sessions").select("spec").eq("id", result.data.practice_session_id).eq("family_id", evaluation.family_id).single();
  if (session.error) throw session.error;
  const spec = session.data.spec as { subject?: string; skill_key?: string };
  const recent = await admin.from("practice_results").select("id,score,final_score,mastery_met,scoring_state,written_review_required,written_review_completed,created_at,practice_sessions!inner(spec)")
    .eq("family_id", evaluation.family_id).eq("student_id", evaluation.student_id).eq("mastery_met", true).eq("scoring_state", "final").eq("written_review_completed", true)
    .order("created_at", { ascending: false }).limit(6);
  if (recent.error) throw recent.error;
  const related = recent.data.filter((item) => {
    const candidate = item.practice_sessions.spec as { subject?: string; skill_key?: string };
    return candidate.subject === spec.subject && candidate.skill_key === spec.skill_key && Number(item.final_score ?? item.score) >= 80;
  }).slice(0, 3);
  if (related.length < 3) return noAction("Klio is waiting for three successful related results before removing support.", { successfulResults: related.length });
  const scheduled = await admin.from("assignments").select("id,title,subject,status,scheduled_date,estimated_minutes")
    .eq("family_id", evaluation.family_id).eq("student_id", evaluation.student_id).eq("source_kind", "practice")
    .in("status", ["planned", "doing"]).not("scheduled_date", "is", null).order("scheduled_date").limit(10);
  if (scheduled.error) throw scheduled.error;
  const matching = scheduled.data.find((item) => item.subject === spec.subject);
  if (!matching) return noAction("No unnecessary future supplemental practice was scheduled.");
  const { policy, preset } = await loadPolicy(evaluation.family_id);
  const decision = policyDecision(policy, "remove_unnecessary_practice");
  if (decision.denied) return noAction("Sustained improvement was recorded, but family policy keeps supplemental practice in place.", { assignmentId: matching.id, policy: decision.level });
  if (decision.interaction === "clarification") {
    const actorId = evaluation.requested_by ?? await familyOwner(evaluation.family_id);
    const question = await createPolicyClarification({ evaluation, actorId, goal: "practice", question: `${matching.title} now has three related finalized successful results. Would you like Klio to remove this future extra practice while leaving regular curriculum unchanged?`, request: `Use the parent's answer to decide whether to remove supplemental assignment ${matching.id} through the undoable adjustment path. Do not change curriculum.` });
    await upsertInsight({ evaluation, kind: "noticed", title: "Extra practice may no longer be needed", summary: "Klio asked before changing the week.", reason: "Three successful related finalized practice results met the cautious improvement threshold.", priority: 76, evidenceRefs: related.map((item) => ({ type: "practice_result", id: item.id, score: Number(item.score) })), actionRef: { type: "clarification", assignmentId: matching.id, turnId: question.turnId, questionThreadId: question.questionThreadId } });
    return { outcome: "review_required" as const, summary: "Sustained improvement is waiting for one parent decision.", result: { ...question, assignmentId: matching.id } };
  }
  const family = await admin.from("families").select("agent_context_version").eq("id", evaluation.family_id).single();
  if (family.error) throw family.error;
  const actorId = evaluation.requested_by ?? await familyOwner(evaluation.family_id);
  const proposalKey = `improvement:${evaluation.id}`;
  const existingProposal = await admin.from("adjustment_proposals").select("id").eq("family_id", evaluation.family_id).eq("idempotency_key", proposalKey).maybeSingle();
  if (existingProposal.error) throw existingProposal.error;
  let proposalId = existingProposal.data?.id;
  if (!proposalId) {
    const proposal = await admin.from("adjustment_proposals").insert({
      family_id: evaluation.family_id, student_id: evaluation.student_id, week_start: matching.scheduled_date!,
      reason: "Three successful related practice results show sustained improvement.",
      summary: `Remove ${matching.title}; regular curriculum remains unchanged.`, snapshot_version: family.data.agent_context_version,
      idempotency_key: proposalKey, trigger_event: { evaluationId: evaluation.id, eventKind: evaluation.event_kind },
      policy_decision: { ...decision, preset },
    }).select("id").single();
    if (proposal.error) throw proposal.error;
    proposalId = proposal.data.id;
  }
  const existingAction = await admin.from("adjustment_actions").select("id").eq("proposal_id", proposalId).eq("action_type", "remove_practice").maybeSingle();
  if (existingAction.error) throw existingAction.error;
  if (!existingAction.data) {
    const action = await admin.from("adjustment_actions").insert({
      family_id: evaluation.family_id, proposal_id: proposalId, assignment_id: matching.id, action_type: "remove_practice",
      before_state: { scheduledDate: matching.scheduled_date, status: matching.status, estimatedMinutes: matching.estimated_minutes, subject: matching.subject, title: matching.title }, after_state: {}, position: 0,
    });
    if (action.error) throw action.error;
  }
  if (decision.appliesAutomatically) {
    const applied = await admin.rpc("apply_klio_adjustment", { p_proposal_id: proposalId, p_actor_id: actorId });
    if (applied.error) throw applied.error;
    if (rpcStatus(applied.data) !== "applied") throw new Error("ADJUSTMENT_SNAPSHOT_STALE");
  }
  await upsertInsight({ evaluation, kind: "adjusted", title: "Extra practice is no longer needed", summary: decision.appliesAutomatically ? `I removed ${matching.title}. Regular ${matching.subject} curriculum is unchanged.` : `${matching.title} looks ready to remove. Regular curriculum will stay unchanged.`, reason: "Three successful related practice results met the cautious improvement threshold.", priority: 76, evidenceRefs: related.map((item) => ({ type: "practice_result", id: item.id, score: Number(item.score) })), actionRef: { type: "practice_removal", proposalId, assignmentId: matching.id, undoAvailable: decision.undoRequired } });
  return { outcome: decision.appliesAutomatically ? "automatic_action" as const : "review_required" as const, summary: "Sustained improvement made extra practice unnecessary.", result: { proposalId, removedAssignmentId: matching.id } };
}

async function loadPolicy(familyId: string) {
  const admin = createAdminClient();
  const row = await admin.from("family_autonomy_policies").select("preset,policies").eq("family_id", familyId).maybeSingle();
  if (row.error) throw row.error;
  const preset = (row.data?.preset ?? "proactive") as AutonomyPreset;
  return { preset, policy: policyForPreset(preset, sanitizePolicy(row.data?.policies)) };
}

async function createPolicyClarification(input: {
  evaluation: EvaluationRow;
  actorId: string;
  goal: "practice" | "weekly_plan";
  question: string;
  request: string;
}) {
  const admin = createAdminClient();
  const queued = await enqueueWorkspaceTurn({
    familyId: input.evaluation.family_id,
    requestedBy: input.actorId,
    studentId: input.evaluation.student_id,
    trigger: "proactive_event",
    goal: input.goal,
    idempotencyKey: `policy-question:${input.evaluation.id}:${input.goal}`,
    request: input.request,
    taskName: "Waiting for a parent decision",
    expectedOutput: "One bounded action based on the parent answer",
  });
  const existing = await admin.from("question_threads").select("id").eq("family_id", input.evaluation.family_id).eq("awaiting_turn_id", queued.turn.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { turnId: queued.turn.id, questionThreadId: existing.data.id };
  const waiting = await admin.from("agent_turns").update({ status: "awaiting_parent", outcome: "question", normalized_step: "waiting_detail", last_progress_at: new Date().toISOString() })
    .eq("id", queued.turn.id).eq("family_id", input.evaluation.family_id).eq("status", "queued");
  if (waiting.error) throw waiting.error;
  const thread = await admin.from("question_threads").insert({
    family_id: input.evaluation.family_id, student_id: input.evaluation.student_id,
    title: "Klio needs one decision", created_by: input.actorId,
    agent_thread_id: queued.turn.thread_id, awaiting_turn_id: queued.turn.id,
  }).select("id").single();
  if (thread.error) throw thread.error;
  const message = await admin.from("question_messages").insert({
    thread_id: thread.data.id, family_id: input.evaluation.family_id, role: "assistant",
    content: input.question.slice(0, 10000), confidence: "high", created_by: input.actorId,
    agent_turn_id: queued.turn.id, idempotency_key: `policy-question-message:${input.evaluation.id}`,
  });
  if (message.error) throw message.error;
  await admin.from("agent_threads").update({ status: "awaiting_parent" }).eq("id", queued.turn.thread_id).eq("family_id", input.evaluation.family_id);
  await admin.from("agent_events").insert({ family_id: input.evaluation.family_id, turn_id: queued.turn.id, sequence: 2, kind: "clarification.requested", payload: { questionThreadId: thread.data.id } });
  return { turnId: queued.turn.id, questionThreadId: thread.data.id };
}

async function familyOwner(familyId: string) {
  const admin = createAdminClient();
  const owner = await admin.from("family_members").select("user_id").eq("family_id", familyId).in("role", ["owner", "editor"]).order("created_at").limit(1).single();
  if (owner.error) throw owner.error;
  return owner.data.user_id;
}

type GeneratedPractice = NonNullable<ReturnType<typeof buildTargetedPractice>>;

async function practiceGrounding(input: {
  familyId: string;
  studentId: string;
  sourceAssignment: { instructions: string | null; sequence_number: number | null; curriculum_units: { title: string; sequence_label: string } | Array<{ title: string; sequence_label: string }> | null };
  reviews: Array<{ id: string; submission_id: string; feedback: string | null }>;
}) {
  const admin = createAdminClient();
  const submissionIds = input.reviews.map((review) => review.submission_id);
  const links = submissionIds.length
    ? await admin.from("assignment_submission_evidence").select("evidence_id").eq("family_id", input.familyId).in("submission_id", submissionIds).limit(40)
    : { data: [], error: null };
  if (links.error) throw links.error;
  const evidenceIds = [...new Set((links.data ?? []).map((item) => item.evidence_id))];
  const [evidence, corrections, decisionCorrections, priorPractice] = await Promise.all([
    evidenceIds.length
      ? admin.from("evidence_items").select("raw_text,extracted_text").eq("family_id", input.familyId).in("id", evidenceIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("organization_corrections").select("evidence_title,evidence_excerpt,cues").eq("family_id", input.familyId).order("created_at", { ascending: false }).limit(10),
    admin.from("parent_agent_corrections").select("correction_kind,original_value,corrected_value,note").eq("family_id", input.familyId).eq("student_id", input.studentId).in("domain", ["grading", "practice"]).order("created_at", { ascending: false }).limit(10),
    admin.from("practice_results").select("final_score,scoring_state,created_at,practice_sessions!inner(spec)").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("scoring_state", "final").order("created_at", { ascending: false }).limit(5),
  ]);
  const error = evidence.error ?? corrections.error ?? decisionCorrections.error ?? priorPractice.error;
  if (error) throw error;
  const course = Array.isArray(input.sourceAssignment.curriculum_units) ? input.sourceAssignment.curriculum_units[0] : input.sourceAssignment.curriculum_units;
  return {
    reviewFeedback: input.reviews.map((review) => review.feedback).filter((value): value is string => Boolean(value)),
    evidenceExcerpts: (evidence.data ?? []).map((item) => [item.raw_text, item.extracted_text].filter(Boolean).join(" ").slice(0, 1200)).filter(Boolean),
    priorPracticeNotes: (priorPractice.data ?? []).map((item) => `Prior finalized practice score: ${item.final_score ?? "not scored"}.`),
    parentCorrections: [
      ...(corrections.data ?? []).map((item) => [item.evidence_title, item.evidence_excerpt, JSON.stringify(item.cues)].filter(Boolean).join(" ").slice(0, 600)),
      ...(decisionCorrections.data ?? []).map((item) => [item.correction_kind, item.note, JSON.stringify(item.original_value), JSON.stringify(item.corrected_value)].filter(Boolean).join(" ").slice(0, 600)),
    ],
    curriculumPosition: course ? `${course.title}, ${course.sequence_label} ${input.sourceAssignment.sequence_number ?? "current"}` : null,
  };
}

async function findOrCreatePracticeArtifact(input: { evaluation: EvaluationRow; actorId: string; title: string; summary: string; reason: string; practice: GeneratedPractice; reviewIds: string[]; approvalRequired: boolean }) {
  const admin = createAdminClient();
  const existing = await admin.from("artifacts").select("id").eq("family_id", input.evaluation.family_id).contains("content", { provenance: { evaluationId: input.evaluation.id } }).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await admin.from("artifacts").insert({
    family_id: input.evaluation.family_id, student_id: input.evaluation.student_id, created_by: input.actorId,
    type: "practice", title: input.title, summary: input.summary,
    content: { practice: input.practice, provenance: { evaluationId: input.evaluation.id, reviewIds: input.reviewIds } },
    rationale: input.reason, status: input.approvalRequired ? "draft" : "approved",
    reviewed_by: input.approvalRequired ? null : input.actorId,
    reviewed_at: input.approvalRequired ? null : new Date().toISOString(),
  }).select("id").single();
  if (created.error) throw created.error;
  const submissions = await admin.from("assignment_reviews").select("submission_id").eq("family_id", input.evaluation.family_id).in("id", input.reviewIds);
  if (submissions.error) throw submissions.error;
  const evidence = submissions.data.length ? await admin.from("assignment_submission_evidence").select("evidence_id").eq("family_id", input.evaluation.family_id).in("submission_id", submissions.data.map((item) => item.submission_id)) : { data: [], error: null };
  if (evidence.error) throw evidence.error;
  const evidenceIds = [...new Set(evidence.data.map((item) => item.evidence_id))];
  if (evidenceIds.length) {
    const links = await admin.from("artifact_sources").insert(evidenceIds.map((evidenceId) => ({ artifact_id: created.data.id, evidence_id: evidenceId, family_id: input.evaluation.family_id, note: "Supporting approved result for proactive practice." })));
  if (links.error) throw links.error;
  }
  if (input.approvalRequired) {
    const approval = await admin.from("approval_requests").insert({ family_id: input.evaluation.family_id, entity_type: "artifact", entity_id: created.data.id });
    if (approval.error) throw approval.error;
  }
  return created.data;
}

async function findOrCreatePracticeSession(input: { evaluation: EvaluationRow; actorId: string; artifactId: string; practice: GeneratedPractice }) {
  const admin = createAdminClient();
  const existing = await admin.from("practice_sessions").select("id").eq("family_id", input.evaluation.family_id).eq("artifact_id", input.artifactId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await admin.from("practice_sessions").insert({ family_id: input.evaluation.family_id, student_id: input.evaluation.student_id!, artifact_id: input.artifactId, created_by: input.actorId, spec: input.practice as Json, status: "ready" }).select("id").single();
  if (created.error) throw created.error;
  return created.data;
}

async function findOrCreatePracticeProposal(input: { evaluation: EvaluationRow; actorId: string; artifactId: string; sessionId: string; subject: string; skillKey: string; scheduledDate: string; practiceMinutes: number; reason: string; snapshotVersion: number; decision: ReturnType<typeof policyDecision>; preset: string }) {
  const admin = createAdminClient();
  const key = `trend-practice:${input.evaluation.id}`;
  const existing = await admin.from("adjustment_proposals").select("id").eq("family_id", input.evaluation.family_id).eq("idempotency_key", key).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await admin.from("adjustment_proposals").insert({
    family_id: input.evaluation.family_id, student_id: input.evaluation.student_id!, week_start: input.scheduledDate,
    reason: input.reason, summary: `Add ${input.practiceMinutes} minutes of focused ${input.subject} practice without replacing curriculum.`,
    snapshot_version: input.snapshotVersion, idempotency_key: key,
    trigger_event: { evaluationId: input.evaluation.id, eventKind: input.evaluation.event_kind },
    policy_decision: { ...input.decision, preset: input.preset },
  }).select("id").single();
  if (created.error) throw created.error;
  const action = await admin.from("adjustment_actions").insert({
    family_id: input.evaluation.family_id, proposal_id: created.data.id, assignment_id: null, action_type: "add_practice", position: 0,
    before_state: {}, after_state: { artifactId: input.artifactId, practiceSessionId: input.sessionId, scheduledDate: input.scheduledDate, estimatedMinutes: input.practiceMinutes, subject: input.subject, skillKey: input.skillKey, title: `${input.subject} · ${readableSkill(input.skillKey)}`, reason: input.reason },
  });
  if (action.error) throw action.error;
  return created.data;
}

async function nextOpenPracticeDate(input: { familyId: string; studentId: string; anchor: string; capacity: number; weekdays: number[]; practiceMinutes: number; schedulePreferences: unknown; familyLearningDays: unknown }) {
  const admin = createAdminClient();
  const days = scheduleDates(input.anchor, input.weekdays, 12).filter((date) => date > input.anchor);
  if (!days.length) return null;
  const assignments = await admin.from("assignments").select("scheduled_date,estimated_minutes,status").eq("family_id", input.familyId).eq("student_id", input.studentId).gte("scheduled_date", days[0]).lte("scheduled_date", days.at(-1)!);
  if (assignments.error) throw assignments.error;
  const availability = await loadAvailabilityByDate({ supabase: admin, familyId: input.familyId, studentId: input.studentId, dailyCapacityMinutes: input.capacity, schedulePreferences: input.schedulePreferences, familyLearningDays: input.familyLearningDays, dates: days });
  return days.find((date) => assignments.data.filter((item) => item.scheduled_date === date && item.status !== "skipped").reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0) + input.practiceMinutes <= availability[date].availableMinutes) ?? null;
}

async function upsertInsight(input: { evaluation: EvaluationRow; kind: "noticed" | "adjusted" | "practice_ready" | "review_ready" | "needs_detail" | "on_track"; title: string; summary: string; reason: string; priority: number; evidenceRefs: unknown[]; actionRef: Record<string, unknown> }) {
  const admin = createAdminClient();
  const saved = await admin.from("klio_insights").upsert({
    family_id: input.evaluation.family_id, student_id: input.evaluation.student_id, evaluation_id: input.evaluation.id,
    kind: input.kind, title: input.title, summary: input.summary, reason: input.reason, priority: input.priority,
    evidence_refs: input.evidenceRefs as Json, action_ref: input.actionRef as Json,
    dedupe_key: `${input.evaluation.event_kind}:${input.evaluation.entity_id ?? input.evaluation.id}:${input.kind}`,
  }, { onConflict: "family_id,dedupe_key" }).select("id").single();
  if (saved.error) throw saved.error;
  return saved.data;
}

async function supersedeResolvedScheduleQuestions(
  admin: ReturnType<typeof createAdminClient>,
  familyId: string,
  studentId: string,
  changedAssignmentId: string,
) {
  const insights = await admin.from("klio_insights").select("id,evidence_refs,action_ref")
    .eq("family_id", familyId)
    .eq("student_id", studentId)
    .eq("status", "active")
    .eq("kind", "needs_detail")
    .contains("evidence_refs", JSON.stringify([{ type: "assignment", id: changedAssignmentId }]));
  if (insights.error) throw insights.error;
  const scheduleQuestions = insights.data.filter((insight) => {
    const action = jsonObject(insight.action_ref);
    return action?.type === "week";
  });
  if (!scheduleQuestions.length) return;

  const assignmentIds = [...new Set(scheduleQuestions.flatMap((insight) => jsonAssignmentIds(insight.evidence_refs)))];
  const assignments = assignmentIds.length
    ? await admin.from("assignments").select("id,status,scheduled_date").eq("family_id", familyId).eq("student_id", studentId).in("id", assignmentIds)
    : { data: [], error: null };
  if (assignments.error) throw assignments.error;
  const byId = new Map(assignments.data.map((assignment) => [assignment.id, assignment]));
  const resolvedIds = scheduleQuestions.filter((insight) => {
    const action = jsonObject(insight.action_ref);
    const sourceDate = typeof action?.date === "string" ? action.date : null;
    return !jsonAssignmentIds(insight.evidence_refs).some((id) => {
      const assignment = byId.get(id);
      return assignment
        && ["planned", "doing"].includes(assignment.status)
        && (!sourceDate || assignment.scheduled_date === sourceDate);
    });
  }).map((insight) => insight.id);
  if (!resolvedIds.length) return;
  const superseded = await admin.from("klio_insights").update({ status: "superseded" })
    .eq("family_id", familyId)
    .eq("status", "active")
    .in("id", resolvedIds);
  if (superseded.error) throw superseded.error;
}

function jsonObject(value: Json) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : null;
}

function jsonAssignmentIds(value: Json) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const ref = jsonObject(item);
    return ref?.type === "assignment" && typeof ref.id === "string" ? [ref.id] : [];
  });
}

function noAction(summary: string, result: Record<string, unknown> = {}) { return { outcome: "no_action" as const, summary, result }; }
function normalizeSkill(value: string) { return value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function readableSkill(value: string) { return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim(); }
function primarySkill(value: Json) { if (!Array.isArray(value)) return null; const first = value.find((item) => item && typeof item === "object" && "skill" in item && typeof item.skill === "string"); return first && typeof first === "object" && "skill" in first ? normalizeSkill(String(first.skill)) : null; }
function reviewRef(item: TrendEvidence) { return { type: "assignment_review", id: item.id, score: item.score, subject: item.subject, skillKey: item.skillKey }; }
function weekday(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }); }
function rpcStatus(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).status === "string" ? (value as Record<string, unknown>).status : null; }
function localClock(now: Date, timeZone: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now); const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""; return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")), weekday: ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 } as Record<string, number>)[value("weekday")] ?? 0 }; }

type EvaluationRow = {
  id: string; family_id: string; student_id: string | null; requested_by: string | null; event_kind: ProactiveEventKind;
  entity_type: string; entity_id: string | null; idempotency_key: string; status: string; attempt_count: number;
};
