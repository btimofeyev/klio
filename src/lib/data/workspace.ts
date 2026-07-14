import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/auth/require-parent";
import { agentEventLabel } from "@/lib/agent/workspace/presentation";

export type StudentDTO = {
  id: string;
  displayName: string;
  gradeBand: string | null;
  learningPreferences: string | null;
  dailyCapacityMinutes?: number;
  subjects?: Array<{ name: string; courseName: string | null; weeklyFrequency: number }>;
};

export type EvidenceDTO = {
  id: string;
  captureSubmissionId: string | null;
  captureRoute: string;
  kind: string;
  title: string | null;
  rawText: string | null;
  mimeType: string | null;
  storagePath: string | null;
  sourceAt: string;
  status: string;
  createdAt: string;
  studentIds: string[];
  categories: EvidenceCategoryDTO[];
};

export type EvidenceCategoryDTO = {
  id: string;
  name: string;
  slug: string;
  documentType: string | null;
  tags: string[];
  confidence: number | null;
};

export type CategoryDTO = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  evidenceCount: number;
};

export type ArtifactDTO = {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  content: unknown;
  rationale: string | null;
  status: string;
  createdAt: string;
  studentId: string | null;
};

export type AgentJobDTO = {
  id: string;
  status: string;
  totalActions: number;
  completedActions: number;
  failedActions: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  actions: Array<{ id: string; intent: string; status: string; errorMessage: string | null }>;
};

export type ReminderDTO = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: string;
  studentId: string | null;
  sourceEvidenceId: string | null;
  createdAt: string;
};

export type ScheduleItemDTO = {
  id: string;
  artifactId: string | null;
  studentId: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  title: string;
  description: string | null;
  estimatedMinutes: number | null;
  subject: string | null;
  curriculumUrl: string | null;
  sourceKind: string;
  rescheduledCount: number;
  completedAt: string | null;
  position: number;
  artifact: { type: string; status: string } | null;
};

export type AgentTurnDTO = {
  id: string;
  status: string;
  goal: string;
  request: string;
  result: { message?: string } | null;
  events: Array<{ sequence: number; kind: string; label: string }>;
  tools: Array<{ result: unknown }>;
};

export const getWorkspace = cache(async () => {
  const parent = await requireParent();
  const supabase = await createClient();

  const { data: membership, error: membershipError } = await supabase
    .from("family_members")
    .select("family_id, role")
    .eq("user_id", parent.id)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return null;

  const familyId = membership.family_id;
  const [familyResult, studentsResult, subjectsResult, evidenceResult, artifactsResult, approvalsResult, categoriesResult, jobsResult, remindersResult, scheduleResult, latestTurnResult] = await Promise.all([
    supabase.from("families").select("id, name, timezone, available_days").eq("id", familyId).single(),
    supabase.from("students").select("id, display_name, grade_band, learning_preferences, daily_capacity_minutes").eq("family_id", familyId).eq("active", true).order("created_at"),
    supabase.from("student_subjects").select("student_id,name,course_name,weekly_frequency,position").eq("family_id", familyId).eq("status", "active").order("position"),
    supabase.from("evidence_items").select("id, capture_submission_id, capture_route, kind, title, raw_text, mime_type, storage_path, source_at, processing_status, created_at, evidence_students(student_id), evidence_categories(document_type, tags, confidence, categories(id, name, slug))").eq("family_id", familyId).order("created_at", { ascending: false }).limit(40),
    supabase.from("artifacts").select("id, type, title, summary, content, rationale, status, created_at, student_id").eq("family_id", familyId).order("created_at", { ascending: false }).limit(20),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "pending"),
    supabase.from("categories").select("id, name, slug, description, evidence_categories(count)").eq("family_id", familyId).order("name"),
    supabase.from("agent_jobs").select("id, status, total_actions, completed_actions, failed_actions, error_message, created_at, completed_at, agent_job_actions(id, intent, status, error_message)").eq("family_id", familyId).order("created_at", { ascending: false }).limit(12),
    supabase.from("reminders").select("id, title, notes, due_at, status, student_id, source_evidence_id, created_at").eq("family_id", familyId).in("status", ["pending", "completed"]).order("due_at", { ascending: true, nullsFirst: false }).limit(30),
    supabase.from("weekly_plan_items").select("id, artifact_id, student_id, scheduled_date, scheduled_time, title, description, estimated_minutes, subject, curriculum_url, source_kind, rescheduled_count, completed_at, position, artifacts(type, status)").eq("family_id", familyId).order("scheduled_date", { ascending: true, nullsFirst: false }).order("scheduled_time", { ascending: true, nullsFirst: false }).order("position").limit(120),
    supabase.from("agent_turns").select("id, status, goal, snapshot_summary, public_result, agent_events(sequence, kind, payload), agent_tool_calls(result_summary)").eq("family_id", familyId).in("status", ["queued", "running", "awaiting_parent"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (familyResult.error) throw familyResult.error;
  if (studentsResult.error) throw studentsResult.error;
  if (subjectsResult.error) throw subjectsResult.error;
  if (evidenceResult.error) throw evidenceResult.error;
  if (artifactsResult.error) throw artifactsResult.error;
  if (approvalsResult.error) throw approvalsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  if (jobsResult.error) throw jobsResult.error;
  if (remindersResult.error) throw remindersResult.error;
  if (scheduleResult.error) throw scheduleResult.error;
  if (latestTurnResult.error) throw latestTurnResult.error;

  return {
    parent,
    family: familyResult.data,
    role: membership.role,
    students: studentsResult.data.map((student): StudentDTO => ({
      id: student.id,
      displayName: student.display_name,
      gradeBand: student.grade_band,
      learningPreferences: student.learning_preferences,
      dailyCapacityMinutes: student.daily_capacity_minutes,
      subjects: subjectsResult.data.filter((subject) => subject.student_id === student.id).map((subject) => ({ name: subject.name, courseName: subject.course_name, weeklyFrequency: subject.weekly_frequency })),
    })),
    evidence: evidenceResult.data.map((item): EvidenceDTO => ({
      id: item.id,
      captureSubmissionId: item.capture_submission_id,
      captureRoute: item.capture_route,
      kind: item.kind,
      title: item.title,
      rawText: item.raw_text,
      mimeType: item.mime_type,
      storagePath: item.storage_path,
      sourceAt: item.source_at,
      status: item.processing_status,
      createdAt: item.created_at,
      studentIds: item.evidence_students.map((link) => link.student_id),
      categories: item.evidence_categories.map((link) => ({
        id: link.categories.id,
        name: link.categories.name,
        slug: link.categories.slug,
        documentType: link.document_type,
        tags: link.tags,
        confidence: link.confidence,
      })),
    })),
    categories: categoriesResult.data.map((category): CategoryDTO => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      evidenceCount: category.evidence_categories[0]?.count ?? 0,
    })),
    artifacts: artifactsResult.data.map((artifact): ArtifactDTO => ({
      id: artifact.id,
      type: artifact.type,
      title: artifact.title,
      summary: artifact.summary,
      content: artifact.content,
      rationale: artifact.rationale,
      status: artifact.status,
      createdAt: artifact.created_at,
      studentId: artifact.student_id,
    })),
    agentJobs: jobsResult.data.map((job): AgentJobDTO => ({
      id: job.id,
      status: job.status,
      totalActions: job.total_actions,
      completedActions: job.completed_actions,
      failedActions: job.failed_actions,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      completedAt: job.completed_at,
      actions: job.agent_job_actions.map((action) => ({
        id: action.id,
        intent: action.intent,
        status: action.status,
        errorMessage: action.error_message,
      })),
    })),
    reminders: remindersResult.data.map((reminder): ReminderDTO => ({
      id: reminder.id,
      title: reminder.title,
      notes: reminder.notes,
      dueAt: reminder.due_at,
      status: reminder.status,
      studentId: reminder.student_id,
      sourceEvidenceId: reminder.source_evidence_id,
      createdAt: reminder.created_at,
    })),
    scheduleItems: scheduleResult.data.map((item): ScheduleItemDTO => ({
      id: item.id,
      artifactId: item.artifact_id,
      studentId: item.student_id,
      scheduledDate: item.scheduled_date,
      scheduledTime: item.scheduled_time,
      title: item.title,
      description: item.description,
      estimatedMinutes: item.estimated_minutes,
      subject: item.subject,
      curriculumUrl: item.curriculum_url,
      sourceKind: item.source_kind,
      rescheduledCount: item.rescheduled_count,
      completedAt: item.completed_at,
      position: item.position,
      artifact: item.artifacts,
    })),
    pendingApprovals: approvalsResult.count ?? 0,
    latestAgentTurn: latestTurnResult.data ? ({
      id: latestTurnResult.data.id,
      status: latestTurnResult.data.status,
      goal: latestTurnResult.data.goal,
      request: ((latestTurnResult.data.snapshot_summary as { request?: string | null } | null)?.request ?? `Complete a ${latestTurnResult.data.goal.replaceAll("_", " ")} job.`),
      result: latestTurnResult.data.public_result as { message?: string } | null,
      events: [...latestTurnResult.data.agent_events].sort((a, b) => a.sequence - b.sequence).map((event) => ({ sequence: event.sequence, kind: event.kind, label: agentEventLabel(event.kind, event.payload) })),
      tools: latestTurnResult.data.agent_tool_calls.map((tool) => ({ result: tool.result_summary })),
    } satisfies AgentTurnDTO) : null,
  };
});
