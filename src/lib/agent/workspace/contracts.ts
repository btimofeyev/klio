import { z } from "zod";
import { generatedPracticeSpecSchema } from "@/lib/practice/spec";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";

const databaseId = postgresUuidSchema;

export const workspaceToolNames = [
  "read_capture", "read_family_context", "read_goals_and_pacing", "read_review_queue",
  "read_assignment_review_context", "read_relevant_history",
  "file_capture", "create_reminder", "ask_parent",
  "record_explicit_completion", "record_explicit_parent_score", "update_assignment_status",
  "move_unfinished_work", "organize_day_schedule", "create_assignment", "create_schedule_block", "move_schedule_work", "resize_schedule_work",
  "propose_learner_goal", "propose_curriculum_change", "draft_assignment_review", "return_work_with_draft_feedback",
  "create_targeted_lesson", "create_supplemental_practice", "remove_supplemental_practice",
  "prepare_planning_changes", "present_action_card",
  "update_subject_summary_draft", "build_dashboard", "draft_weekly_plan", "create_lesson",
  "create_practice_activity", "build_portfolio", "update_records_draft",
] as const;

export type WorkspaceToolName = (typeof workspaceToolNames)[number];

export const workspaceToolSchemas = {
  read_capture: z.object({ evidenceId: databaseId }).strict(),
  read_family_context: z.object({ studentId: databaseId.optional() }).strict(),
  read_goals_and_pacing: z.object({ studentId: databaseId.optional(), goalId: databaseId.optional() }).strict(),
  read_review_queue: z.object({ studentId: databaseId.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(),
  read_assignment_review_context: z.object({ reviewId: databaseId }).strict(),
  read_relevant_history: z.object({
    studentId: databaseId, subject: z.string().trim().min(1).max(80).optional(),
    before: z.iso.datetime().optional(), limit: z.number().int().min(1).max(50).default(20),
  }).strict(),
  create_reminder: z.object({
    title: z.string().trim().min(1).max(200), dueAt: z.iso.datetime(), studentId: databaseId.nullable().optional(),
    sourceEvidenceId: databaseId.nullable().optional(), confidence: z.number().min(0).max(1).optional(), rationale: z.string().max(1000).optional(),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  file_capture: z.object({
    evidenceId: databaseId, studentId: databaseId,
    category: z.enum(["Math", "Language Arts", "Science", "Social Studies", "Art", "Music", "Physical Education", "Life Skills", "Other"]),
    documentType: z.string().trim().min(1).max(80), tags: z.array(z.string().trim().min(1).max(40)).max(8),
    confidence: z.number().min(0).max(1), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  ask_parent: z.object({
    question: z.string().trim().min(1).max(300),
    reason: z.enum(["missing_student", "ambiguous_date", "ambiguous_intent", "uncertain_subject", "missing_context"]),
    studentId: databaseId.nullable().optional(), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  record_explicit_completion: z.object({
    assignmentId: databaseId, idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  record_explicit_parent_score: z.object({
    assignmentId: databaseId, submissionId: databaseId.optional(), score: z.number().min(0).max(100),
    scoreLabel: z.string().trim().max(40).nullable().optional(), feedback: z.string().trim().max(5000).optional(),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  update_assignment_status: z.object({
    assignmentId: databaseId, status: z.enum(["planned", "doing", "submitted", "completed", "skipped", "needs_review"]),
    explicitParentAuthorization: z.literal(true), reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  move_unfinished_work: z.object({
    assignmentIds: z.array(databaseId).min(1).max(20), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  organize_day_schedule: z.object({
    studentId: databaseId,
    scheduledDate: z.iso.date(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable().optional(),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  create_assignment: assignmentWriteSchema(),
  create_schedule_block: assignmentWriteSchema().extend({ scheduledDate: z.iso.date(), scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable().optional() }).strict(),
  move_schedule_work: z.object({
    assignmentIds: z.array(databaseId).min(1).max(20), targetDate: z.iso.date(),
    reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  resize_schedule_work: z.object({
    assignmentId: databaseId, estimatedMinutes: z.number().int().min(5).max(480),
    reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  propose_learner_goal: z.object({
    studentId: databaseId, goalId: databaseId.optional(), termId: databaseId.nullable().optional(), subject: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(200), description: z.string().trim().max(3000).nullable().optional(),
    goalKind: z.enum(["curriculum_progress", "milestone", "effort", "credit", "hours", "standard", "custom"]),
    targetValue: z.number().min(0).max(1_000_000).nullable().optional(), targetUnit: z.string().trim().max(40).nullable().optional(),
    targetDate: z.iso.date().nullable().optional(), weeklyEffortMinutes: z.number().int().min(0).max(10080).nullable().optional(),
    weeklyCadence: z.number().int().min(0).max(14).nullable().optional(), priority: z.number().int().min(0).max(100),
    constraints: z.string().trim().max(2000).nullable().optional(), reason: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  propose_curriculum_change: z.object({
    studentId: databaseId, curriculumUnitId: databaseId.optional(), termId: databaseId.nullable().optional(),
    changeKind: z.enum(["create_curriculum", "change_curriculum_cadence"]), subject: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(200), targetCompletionDate: z.iso.date().nullable().optional(),
    weeklyCadence: z.number().int().min(1).max(14), weeklyEffortMinutes: z.number().int().min(5).max(10080),
    defaultMinutes: z.number().int().min(5).max(480).optional(), reason: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  draft_assignment_review: z.object({ reviewId: databaseId, idempotencyKey: z.string().min(8).max(200) }).strict(),
  return_work_with_draft_feedback: z.object({
    reviewId: databaseId, feedback: z.string().trim().min(1).max(5000), nextStep: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  create_targeted_lesson: evidenceDraftSchema(),
  create_supplemental_practice: practiceDraftSchema().extend({
    reviewIds: z.array(databaseId).min(1).max(10), assignmentId: databaseId, scheduleDate: z.iso.date().nullable().optional(),
  }).strict(),
  remove_supplemental_practice: z.object({
    assignmentId: databaseId, reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  prepare_planning_changes: z.object({
    studentId: databaseId, scope: z.enum(["week", "term"]), title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1200), reason: z.string().trim().min(1).max(2000),
    assignmentIds: z.array(databaseId).max(30), changes: z.array(z.object({
      assignmentId: databaseId, scheduledDate: z.iso.date().nullable().optional(), estimatedMinutes: z.number().int().min(5).max(480).optional(),
    }).strict()).max(30), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  present_action_card: z.object({
    kind: z.enum(["completed", "draft_ready", "proposal", "clarification", "undoable", "needs_detail", "no_op", "partial"]),
    message: z.string().trim().min(1).max(1000), targetType: z.enum(["artifact", "assignment_review", "adjustment", "planning_proposal", "evidence", "goal", "curriculum", "week", "activity"]).nullable().optional(),
    targetId: databaseId.nullable().optional(),
  }).strict(),
  update_subject_summary_draft: draftSchema(), build_dashboard: draftSchema(), draft_weekly_plan: draftSchema(),
  create_lesson: draftSchema(), create_practice_activity: practiceDraftSchema(), build_portfolio: draftSchema(), update_records_draft: draftSchema(),
} satisfies Record<WorkspaceToolName, z.ZodType>;

function draftSchema() {
  return z.object({
    studentId: databaseId.nullable().optional(), title: z.string().trim().min(1).max(200),
    summary: z.string().max(4000).optional(), content: z.record(z.string(), z.unknown()),
    rationale: z.string().max(4000).optional(), idempotencyKey: z.string().min(8).max(200),
  }).strict();
}

function practiceDraftSchema() {
  return z.object({
    studentId: databaseId, title: z.string().trim().min(1).max(200),
    summary: z.string().max(4000).optional(),
    content: z.object({ practice: generatedPracticeSpecSchema }).passthrough(),
    rationale: z.string().max(4000).optional(), idempotencyKey: z.string().min(8).max(200),
  }).strict();
}

function assignmentWriteSchema() {
  return z.object({
    studentId: databaseId, curriculumUnitId: databaseId.nullable().optional(), title: z.string().trim().min(1).max(200),
    subject: z.string().trim().min(1).max(80), instructions: z.string().trim().max(5000).nullable().optional(),
    scheduledDate: z.iso.date().nullable().optional(), dueAt: z.iso.datetime().nullable().optional(),
    estimatedMinutes: z.number().int().min(5).max(480).nullable().optional(),
    sourceKind: z.enum(["curriculum", "parent", "agent"]).default("agent"),
    idempotencyKey: z.string().min(8).max(200),
  }).strict();
}

function evidenceDraftSchema() {
  return draftSchema().extend({
    assignmentId: databaseId, reviewIds: z.array(databaseId).max(10), evidenceIds: z.array(databaseId).min(1).max(20),
  }).strict();
}

export type WorkspaceToolArguments = {
  [K in WorkspaceToolName]: z.infer<(typeof workspaceToolSchemas)[K]>;
};
