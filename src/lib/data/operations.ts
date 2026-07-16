import "server-only";
import { getWorkspace } from "@/lib/data/workspace";
import { dateInTimezone } from "@/lib/schedule/dates";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { normalizePracticeSpec, type DynamicPracticeSpec } from "@/lib/practice/spec";

export type AssignmentDTO = { id: string; studentId: string; curriculumUnitId: string | null; title: string; subject: string; instructions: string | null; sequenceNumber: number | null; status: string; scheduledDate: string | null; dueAt: string | null; scheduledTime: string | null; estimatedMinutes: number | null; completedAt: string | null; submittedAt: string | null; sourceKind: string };
export type CurriculumUnitDTO = { id: string; studentId: string; subject: string; title: string; sequenceLabel: string; nextSequenceNumber: number; defaultMinutes: number; weeklyFrequency: number; status: string; scheduleRule: unknown; curriculumUrl: string | null };
export type SubmissionDTO = { id: string; assignmentId: string; status: string; note: string | null; submittedAt: string; evidenceIds: string[] };
export type AssignmentReviewDTO = { id: string; assignmentId: string; submissionId: string; status: string; draftScore: number | null; score: number | null; scoreLabel: string | null; draftFeedback: string | null; feedback: string | null; rubric: unknown; masterySignals: unknown; uncertaintyFlags: unknown; reviewedAt: string | null; skillKey: string | null; comparableKey: string | null; evidenceKind: string; evidenceStrength: string; scoreOrigin: string; gradingState: string; writtenReviewRequired: boolean; writtenReviewCompleted: boolean };
export type AdjustmentDTO = { id: string; studentId: string; weekStart: string; reason: string; summary: string; status: string; snapshotVersion: number; createdAt: string; undoStatus: string; undoExpiresAt: string | null; acknowledgedAt: string | null; acknowledgedBy: string | null; actions: Array<{ id: string; assignmentId: string | null; actionType: string; beforeState: unknown; afterState: unknown; position: number; status: string }> };
export type PlanningProposalDTO = { id: string; studentId: string | null; proposalKind: string; actionName: string; risk: string; title: string; summary: string; reason: string; changes: unknown; status: string; snapshotVersion: number; targetAssignmentId: string | null; targetGoalId: string | null; targetCurriculumUnitId: string | null; createdAt: string };
export type PracticeSessionDTO = { id: string; artifactId: string | null; studentId: string; status: string; spec: DynamicPracticeSpec; createdAt: string; completedAt: string | null };

export async function getOperationsWorkspace() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const familyId = workspace.family.id;
  const [units, assignments, submissions, reviews, adjustments, planningProposals, practiceSessions] = await Promise.all([
    supabase.from("curriculum_units").select("id,student_id,subject,title,sequence_label,next_sequence_number,default_minutes,status,schedule_rule,curriculum_url").eq("family_id", familyId).neq("status", "archived").order("subject"),
    loadFamilyAssignments(supabase, familyId),
    supabase.from("assignment_submissions").select("id,assignment_id,status,note,submitted_at,assignment_submission_evidence(evidence_id)").eq("family_id", familyId).order("submitted_at", { ascending: false }).limit(100),
    supabase.from("assignment_reviews").select("id,assignment_id,submission_id,status,draft_score,score,score_label,draft_feedback,feedback,rubric,mastery_signals,uncertainty_flags,reviewed_at,skill_key,comparable_key,evidence_kind,evidence_strength,score_origin,grading_state,written_review_required,written_review_completed").eq("family_id", familyId).order("created_at", { ascending: false }).limit(100),
    supabase.from("adjustment_proposals").select("id,student_id,week_start,reason,summary,status,snapshot_version,created_at,undo_status,undo_expires_at,acknowledged_at,acknowledged_by,adjustment_actions(id,assignment_id,action_type,before_state,after_state,position,status)").eq("family_id", familyId).order("created_at", { ascending: false }).limit(50),
    supabase.from("planning_proposals").select("id,student_id,proposal_kind,action_name,risk,title,summary,reason,proposed_changes,status,snapshot_version,target_assignment_id,target_goal_id,target_curriculum_unit_id,created_at").eq("family_id", familyId).order("created_at", { ascending: false }).limit(50),
    supabase.from("practice_sessions").select("id,artifact_id,student_id,status,spec,created_at,completed_at").eq("family_id", familyId).order("created_at", { ascending: false }).limit(60),
  ]);
  for (const result of [units, submissions, reviews, adjustments, planningProposals, practiceSessions]) if (result.error) throw result.error;
  return {
    ...workspace,
    currentDate: dateInTimezone(new Date(), workspace.family.timezone),
    curriculumUnits: (units.data ?? []).map((item): CurriculumUnitDTO => ({ id: item.id, studentId: item.student_id, subject: item.subject, title: item.title, sequenceLabel: item.sequence_label, nextSequenceNumber: item.next_sequence_number, defaultMinutes: item.default_minutes, weeklyFrequency: weeklyFrequency(item.schedule_rule), status: item.status, scheduleRule: item.schedule_rule, curriculumUrl: item.curriculum_url })),
    assignments: assignments.map((item): AssignmentDTO => ({ id: item.id, studentId: item.student_id, curriculumUnitId: item.curriculum_unit_id, title: item.title, subject: item.subject, instructions: item.instructions, sequenceNumber: item.sequence_number, status: item.status, scheduledDate: item.scheduled_date, dueAt: item.due_at, scheduledTime: item.scheduled_time, estimatedMinutes: item.estimated_minutes, completedAt: item.completed_at, submittedAt: item.submitted_at, sourceKind: item.source_kind })),
    submissions: (submissions.data ?? []).map((item): SubmissionDTO => ({ id: item.id, assignmentId: item.assignment_id, status: item.status, note: item.note, submittedAt: item.submitted_at, evidenceIds: item.assignment_submission_evidence.map((link) => link.evidence_id) })),
    assignmentReviews: (reviews.data ?? []).map((item): AssignmentReviewDTO => ({ id: item.id, assignmentId: item.assignment_id, submissionId: item.submission_id, status: item.status, draftScore: item.draft_score === null ? null : Number(item.draft_score), score: item.score === null ? null : Number(item.score), scoreLabel: item.score_label, draftFeedback: item.draft_feedback, feedback: item.feedback, rubric: item.rubric, masterySignals: item.mastery_signals, uncertaintyFlags: item.uncertainty_flags, reviewedAt: item.reviewed_at, skillKey: item.skill_key, comparableKey: item.comparable_key, evidenceKind: item.evidence_kind, evidenceStrength: item.evidence_strength, scoreOrigin: item.score_origin, gradingState: item.grading_state, writtenReviewRequired: item.written_review_required, writtenReviewCompleted: item.written_review_completed })),
    adjustments: (adjustments.data ?? []).map((item): AdjustmentDTO => ({ id: item.id, studentId: item.student_id, weekStart: item.week_start, reason: item.reason, summary: item.summary, status: item.status, snapshotVersion: item.snapshot_version, createdAt: item.created_at, undoStatus: item.undo_status, undoExpiresAt: item.undo_expires_at, acknowledgedAt: item.acknowledged_at, acknowledgedBy: item.acknowledged_by, actions: item.adjustment_actions.sort((a, b) => a.position - b.position).map((action) => ({ id: action.id, assignmentId: action.assignment_id, actionType: action.action_type, beforeState: action.before_state, afterState: action.after_state, position: action.position, status: action.status })) })),
    planningProposals: (planningProposals.data ?? []).map((item): PlanningProposalDTO => ({ id: item.id, studentId: item.student_id, proposalKind: item.proposal_kind, actionName: item.action_name, risk: item.risk, title: item.title, summary: item.summary, reason: item.reason, changes: item.proposed_changes, status: item.status, snapshotVersion: item.snapshot_version, targetAssignmentId: item.target_assignment_id, targetGoalId: item.target_goal_id, targetCurriculumUnitId: item.target_curriculum_unit_id, createdAt: item.created_at })),
    practiceSessions: (practiceSessions.data ?? []).flatMap((item): PracticeSessionDTO[] => {
      const spec = normalizePracticeSpec(item.spec);
      return spec ? [{ id: item.id, artifactId: item.artifact_id, studentId: item.student_id, status: item.status, spec, createdAt: item.created_at, completedAt: item.completed_at }] : [];
    }),
  };
}

type AssignmentRow = Database["public"]["Tables"]["assignments"]["Row"];

async function loadFamilyAssignments(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string) {
  const rows: AssignmentRow[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await supabase.from("assignments").select("*").eq("family_id", familyId)
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .order("scheduled_time", { ascending: true, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    if (page.error) throw page.error;
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
  }
  throw new Error("This family workspace has more scheduled work than the week view can safely load.");
}

function weeklyFrequency(rule: unknown) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return 5;
  const value = "weeklyFrequency" in rule ? Number(rule.weeklyFrequency) : 5;
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : 5;
}
