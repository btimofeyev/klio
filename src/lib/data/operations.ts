import "server-only";

import { getWorkspace } from "@/lib/data/workspace";
import {
  ASSIGNMENT_SELECT_COLUMNS,
  CURRICULUM_ASSIGNMENT_PAGE_SIZE,
  SCHEDULED_ASSIGNMENT_PAGE_SIZE,
  decodeCurriculumAssignmentCursor,
  decodeScheduledAssignmentCursor,
  dedupeAssignmentsById,
  encodeCurriculumAssignmentCursor,
  encodeScheduledAssignmentCursor,
  operationsDateRange,
  pageWithLookahead,
} from "@/lib/data/operation-assignment-pages";
import { planningProposalAssignmentIds } from "@/lib/product/workspace-insight-presentation";
import { normalizePracticeSpec, type DynamicPracticeSpec } from "@/lib/practice/spec";
import { dateInTimezone } from "@/lib/schedule/dates";
import { resolveAttentionRequirement, validateAttentionMode, type AttentionMode, type AttentionSource } from "@/lib/schedule/parent-attention";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AssignmentDTO = { id: string; artifactId: string | null; studentId: string; curriculumUnitId: string | null; title: string; subject: string; instructions: string | null; sequenceNumber: number | null; status: string; scheduledDate: string | null; dueAt: string | null; scheduledTime: string | null; estimatedMinutes: number | null; completedAt: string | null; submittedAt: string | null; sourceKind: string; attentionMode: AttentionMode | null; parentAttentionMinutes: number | null; resolvedAttentionMode: AttentionMode; resolvedParentMinutes: number; attentionInherited: boolean; attentionSource: AttentionSource };
export type CurriculumUnitDTO = { id: string; studentId: string; subject: string; title: string; sequenceLabel: string; nextSequenceNumber: number; defaultMinutes: number; weeklyFrequency: number; status: string; scheduleRule: unknown; curriculumUrl: string | null; attentionMode: AttentionMode; parentAttentionMinutes: number | null; assignmentCount: number; completedCount: number; activeCount: number };
export type SubmissionDTO = { id: string; assignmentId: string; status: string; note: string | null; submittedAt: string; evidenceIds: string[] };
export type AssignmentReviewDTO = { id: string; assignmentId: string; submissionId: string; status: string; draftScore: number | null; score: number | null; scoreLabel: string | null; draftFeedback: string | null; feedback: string | null; rubric: unknown; masterySignals: unknown; uncertaintyFlags: unknown; reviewedAt: string | null; skillKey: string | null; comparableKey: string | null; evidenceKind: string; evidenceStrength: string; scoreOrigin: string; gradingState: string; writtenReviewRequired: boolean; writtenReviewCompleted: boolean };
export type AdjustmentDTO = { id: string; studentId: string; weekStart: string; reason: string; summary: string; status: string; snapshotVersion: number; createdAt: string; undoStatus: string; undoExpiresAt: string | null; acknowledgedAt: string | null; acknowledgedBy: string | null; actions: Array<{ id: string; assignmentId: string | null; actionType: string; beforeState: unknown; afterState: unknown; position: number; status: string }> };
export type PlanningProposalDTO = { id: string; studentId: string | null; proposalKind: string; actionName: string; risk: string; title: string; summary: string; reason: string; changes: unknown; status: string; snapshotVersion: number; targetAssignmentId: string | null; targetGoalId: string | null; targetCurriculumUnitId: string | null; createdAt: string };
export type PracticeSessionDTO = { id: string; artifactId: string | null; studentId: string; status: string; spec: DynamicPracticeSpec; createdAt: string; completedAt: string | null };
export type CalendarConflictDTO = { id: string; studentId: string | null; conflictDate: string; allDay: boolean; startsAt: string | null; endsAt: string | null; title: string; note: string | null; createdAt: string; updatedAt: string };

export type OperationsWorkspaceRequest =
  | { surface: "today"; anchorDate?: string; studentId?: string }
  | { surface: "week"; anchorDate?: string; calendarMode: "week" | "month"; studentId?: string }
  | { surface: "assignments"; studentId?: string; curriculumUnitId?: string }
  | { surface: "review"; studentId?: string }
  | { surface: "adjustments"; studentId?: string };

type OperationSupabase = SupabaseClient<Database>;
export type OperationsBaseWorkspace = NonNullable<Awaited<ReturnType<typeof getWorkspace>>>;
type AssignmentRow = Database["public"]["Tables"]["assignments"]["Row"];
type CurriculumUnitRow = Pick<Database["public"]["Tables"]["curriculum_units"]["Row"], "id" | "student_id" | "subject" | "title" | "sequence_label" | "next_sequence_number" | "default_minutes" | "status" | "schedule_rule" | "curriculum_url" | "attention_mode" | "parent_attention_minutes">;

export async function getOperationsWorkspace(request: OperationsWorkspaceRequest) {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  return loadOperationsWorkspace(request, workspace, supabase);
}

export async function loadOperationsWorkspace(
  request: OperationsWorkspaceRequest,
  workspace: OperationsBaseWorkspace,
  supabase: OperationSupabase,
  now = new Date(),
) {
  const familyId = workspace.family.id;
  const currentDate = dateInTimezone(now, workspace.family.timezone);
  const selectedDate = resolveAnchorDate(request, currentDate);
  const calendarMode = request.surface === "week" ? request.calendarMode : null;
  const range = request.surface === "today"
    ? operationsDateRange("today", selectedDate)
    : request.surface === "week"
      ? operationsDateRange(request.calendarMode, selectedDate)
      : null;
  const selectedStudentId = workspace.students.some((student) => student.id === request.studentId) ? request.studentId! : null;
  const calendarSurface = request.surface === "today" || request.surface === "week";

  const [unitRows, adjustmentRows, planningRows, practiceRows, reviewQueueRows, conflictRows] = await Promise.all([
    loadCurriculumUnits(supabase, familyId),
    calendarSurface || request.surface === "adjustments" ? loadAdjustments(supabase, familyId) : Promise.resolve([]),
    calendarSurface || request.surface === "adjustments" ? loadPlanningProposals(supabase, familyId) : Promise.resolve([]),
    calendarSurface ? loadPracticeSessions(supabase, familyId) : Promise.resolve([]),
    request.surface === "review" ? loadDraftReviews(supabase, familyId) : Promise.resolve([]),
    range ? loadCalendarConflicts(supabase, familyId, range) : Promise.resolve([]),
  ]);

  const planningProposals = planningRows.map(toPlanningProposalDTO);
  const adjustments = adjustmentRows.map(toAdjustmentDTO);
  const unitsInScope = unitRows.filter((unit) => !selectedStudentId || unit.student_id === selectedStudentId);
  const selectedUnit = request.surface === "assignments"
    ? unitsInScope.find((unit) => unit.id === request.curriculumUnitId) ?? unitsInScope[0] ?? null
    : null;

  let scheduledRows: AssignmentRow[] = [];
  let courseAssignments: AssignmentDTO[] = [];
  let assignmentPage: { curriculumUnitId: string | null; nextCursor: string | null } | null = null;
  let statsRows: Awaited<ReturnType<typeof loadCurriculumStats>> = [];
  if (range) scheduledRows = await loadScheduledAssignmentRows(supabase, familyId, range);
  if (request.surface === "assignments") {
    const [stats, page] = await Promise.all([
      loadCurriculumStats(supabase, familyId, selectedStudentId),
      selectedUnit
        ? loadCurriculumAssignmentPage({ supabase, familyId, unit: selectedUnit, limit: CURRICULUM_ASSIGNMENT_PAGE_SIZE })
        : Promise.resolve({ assignments: [], nextCursor: null }),
    ]);
    statsRows = stats;
    courseAssignments = page.assignments;
    assignmentPage = { curriculumUnitId: selectedUnit?.id ?? null, nextCursor: page.nextCursor };
  }

  const referencedIds = new Set<string>();
  if (request.surface === "review") {
    for (const review of reviewQueueRows) referencedIds.add(review.assignment_id);
  }
  if (calendarSurface || request.surface === "adjustments") {
    for (const proposal of adjustments) {
      for (const action of proposal.actions) if (action.assignmentId) referencedIds.add(action.assignmentId);
    }
    for (const proposal of planningProposals) {
      for (const id of planningProposalAssignmentIds(proposal)) referencedIds.add(id);
    }
  }
  if (calendarSurface) collectInsightAssignmentIds(workspace.insights, referencedIds);

  const scheduledIds = new Set(scheduledRows.map((row) => row.id));
  const targetedRows = await loadAssignmentsByIds(supabase, familyId, [...referencedIds].filter((id) => !scheduledIds.has(id)));
  let assignmentRows = dedupeAssignmentsById([...scheduledRows, ...orderRowsByIds(targetedRows, [...referencedIds])]);

  let reviewRows = reviewQueueRows;
  if (calendarSurface && assignmentRows.length) reviewRows = await loadDraftReviewsForAssignments(supabase, familyId, assignmentRows.map((row) => row.id));
  const submissionIds = new Set(reviewRows.map((review) => review.submission_id));
  const submittedAssignmentIds = assignmentRows.filter((row) => ["submitted", "needs_review"].includes(row.status)).map((row) => row.id);
  const [submissionRows, artifactByAssignmentId] = await Promise.all([
    loadSubmissions(supabase, familyId, [...submissionIds], submittedAssignmentIds),
    loadAssignmentArtifacts(supabase, familyId, request.surface === "assignments" ? courseAssignments.map((item) => item.id) : assignmentRows.map((row) => row.id)),
  ]);

  if (request.surface !== "assignments") {
    const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));
    assignmentRows = dedupeAssignmentsById(assignmentRows);
    courseAssignments = assignmentRows.map((row) => toAssignmentDTO(row, unitById, artifactByAssignmentId));
  }

  const statsByUnit = new Map(statsRows.map((row) => [row.curriculum_unit_id, row]));
  const curriculumUnits = unitRows.map((item): CurriculumUnitDTO => {
    const stats = statsByUnit.get(item.id);
    return {
      id: item.id,
      studentId: item.student_id,
      subject: item.subject,
      title: item.title,
      sequenceLabel: item.sequence_label,
      nextSequenceNumber: item.next_sequence_number,
      defaultMinutes: item.default_minutes,
      weeklyFrequency: weeklyFrequency(item.schedule_rule),
      status: item.status,
      scheduleRule: item.schedule_rule,
      curriculumUrl: item.curriculum_url,
      attentionMode: validateAttentionMode(item.attention_mode),
      parentAttentionMinutes: item.parent_attention_minutes,
      assignmentCount: Number(stats?.assignment_count ?? 0),
      completedCount: Number(stats?.completed_count ?? 0),
      activeCount: Number(stats?.active_count ?? 0),
    };
  });

  return {
    ...workspace,
    currentDate,
    selectedDate,
    selectedStudentId,
    selectedCurriculumUnitId: selectedUnit?.id ?? null,
    calendarMode,
    assignmentPage,
    curriculumUnits,
    assignments: courseAssignments,
    submissions: submissionRows.map(toSubmissionDTO),
    assignmentReviews: reviewRows.map(toAssignmentReviewDTO),
    adjustments,
    planningProposals,
    practiceSessions: practiceRows.flatMap((item): PracticeSessionDTO[] => {
      const spec = normalizePracticeSpec(item.spec);
      return spec ? [{ id: item.id, artifactId: item.artifact_id, studentId: item.student_id, status: item.status, spec, createdAt: item.created_at, completedAt: item.completed_at }] : [];
    }),
    calendarConflicts: conflictRows.map((item): CalendarConflictDTO => ({ id: item.id, studentId: item.student_id, conflictDate: item.conflict_date, allDay: item.all_day, startsAt: item.starts_at, endsAt: item.ends_at, title: item.title, note: item.note, createdAt: item.created_at, updatedAt: item.updated_at })),
  };
}

export async function loadCurriculumAssignmentPage(input: {
  supabase: OperationSupabase;
  familyId: string;
  unit: CurriculumUnitRow;
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? CURRICULUM_ASSIGNMENT_PAGE_SIZE)));
  const cursor = input.cursor ? decodeCurriculumAssignmentCursor(input.cursor) : null;
  const result = await input.supabase.rpc("list_curriculum_assignments_page", {
    p_family_id: input.familyId,
    p_curriculum_unit_id: input.unit.id,
    p_student_id: input.unit.student_id,
    p_after_sequence: cursor?.sequence ?? undefined,
    p_after_id: cursor?.id,
    p_limit: limit + 1,
  }).select(ASSIGNMENT_SELECT_COLUMNS);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as unknown as AssignmentRow[];
  const page = pageWithLookahead(rows, limit, (row) => encodeCurriculumAssignmentCursor({ v: 1, sequence: row.sequence_number, id: row.id }));
  const artifacts = await loadAssignmentArtifacts(input.supabase, input.familyId, page.items.map((row) => row.id));
  const unitById = new Map([[input.unit.id, input.unit]]);
  return {
    assignments: page.items.map((row) => toAssignmentDTO(row, unitById, artifacts)),
    nextCursor: page.nextCursor,
  };
}

function resolveAnchorDate(request: OperationsWorkspaceRequest, currentDate: string) {
  if (request.surface !== "today" && request.surface !== "week") return currentDate;
  if (!request.anchorDate) return currentDate;
  try {
    operationsDateRange("today", request.anchorDate);
    return request.anchorDate;
  } catch {
    return currentDate;
  }
}

async function loadCurriculumUnits(supabase: OperationSupabase, familyId: string) {
  const result = await supabase.from("curriculum_units").select("id,student_id,subject,title,sequence_label,next_sequence_number,default_minutes,status,schedule_rule,curriculum_url,attention_mode,parent_attention_minutes").eq("family_id", familyId).neq("status", "archived").order("subject").order("title").order("id");
  if (result.error) throw result.error;
  return result.data as CurriculumUnitRow[];
}

async function loadScheduledAssignmentRows(supabase: OperationSupabase, familyId: string, range: { from: string; to: string }) {
  const rows: AssignmentRow[] = [];
  let cursor: ReturnType<typeof decodeScheduledAssignmentCursor> | null = null;
  do {
    const resultRows = await requestScheduledAssignmentPage(supabase, familyId, range, cursor);
    const page: { items: AssignmentRow[]; nextCursor: string | null } = pageWithLookahead(resultRows, SCHEDULED_ASSIGNMENT_PAGE_SIZE, (row) => encodeScheduledAssignmentCursor({ v: 1, date: row.scheduled_date!, time: row.scheduled_time, id: row.id }));
    rows.push(...page.items);
    cursor = page.nextCursor ? decodeScheduledAssignmentCursor(page.nextCursor) : null;
  } while (cursor);
  return dedupeAssignmentsById(rows);
}

async function requestScheduledAssignmentPage(supabase: OperationSupabase, familyId: string, range: { from: string; to: string }, cursor: ReturnType<typeof decodeScheduledAssignmentCursor> | null): Promise<AssignmentRow[]> {
  const result = await supabase.rpc("list_scheduled_assignments_page", {
    p_family_id: familyId,
    p_from: range.from,
    p_to: range.to,
    p_after_date: cursor?.date,
    p_after_time: cursor?.time ?? undefined,
    p_after_id: cursor?.id,
    p_limit: SCHEDULED_ASSIGNMENT_PAGE_SIZE + 1,
  }).select(ASSIGNMENT_SELECT_COLUMNS);
  if (result.error) throw result.error;
  return (result.data ?? []) as unknown as AssignmentRow[];
}

async function loadAssignmentsByIds(supabase: OperationSupabase, familyId: string, ids: string[]) {
  const rows: AssignmentRow[] = [];
  for (const chunk of chunks([...new Set(ids)], 100)) {
    const result = await supabase.from("assignments").select(ASSIGNMENT_SELECT_COLUMNS).eq("family_id", familyId).in("id", chunk);
    if (result.error) throw result.error;
    rows.push(...(result.data as unknown as AssignmentRow[]));
  }
  return dedupeAssignmentsById(rows);
}

async function loadCurriculumStats(supabase: OperationSupabase, familyId: string, studentId: string | null) {
  const result = await supabase.rpc("curriculum_assignment_stats", { p_family_id: familyId, p_student_id: studentId ?? undefined });
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function loadAssignmentArtifacts(supabase: OperationSupabase, familyId: string, assignmentIds: string[]) {
  const artifacts = new Map<string, string | null>();
  for (const chunk of chunks([...new Set(assignmentIds)], 100)) {
    const result = await supabase.from("weekly_plan_items").select("assignment_id,artifact_id").eq("family_id", familyId).in("assignment_id", chunk);
    if (result.error) throw result.error;
    for (const row of result.data) if (row.assignment_id) artifacts.set(row.assignment_id, row.artifact_id);
  }
  return artifacts;
}

async function loadDraftReviews(supabase: OperationSupabase, familyId: string) {
  const result = await supabase.from("assignment_reviews").select(REVIEW_COLUMNS).eq("family_id", familyId).eq("status", "draft").order("created_at", { ascending: false }).order("id").limit(100);
  if (result.error) throw result.error;
  return result.data;
}

async function loadDraftReviewsForAssignments(supabase: OperationSupabase, familyId: string, assignmentIds: string[]) {
  const rows: ReviewRow[] = [];
  for (const chunk of chunks([...new Set(assignmentIds)], 100)) {
    const result = await supabase.from("assignment_reviews").select(REVIEW_COLUMNS).eq("family_id", familyId).eq("status", "draft").in("assignment_id", chunk).order("created_at", { ascending: false });
    if (result.error) throw result.error;
    rows.push(...result.data);
  }
  return rows;
}

const REVIEW_COLUMNS = "id,assignment_id,submission_id,status,draft_score,score,score_label,draft_feedback,feedback,rubric,mastery_signals,uncertainty_flags,reviewed_at,skill_key,comparable_key,evidence_kind,evidence_strength,score_origin,grading_state,written_review_required,written_review_completed";
type ReviewRow = Awaited<ReturnType<typeof loadDraftReviews>>[number];

async function loadSubmissions(supabase: OperationSupabase, familyId: string, submissionIds: string[], assignmentIds: string[]) {
  const rows: SubmissionRow[] = [];
  for (const chunk of chunks([...new Set(submissionIds)], 100)) {
    const result = await supabase.from("assignment_submissions").select("id,assignment_id,status,note,submitted_at,assignment_submission_evidence(evidence_id)").eq("family_id", familyId).in("id", chunk);
    if (result.error) throw result.error;
    rows.push(...result.data);
  }
  for (const chunk of chunks([...new Set(assignmentIds)], 100)) {
    const result = await supabase.from("assignment_submissions").select("id,assignment_id,status,note,submitted_at,assignment_submission_evidence(evidence_id)").eq("family_id", familyId).in("assignment_id", chunk).order("submitted_at", { ascending: false });
    if (result.error) throw result.error;
    rows.push(...result.data);
  }
  return dedupeAssignmentsById(rows).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}
type SubmissionRow = Pick<Database["public"]["Tables"]["assignment_submissions"]["Row"], "id" | "assignment_id" | "status" | "note" | "submitted_at"> & { assignment_submission_evidence: Array<{ evidence_id: string }> };

async function loadAdjustments(supabase: OperationSupabase, familyId: string) {
  const result = await supabase.from("adjustment_proposals").select("id,student_id,week_start,reason,summary,status,snapshot_version,created_at,undo_status,undo_expires_at,acknowledged_at,acknowledged_by,adjustment_actions(id,assignment_id,action_type,before_state,after_state,position,status)").eq("family_id", familyId).or("status.eq.proposed,and(status.eq.applied,acknowledged_at.is.null),and(status.eq.applied,undo_status.eq.available)").order("created_at", { ascending: false }).limit(50);
  if (result.error) throw result.error;
  return result.data;
}

async function loadPlanningProposals(supabase: OperationSupabase, familyId: string) {
  const result = await supabase.from("planning_proposals").select("id,student_id,proposal_kind,action_name,risk,title,summary,reason,proposed_changes,status,snapshot_version,target_assignment_id,target_goal_id,target_curriculum_unit_id,created_at").eq("family_id", familyId).in("status", ["proposed", "applied"]).order("created_at", { ascending: false }).limit(50);
  if (result.error) throw result.error;
  return result.data;
}

async function loadPracticeSessions(supabase: OperationSupabase, familyId: string) {
  const result = await supabase.from("practice_sessions").select("id,artifact_id,student_id,status,spec,created_at,completed_at").eq("family_id", familyId).order("created_at", { ascending: false }).limit(60);
  if (result.error) throw result.error;
  return result.data;
}

async function loadCalendarConflicts(supabase: OperationSupabase, familyId: string, range: { from: string; to: string }) {
  const rows: CalendarConflictRow[] = [];
  let afterId: string | null = null;
  do {
    let query = supabase.from("calendar_conflicts").select("id,student_id,conflict_date,all_day,starts_at,ends_at,title,note,created_at,updated_at").eq("family_id", familyId).gte("conflict_date", range.from).lte("conflict_date", range.to).order("id").limit(501);
    if (afterId) query = query.gt("id", afterId);
    const result = await query;
    if (result.error) throw result.error;
    const page = result.data.slice(0, 500);
    rows.push(...page);
    afterId = result.data.length > 500 ? page.at(-1)!.id : null;
  } while (afterId);
  return rows.sort((a, b) => a.conflict_date.localeCompare(b.conflict_date) || (a.starts_at ?? "").localeCompare(b.starts_at ?? "") || a.id.localeCompare(b.id));
}
type CalendarConflictRow = Pick<Database["public"]["Tables"]["calendar_conflicts"]["Row"], "id" | "student_id" | "conflict_date" | "all_day" | "starts_at" | "ends_at" | "title" | "note" | "created_at" | "updated_at">;

function toAssignmentDTO(row: AssignmentRow, unitById: Map<string, CurriculumUnitRow>, artifacts: Map<string, string | null>): AssignmentDTO {
  const unit = row.curriculum_unit_id ? unitById.get(row.curriculum_unit_id) : null;
  const attention = resolveAttentionRequirement({ assignmentMode: row.attention_mode, assignmentParentMinutes: row.parent_attention_minutes, curriculumMode: unit?.attention_mode, curriculumParentMinutes: unit?.parent_attention_minutes, lessonMinutes: row.estimated_minutes });
  return { id: row.id, artifactId: artifacts.get(row.id) ?? null, studentId: row.student_id, curriculumUnitId: row.curriculum_unit_id, title: row.title, subject: row.subject, instructions: row.instructions, sequenceNumber: row.sequence_number, status: row.status, scheduledDate: row.scheduled_date, dueAt: row.due_at, scheduledTime: row.scheduled_time, estimatedMinutes: row.estimated_minutes, completedAt: row.completed_at, submittedAt: row.submitted_at, sourceKind: row.source_kind, attentionMode: row.attention_mode === null ? null : validateAttentionMode(row.attention_mode), parentAttentionMinutes: row.parent_attention_minutes, resolvedAttentionMode: attention.mode, resolvedParentMinutes: attention.parentMinutes, attentionInherited: attention.inherited, attentionSource: attention.source };
}

function toSubmissionDTO(item: SubmissionRow): SubmissionDTO {
  return { id: item.id, assignmentId: item.assignment_id, status: item.status, note: item.note, submittedAt: item.submitted_at, evidenceIds: item.assignment_submission_evidence.map((link) => link.evidence_id) };
}

function toAssignmentReviewDTO(item: ReviewRow): AssignmentReviewDTO {
  return { id: item.id, assignmentId: item.assignment_id, submissionId: item.submission_id, status: item.status, draftScore: item.draft_score === null ? null : Number(item.draft_score), score: item.score === null ? null : Number(item.score), scoreLabel: item.score_label, draftFeedback: item.draft_feedback, feedback: item.feedback, rubric: item.rubric, masterySignals: item.mastery_signals, uncertaintyFlags: item.uncertainty_flags, reviewedAt: item.reviewed_at, skillKey: item.skill_key, comparableKey: item.comparable_key, evidenceKind: item.evidence_kind, evidenceStrength: item.evidence_strength, scoreOrigin: item.score_origin, gradingState: item.grading_state, writtenReviewRequired: item.written_review_required, writtenReviewCompleted: item.written_review_completed };
}

function toAdjustmentDTO(item: Awaited<ReturnType<typeof loadAdjustments>>[number]): AdjustmentDTO {
  return { id: item.id, studentId: item.student_id, weekStart: item.week_start, reason: item.reason, summary: item.summary, status: item.status, snapshotVersion: item.snapshot_version, createdAt: item.created_at, undoStatus: item.undo_status, undoExpiresAt: item.undo_expires_at, acknowledgedAt: item.acknowledged_at, acknowledgedBy: item.acknowledged_by, actions: item.adjustment_actions.sort((a, b) => a.position - b.position).map((action) => ({ id: action.id, assignmentId: action.assignment_id, actionType: action.action_type, beforeState: action.before_state, afterState: action.after_state, position: action.position, status: action.status })) };
}

function toPlanningProposalDTO(item: Awaited<ReturnType<typeof loadPlanningProposals>>[number]): PlanningProposalDTO {
  return { id: item.id, studentId: item.student_id, proposalKind: item.proposal_kind, actionName: item.action_name, risk: item.risk, title: item.title, summary: item.summary, reason: item.reason, changes: item.proposed_changes, status: item.status, snapshotVersion: item.snapshot_version, targetAssignmentId: item.target_assignment_id, targetGoalId: item.target_goal_id, targetCurriculumUnitId: item.target_curriculum_unit_id, createdAt: item.created_at };
}

function collectInsightAssignmentIds(insights: Array<{ evidenceRefs: unknown[]; actionRef: Record<string, unknown> }>, ids: Set<string>) {
  for (const insight of insights) {
    for (const ref of insight.evidenceRefs) {
      if (ref && typeof ref === "object" && !Array.isArray(ref) && (ref as Record<string, unknown>).type === "assignment" && typeof (ref as Record<string, unknown>).id === "string") ids.add((ref as Record<string, unknown>).id as string);
    }
    if (typeof insight.actionRef.assignmentId === "string") ids.add(insight.actionRef.assignmentId);
    if (Array.isArray(insight.actionRef.assignmentIds)) for (const id of insight.actionRef.assignmentIds) if (typeof id === "string") ids.add(id);
  }
}

function orderRowsByIds(rows: AssignmentRow[], ids: string[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function weeklyFrequency(rule: unknown) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return 5;
  const value = "weeklyFrequency" in rule ? Number(rule.weeklyFrequency) : 5;
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : 5;
}
