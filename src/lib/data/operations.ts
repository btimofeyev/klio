import "server-only";
import { getWorkspace } from "@/lib/data/workspace";
import { dateInTimezone } from "@/lib/schedule/dates";
import { createClient } from "@/lib/supabase/server";

export type AssignmentDTO = { id: string; studentId: string; curriculumUnitId: string | null; title: string; subject: string; instructions: string | null; sequenceNumber: number | null; status: string; scheduledDate: string | null; dueAt: string | null; scheduledTime: string | null; estimatedMinutes: number | null; completedAt: string | null; submittedAt: string | null; sourceKind: string };
export type CurriculumUnitDTO = { id: string; studentId: string; subject: string; title: string; sequenceLabel: string; nextSequenceNumber: number; defaultMinutes: number; weeklyFrequency: number; status: string; scheduleRule: unknown; curriculumUrl: string | null };
export type SubmissionDTO = { id: string; assignmentId: string; status: string; note: string | null; submittedAt: string; evidenceIds: string[] };
export type AssignmentReviewDTO = { id: string; assignmentId: string; submissionId: string; status: string; draftScore: number | null; score: number | null; scoreLabel: string | null; draftFeedback: string | null; feedback: string | null; rubric: unknown; masterySignals: unknown; uncertaintyFlags: unknown; reviewedAt: string | null };
export type AdjustmentDTO = { id: string; studentId: string; weekStart: string; reason: string; summary: string; status: string; snapshotVersion: number; createdAt: string; actions: Array<{ id: string; assignmentId: string | null; actionType: string; beforeState: unknown; afterState: unknown; position: number; status: string }> };

export async function getOperationsWorkspace() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const familyId = workspace.family.id;
  const [units, assignments, submissions, reviews, adjustments] = await Promise.all([
    supabase.from("curriculum_units").select("id,student_id,subject,title,sequence_label,next_sequence_number,default_minutes,status,schedule_rule,curriculum_url").eq("family_id", familyId).neq("status", "archived").order("subject"),
    supabase.from("assignments").select("id,student_id,curriculum_unit_id,title,subject,instructions,sequence_number,status,scheduled_date,due_at,scheduled_time,estimated_minutes,completed_at,submitted_at,source_kind").eq("family_id", familyId).order("scheduled_date", { ascending: true, nullsFirst: false }).order("scheduled_time", { ascending: true, nullsFirst: false }).limit(250),
    supabase.from("assignment_submissions").select("id,assignment_id,status,note,submitted_at,assignment_submission_evidence(evidence_id)").eq("family_id", familyId).order("submitted_at", { ascending: false }).limit(100),
    supabase.from("assignment_reviews").select("id,assignment_id,submission_id,status,draft_score,score,score_label,draft_feedback,feedback,rubric,mastery_signals,uncertainty_flags,reviewed_at").eq("family_id", familyId).order("created_at", { ascending: false }).limit(100),
    supabase.from("adjustment_proposals").select("id,student_id,week_start,reason,summary,status,snapshot_version,created_at,adjustment_actions(id,assignment_id,action_type,before_state,after_state,position,status)").eq("family_id", familyId).order("created_at", { ascending: false }).limit(50),
  ]);
  for (const result of [units, assignments, submissions, reviews, adjustments]) if (result.error) throw result.error;
  return {
    ...workspace,
    currentDate: dateInTimezone(new Date(), workspace.family.timezone),
    curriculumUnits: (units.data ?? []).map((item): CurriculumUnitDTO => ({ id: item.id, studentId: item.student_id, subject: item.subject, title: item.title, sequenceLabel: item.sequence_label, nextSequenceNumber: item.next_sequence_number, defaultMinutes: item.default_minutes, weeklyFrequency: weeklyFrequency(item.schedule_rule), status: item.status, scheduleRule: item.schedule_rule, curriculumUrl: item.curriculum_url })),
    assignments: (assignments.data ?? []).map((item): AssignmentDTO => ({ id: item.id, studentId: item.student_id, curriculumUnitId: item.curriculum_unit_id, title: item.title, subject: item.subject, instructions: item.instructions, sequenceNumber: item.sequence_number, status: item.status, scheduledDate: item.scheduled_date, dueAt: item.due_at, scheduledTime: item.scheduled_time, estimatedMinutes: item.estimated_minutes, completedAt: item.completed_at, submittedAt: item.submitted_at, sourceKind: item.source_kind })),
    submissions: (submissions.data ?? []).map((item): SubmissionDTO => ({ id: item.id, assignmentId: item.assignment_id, status: item.status, note: item.note, submittedAt: item.submitted_at, evidenceIds: item.assignment_submission_evidence.map((link) => link.evidence_id) })),
    assignmentReviews: (reviews.data ?? []).map((item): AssignmentReviewDTO => ({ id: item.id, assignmentId: item.assignment_id, submissionId: item.submission_id, status: item.status, draftScore: item.draft_score === null ? null : Number(item.draft_score), score: item.score === null ? null : Number(item.score), scoreLabel: item.score_label, draftFeedback: item.draft_feedback, feedback: item.feedback, rubric: item.rubric, masterySignals: item.mastery_signals, uncertaintyFlags: item.uncertainty_flags, reviewedAt: item.reviewed_at })),
    adjustments: (adjustments.data ?? []).map((item): AdjustmentDTO => ({ id: item.id, studentId: item.student_id, weekStart: item.week_start, reason: item.reason, summary: item.summary, status: item.status, snapshotVersion: item.snapshot_version, createdAt: item.created_at, actions: item.adjustment_actions.sort((a, b) => a.position - b.position).map((action) => ({ id: action.id, assignmentId: action.assignment_id, actionType: action.action_type, beforeState: action.before_state, afterState: action.after_state, position: action.position, status: action.status })) })),
  };
}

function weeklyFrequency(rule: unknown) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return 5;
  const value = "weeklyFrequency" in rule ? Number(rule.weeklyFrequency) : 5;
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : 5;
}
