import "server-only";

import { cache } from "react";
import { normalizePublicResult, type PublicResult } from "@/lib/agent/workspace/public-result";
import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/auth/require-parent";
import { agentEventLabel } from "@/lib/agent/workspace/presentation";

export type StudentDTO = {
  id: string;
  displayName: string;
  gradeBand: string | null;
  learningPreferences: string | null;
  dailyCapacityMinutes?: number;
  schedulePreferences?: unknown;
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
  result: PublicResult | null;
  clarification: { threadId: string; messageId: string; question: string; status: string } | null;
  events: Array<{ sequence: number; kind: string; label: string }>;
  tools: Array<{ result: unknown }>;
  taskName: string;
  studentId: string | null;
  subject: string | null;
  sourceCount: number;
  normalizedStep: string | null;
  expectedOutput: string | null;
  createdAt: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastProgressAt: string | null;
  conversationId: string | null;
  interactionMode: "answer" | "act";
  streamedMessage: string | null;
};

export type AgentConversationDTO = {
  id: string;
  title: string;
  studentId: string | null;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; turnId: string | null; createdAt: string }>;
};

export type KlioInsightDTO = {
  id: string; studentId: string | null; kind: string; title: string; summary: string; reason: string | null;
  priority: number; evidenceRefs: unknown[]; actionRef: Record<string, unknown>; createdAt: string;
};

export type WorkspaceLayoutDTO = {
  surface: "day" | "week";
  scopeKey: string;
  layoutVersion: number;
  positions: Record<string, { x: number; y: number }>;
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
  const [familyResult, studentsResult, subjectsResult, evidenceResult, artifactsResult, approvalsResult, categoriesResult, jobsResult, remindersResult, scheduleResult, latestTurnResult, insightsResult, autonomyResult, layoutsResult, questionsResult, latestConversationResult] = await Promise.all([
    supabase.from("families").select("id, name, timezone, available_days").eq("id", familyId).single(),
    supabase.from("students").select("id, display_name, grade_band, learning_preferences, daily_capacity_minutes, schedule_preferences").eq("family_id", familyId).eq("active", true).order("created_at"),
    supabase.from("student_subjects").select("student_id,name,course_name,weekly_frequency,position").eq("family_id", familyId).eq("status", "active").order("position"),
    supabase.from("evidence_items").select("id, capture_submission_id, capture_route, kind, title, raw_text, mime_type, storage_path, source_at, processing_status, created_at, evidence_students(student_id), evidence_categories(document_type, tags, confidence, categories(id, name, slug))").eq("family_id", familyId).order("created_at", { ascending: false }).limit(40),
    supabase.from("artifacts").select("id, type, title, summary, content, rationale, status, created_at, student_id").eq("family_id", familyId).order("created_at", { ascending: false }).limit(20),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "pending"),
    supabase.from("categories").select("id, name, slug, description, evidence_categories(count)").eq("family_id", familyId).order("name"),
    supabase.from("agent_jobs").select("id, status, total_actions, completed_actions, failed_actions, error_message, created_at, completed_at, agent_job_actions(id, intent, status, error_message)").eq("family_id", familyId).order("created_at", { ascending: false }).limit(12),
    supabase.from("reminders").select("id, title, notes, due_at, status, student_id, source_evidence_id, created_at").eq("family_id", familyId).in("status", ["pending", "completed"]).order("due_at", { ascending: true, nullsFirst: false }).limit(30),
    supabase.from("weekly_plan_items").select("id, artifact_id, student_id, scheduled_date, scheduled_time, title, description, estimated_minutes, subject, curriculum_url, source_kind, rescheduled_count, completed_at, position, artifacts(type, status)").eq("family_id", familyId).order("scheduled_date", { ascending: true, nullsFirst: false }).order("scheduled_time", { ascending: true, nullsFirst: false }).order("position").limit(120),
    supabase.from("agent_turns").select("id,status,goal,student_id,task_name,subject,source_count,normalized_step,expected_output,created_at,started_at,last_heartbeat_at,last_progress_at,snapshot_summary,public_result,conversation_id,interaction_mode,streamed_message,agent_events(sequence,kind,payload),agent_tool_calls(result_summary)").eq("family_id", familyId).is("dismissed_at", null).in("status", ["queued", "running", "awaiting_parent", "failed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("klio_insights").select("id,student_id,kind,title,summary,reason,priority,evidence_refs,action_ref,created_at").eq("family_id", familyId).eq("status", "active").order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(3),
    supabase.from("family_autonomy_policies").select("preset,policies").eq("family_id", familyId).maybeSingle(),
    supabase.from("family_workspace_layouts").select("surface,scope_key,layout_version,positions").eq("family_id", familyId),
    supabase.from("question_threads").select("id,status,awaiting_turn_id,question_messages!question_messages_thread_id_fkey(id,role,content,created_at)").eq("family_id", familyId).order("updated_at", { ascending: false }).limit(10),
    supabase.from("agent_conversations").select("id,title,student_id").eq("family_id", familyId).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
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
  if (insightsResult.error) throw insightsResult.error;
  if (autonomyResult.error) throw autonomyResult.error;
  if (layoutsResult.error) throw layoutsResult.error;
  if (questionsResult.error) throw questionsResult.error;
  if (latestConversationResult.error) throw latestConversationResult.error;
  const latestConversationTurnResult = latestConversationResult.data
    ? await supabase.from("agent_turns").select("id,status,goal,student_id,task_name,subject,source_count,normalized_step,expected_output,created_at,started_at,last_heartbeat_at,last_progress_at,snapshot_summary,public_result,conversation_id,interaction_mode,streamed_message,agent_events(sequence,kind,payload),agent_tool_calls(result_summary)").eq("family_id", familyId).eq("conversation_id", latestConversationResult.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null };
  if (latestConversationTurnResult.error) throw latestConversationTurnResult.error;
  const latestConversationMessagesResult = latestConversationResult.data
    ? await supabase.from("agent_conversation_messages").select("id,role,content,agent_turn_id,created_at").eq("family_id", familyId).eq("conversation_id", latestConversationResult.data.id).order("created_at", { ascending: false }).limit(80)
    : { data: [], error: null };
  if (latestConversationMessagesResult.error) throw latestConversationMessagesResult.error;
  const latestAgentTurn = latestTurnResult.data && ["queued", "running", "awaiting_parent", "failed"].includes(latestTurnResult.data.status)
    ? latestTurnResult.data
    : latestConversationTurnResult.data ?? latestTurnResult.data;

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
      schedulePreferences: student.schedule_preferences,
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
    insights: insightsResult.data.map((item): KlioInsightDTO => ({ id: item.id, studentId: item.student_id, kind: item.kind, title: item.title, summary: item.summary, reason: item.reason, priority: item.priority, evidenceRefs: Array.isArray(item.evidence_refs) ? item.evidence_refs : [], actionRef: item.action_ref && typeof item.action_ref === "object" && !Array.isArray(item.action_ref) ? item.action_ref as Record<string, unknown> : {}, createdAt: item.created_at })),
    autonomy: { preset: autonomyResult.data?.preset ?? "proactive", policies: autonomyResult.data?.policies ?? {} },
    workspaceLayouts: layoutsResult.data.map((layout): WorkspaceLayoutDTO => ({
      surface: layout.surface as "day" | "week",
      scopeKey: layout.scope_key,
      layoutVersion: layout.layout_version,
      positions: parseWorkspacePositions(layout.positions),
    })),
    latestAgentConversation: latestConversationResult.data ? ({
      id: latestConversationResult.data.id,
      title: latestConversationResult.data.title,
      studentId: latestConversationResult.data.student_id,
      messages: [...latestConversationMessagesResult.data].reverse().map((message) => ({ id: message.id, role: message.role as "user" | "assistant", content: message.content, turnId: message.agent_turn_id, createdAt: message.created_at })),
    } satisfies AgentConversationDTO) : null,
    latestAgentTurn: latestAgentTurn ? ({
      id: latestAgentTurn.id,
      status: latestAgentTurn.status,
      goal: latestAgentTurn.goal,
      request: ((latestAgentTurn.snapshot_summary as { request?: string | null } | null)?.request ?? `Complete a ${latestAgentTurn.goal.replaceAll("_", " ")} job.`),
      result: latestAgentTurn.public_result ? normalizePublicResult(latestAgentTurn.public_result) : null,
      clarification: clarificationForTurn(questionsResult.data, latestAgentTurn.id),
      events: [...latestAgentTurn.agent_events].sort((a, b) => a.sequence - b.sequence).map((event) => ({ sequence: event.sequence, kind: event.kind, label: agentEventLabel(event.kind, event.payload) })),
      tools: latestAgentTurn.agent_tool_calls.map((tool) => ({ result: tool.result_summary })),
      taskName: latestAgentTurn.task_name ?? "Handling a family handoff",
      studentId: latestAgentTurn.student_id,
      subject: latestAgentTurn.subject,
      sourceCount: latestAgentTurn.source_count,
      normalizedStep: latestAgentTurn.normalized_step,
      expectedOutput: latestAgentTurn.expected_output,
      createdAt: latestAgentTurn.created_at,
      startedAt: latestAgentTurn.started_at,
      lastHeartbeatAt: latestAgentTurn.last_heartbeat_at,
      lastProgressAt: latestAgentTurn.last_progress_at,
      conversationId: latestAgentTurn.conversation_id,
      interactionMode: latestAgentTurn.interaction_mode as "answer" | "act",
      streamedMessage: latestAgentTurn.streamed_message,
    } satisfies AgentTurnDTO) : null,
  };
});

function parseWorkspacePositions(value: unknown): Record<string, { x: number; y: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, { x: number; y: number }] => {
    const position = entry[1];
    return Boolean(position && typeof position === "object" && !Array.isArray(position) && "x" in position && "y" in position
      && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y)));
  }).map(([id, position]) => [id, { x: Number(position.x), y: Number(position.y) }]));
}

function clarificationForTurn(threads: Array<{ id: string; status: string; awaiting_turn_id: string | null; question_messages: Array<{ id: string; role: string; content: string; created_at: string }> }>, turnId: string) {
  const thread = threads.find((item) => item.awaiting_turn_id === turnId);
  if (!thread) return null;
  const message = [...thread.question_messages].filter((item) => item.role === "assistant").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return message ? { threadId: thread.id, messageId: message.id, question: message.content, status: thread.status } : null;
}
