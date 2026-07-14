import { z } from "zod";
import { dynamicPracticeSpecSchema } from "@/lib/practice/spec";

export const workspaceToolNames = [
  "read_capture", "read_family_context", "file_capture", "create_reminder", "ask_parent",
  "update_subject_summary_draft", "build_dashboard", "draft_weekly_plan", "create_lesson",
  "create_practice_activity", "build_portfolio", "update_records_draft",
] as const;

export type WorkspaceToolName = (typeof workspaceToolNames)[number];

export const workspaceToolSchemas = {
  read_capture: z.object({ evidenceId: z.uuid() }).strict(),
  read_family_context: z.object({ studentId: z.uuid().optional() }).strict(),
  create_reminder: z.object({
    title: z.string().trim().min(1).max(200), dueAt: z.iso.datetime(), studentId: z.uuid().nullable().optional(),
    sourceEvidenceId: z.uuid().nullable().optional(), confidence: z.number().min(0).max(1).optional(), rationale: z.string().max(1000).optional(),
    idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  file_capture: z.object({
    evidenceId: z.uuid(), studentId: z.uuid(),
    category: z.enum(["Math", "Language Arts", "Science", "Social Studies", "Art", "Music", "Physical Education", "Life Skills", "Other"]),
    documentType: z.string().trim().min(1).max(80), tags: z.array(z.string().trim().min(1).max(40)).max(8),
    confidence: z.number().min(0).max(1), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  ask_parent: z.object({
    question: z.string().trim().min(1).max(300),
    reason: z.enum(["missing_student", "ambiguous_date", "ambiguous_intent", "uncertain_subject", "missing_context"]),
    studentId: z.uuid().nullable().optional(), idempotencyKey: z.string().min(8).max(200),
  }).strict(),
  update_subject_summary_draft: draftSchema(), build_dashboard: draftSchema(), draft_weekly_plan: draftSchema(),
  create_lesson: draftSchema(), create_practice_activity: practiceDraftSchema(), build_portfolio: draftSchema(), update_records_draft: draftSchema(),
} satisfies Record<WorkspaceToolName, z.ZodType>;

function draftSchema() {
  return z.object({
    studentId: z.uuid().nullable().optional(), title: z.string().trim().min(1).max(200),
    summary: z.string().max(4000).optional(), content: z.record(z.string(), z.unknown()),
    rationale: z.string().max(4000).optional(), idempotencyKey: z.string().min(8).max(200),
  }).strict();
}

function practiceDraftSchema() {
  return z.object({
    studentId: z.uuid(), title: z.string().trim().min(1).max(200),
    summary: z.string().max(4000).optional(),
    content: z.object({ practice: dynamicPracticeSpecSchema }).passthrough(),
    rationale: z.string().max(4000).optional(), idempotencyKey: z.string().min(8).max(200),
  }).strict();
}

export type WorkspaceToolArguments = {
  [K in WorkspaceToolName]: z.infer<(typeof workspaceToolSchemas)[K]>;
};
