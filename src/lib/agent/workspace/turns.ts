import "server-only";

import { createHash } from "node:crypto";
import { issueWorkspaceCapability } from "./capability";
import { workspaceToolNames, type WorkspaceToolName } from "./contracts";
import { buildFamilyWorkspaceSnapshot } from "./snapshot";
import { buildHostPublicResult } from "./public-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import type { Json } from "@/lib/supabase/database.types";

export type WorkspaceGoal = "capture" | "dashboard" | "lesson" | "practice" | "weekly_plan" | "portfolio" | "records" | "general";
export type InteractionMode = "answer" | "act";
export type WorkspaceAuthorization = "schedule_moves";

export async function enqueueWorkspaceTurn(input: {
  familyId: string; requestedBy: string; evidenceIds?: string[]; studentId?: string | null;
  trigger: "capture" | "parent_message" | "clarification_answer" | "scheduled" | "retry" | "proactive_event";
  goal: WorkspaceGoal; idempotencyKey: string; request?: string | null; contextDate?: string | null;
  taskName?: string | null; subject?: string | null; expectedOutput?: string | null;
  conversationId?: string | null; interactionMode?: InteractionMode;
  authorizations?: WorkspaceAuthorization[];
}) {
  const admin = createAdminClient();
  const [snapshotIdentity, thread] = await Promise.all([
    readSnapshotIdentity(admin, input.familyId),
    ensureWorkspaceThread(admin, input.familyId, input.conversationId),
  ]);
  const evidenceIds = [...new Set(input.evidenceIds ?? [])];
  const createdTurn = await admin.from("agent_turns").insert({
    thread_id: thread.id, family_id: input.familyId, requested_by: input.requestedBy,
    source_evidence_id: evidenceIds[0] ?? null, trigger: input.trigger, goal: input.goal,
    idempotency_key: input.idempotencyKey, initial_snapshot_version: snapshotIdentity.version,
    current_snapshot_version: snapshotIdentity.version, snapshot_hash: snapshotIdentity.hash,
    student_id: input.studentId ?? null, task_name: input.taskName?.trim().slice(0, 200) || taskNameForGoal(input.goal),
    subject: input.subject?.trim().slice(0, 80) || null, source_count: evidenceIds.length,
    normalized_step: "waiting", expected_output: input.expectedOutput?.trim().slice(0, 300) || expectedOutputForGoal(input.goal),
    last_progress_at: new Date().toISOString(),
    conversation_id: input.conversationId ?? null, interaction_mode: input.interactionMode ?? "act",
    snapshot_summary: { evidence_ids: evidenceIds, student_id: input.studentId ?? null, request: input.request?.trim().slice(0, 4000) || null, context_date: input.contextDate ?? null, authorizations: [...new Set(input.authorizations ?? [])] },
  }).select("id, thread_id, family_id, status, initial_snapshot_version, snapshot_hash").single();
  if (createdTurn.error) {
    if (createdTurn.error.code === "23505") {
      const existing = await admin.from("agent_turns").select("id, thread_id, family_id, status, initial_snapshot_version, snapshot_hash").eq("family_id", input.familyId).eq("idempotency_key", input.idempotencyKey).single();
      if (existing.error) throw existing.error;
      return { turn: existing.data, duplicate: true };
    }
    throw createdTurn.error;
  }
  await admin.from("agent_events").insert({ family_id: input.familyId, turn_id: createdTurn.data.id, sequence: 1, kind: "turn.queued", payload: { goal: input.goal } });
  if (evidenceIds.length) await admin.from("evidence_items").update({ processing_status: "queued", error_message: null }).eq("family_id", input.familyId).in("id", evidenceIds).neq("processing_status", "ready");
  return { turn: createdTurn.data, duplicate: false };
}

export async function completeInstantWorkspaceTurn(input: {
  familyId: string;
  requestedBy: string;
  studentId?: string | null;
  idempotencyKey: string;
  request: string;
  message: string;
  conversationId: string;
}) {
  const admin = createAdminClient();
  const [snapshotIdentity, thread] = await Promise.all([
    readSnapshotIdentity(admin, input.familyId, "instant_conversation"),
    ensureWorkspaceThread(admin, input.familyId, input.conversationId),
  ]);
  const now = new Date().toISOString();
  const publicResult = buildHostPublicResult({
    terminal: { kind: "completed", message: input.message, understood: [], used: [], changed: [], remaining: [] },
    toolResults: [],
    waitingForClarification: false,
  });
  const createdTurn = await admin.from("agent_turns").insert({
    thread_id: thread.id,
    family_id: input.familyId,
    requested_by: input.requestedBy,
    trigger: "parent_message",
    goal: "general",
    status: "completed",
    outcome: "none",
    idempotency_key: input.idempotencyKey,
    initial_snapshot_version: snapshotIdentity.version,
    current_snapshot_version: snapshotIdentity.version,
    snapshot_hash: snapshotIdentity.hash,
    snapshot_summary: { evidence_ids: [], student_id: input.studentId ?? null, request: input.request, context_date: null },
    attempt_count: 1,
    started_at: now,
    completed_at: now,
    last_heartbeat_at: now,
    last_progress_at: now,
    public_result: publicResult as Json,
    streamed_message: input.message,
    normalized_step: "finished",
    task_name: "Answering your message",
    expected_output: "A clear answer",
    student_id: input.studentId ?? null,
    conversation_id: input.conversationId,
    interaction_mode: "answer",
  }).select("id, thread_id, family_id, status, initial_snapshot_version, snapshot_hash, started_at, completed_at").single();
  if (createdTurn.error) {
    if (createdTurn.error.code === "23505") {
      const existing = await admin.from("agent_turns").select("id, thread_id, family_id, status, initial_snapshot_version, snapshot_hash, started_at, completed_at").eq("family_id", input.familyId).eq("idempotency_key", input.idempotencyKey).single();
      if (existing.error) throw existing.error;
      return { turn: existing.data, duplicate: true, publicResult };
    }
    throw createdTurn.error;
  }
  const events = await admin.from("agent_events").insert([
    { family_id: input.familyId, turn_id: createdTurn.data.id, sequence: 1, kind: "turn.queued", payload: { goal: "general", instant: true } },
    { family_id: input.familyId, turn_id: createdTurn.data.id, sequence: 2, kind: "turn.started", payload: { instant: true } },
    { family_id: input.familyId, turn_id: createdTurn.data.id, sequence: 3, kind: "turn.completed", payload: { message: input.message, instant: true } },
  ]);
  if (events.error) throw events.error;
  const updatedThread = await admin.from("agent_threads").update({
    last_turn_at: now,
    turn_count: thread.turn_count + 1,
  }).eq("id", thread.id);
  if (updatedThread.error) throw updatedThread.error;
  return { turn: createdTurn.data, duplicate: false, publicResult };
}

export async function claimWorkspaceTurn(turnId: string) {
  const admin = createAdminClient();
  const { data: queued, error } = await admin.from("agent_turns").select("id, thread_id, family_id, requested_by, status, goal, snapshot_summary, attempt_count, conversation_id, interaction_mode").eq("id", turnId).single();
  if (error) throw error;
  if (queued.status !== "queued") return null;
  const leaseToken = crypto.randomUUID();
  const lease = await admin.rpc("acquire_family_execution_lease", { p_family_id: queued.family_id, p_owner_token: leaseToken, p_work_kind: "workspace_turn", p_work_id: queued.id, p_ttl_seconds: 120 });
  if (lease.error) throw lease.error;
  if (!lease.data) return null;
  const summary = queued.snapshot_summary as { evidence_ids?: string[]; student_id?: string | null; request?: string | null; context_date?: string | null };
  let preflight: Awaited<ReturnType<typeof buildFamilyWorkspaceSnapshot>>;
  try { preflight = await buildStableSnapshot({ familyId: queued.family_id, evidenceIds: summary.evidence_ids, studentId: summary.student_id, familyWide: Boolean(queued.conversation_id) }); }
  catch (error) {
    await admin.rpc("release_family_execution_lease", { p_family_id: queued.family_id, p_owner_token: leaseToken });
    throw error;
  }
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin.from("agent_turns").update({
    status: "running", initial_snapshot_version: preflight.version, current_snapshot_version: preflight.version,
    snapshot_hash: preflight.hash, started_at: now, last_heartbeat_at: now, attempt_count: Math.min(queued.attempt_count + 1, 10),
    normalized_step: "reading", last_progress_at: now, error_code: null,
  }).eq("id", turnId).eq("status", "queued").select("id, thread_id, family_id, requested_by, goal, initial_snapshot_version, attempt_count, conversation_id, interaction_mode").maybeSingle();
  if (claimError) {
    await admin.rpc("release_family_execution_lease", { p_family_id: queued.family_id, p_owner_token: leaseToken });
    throw claimError;
  }
  if (!claimed || !claimed.requested_by) {
    await admin.rpc("release_family_execution_lease", { p_family_id: queued.family_id, p_owner_token: leaseToken });
    return null;
  }
  const startedSequence = await nextEventSequence(admin, claimed.id);
  await admin.from("agent_events").insert({ family_id: claimed.family_id, turn_id: claimed.id, sequence: startedSequence, kind: "turn.started", payload: {} });
  const request = summary.request ?? defaultRequest(claimed.goal);
  const allowedTools = toolsForWorkspaceRequest(claimed.goal as WorkspaceGoal, request, claimed.interaction_mode as InteractionMode);
  const issuedAt = Date.now();
  const capability = issueWorkspaceCapability({
    familyId: claimed.family_id, requestedBy: claimed.requested_by, klioTurnId: claimed.id,
    snapshotVersion: claimed.initial_snapshot_version, allowedTools,
    issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(issuedAt + 15 * 60_000).toISOString(), nonce: crypto.randomUUID().replaceAll("-", ""),
  }, serverEnv.klioAgentCapabilitySecret);
  return { turn: claimed, request, contextDate: summary.context_date ?? null, studentId: summary.student_id ?? null, snapshot: preflight.snapshot, serializedSnapshot: preflight.serialized, capability, allowedTools, leaseToken, nextSequence: startedSequence + 1 };
}

const readOnlyTools: WorkspaceToolName[] = ["read_capture", "read_family_context", "read_goals_and_pacing", "read_review_queue", "read_assignment_review_context", "read_relevant_history"];
const alwaysRead: WorkspaceToolName[] = ["read_family_context", "read_goals_and_pacing", "present_action_card", "ask_parent"];

export function toolsForWorkspaceGoal(goal: WorkspaceGoal): WorkspaceToolName[] {
  const tools: Record<WorkspaceGoal, WorkspaceToolName[]> = {
    capture: ["read_capture", "file_capture", "create_reminder", "record_explicit_completion", ...alwaysRead],
    dashboard: ["build_dashboard", "update_subject_summary_draft", "read_relevant_history", "read_review_queue", ...alwaysRead],
    lesson: ["create_targeted_lesson", "create_lesson", "read_assignment_review_context", "read_relevant_history", ...alwaysRead],
    practice: ["create_supplemental_practice", "create_practice_activity", "remove_supplemental_practice", "read_assignment_review_context", "read_relevant_history", ...alwaysRead],
    weekly_plan: ["create_assignment", "create_schedule_block", "move_schedule_work", "resize_schedule_work", "move_unfinished_work", "organize_day_schedule", "prepare_planning_changes", "draft_weekly_plan", ...alwaysRead],
    portfolio: ["build_portfolio", "read_relevant_history", ...alwaysRead],
    records: ["update_records_draft", "record_explicit_parent_score", "record_explicit_completion", "update_assignment_status", "read_review_queue", "read_assignment_review_context", ...alwaysRead],
    general: [...workspaceToolNames],
  };
  return [...new Set(tools[goal])];
}

export function isDayOrganizationRequest(request: string) {
  return /\b(?:organiz\w*|fix\s+(?:the\s+)?overlap\w*|remove\s+(?:the\s+)?overlap\w*|non[- ]overlapping\s+schedule|timed\s+(?:plan|schedule))\b/i.test(request);
}

export function isWeeklyBriefingHandoffRequest(request: string) {
  return /\bremaining items? in .{0,80}weekly briefing\b/i.test(request) && /\bwork in the background\b/i.test(request);
}

export function authorizationsForWorkspaceRequest(request: string, interactionMode: InteractionMode): WorkspaceAuthorization[] {
  if (interactionMode !== "act") return [];
  if (/^\s*(?:why|when)\b/i.test(request)) return [];
  const explicitScheduleAction = isDayOrganizationRequest(request)
    || /\b(?:move|reschedul\w*|shift|rebalance|lighten|reorganiz\w*)\b.{0,100}\b(?:assignment|lesson|work|schedule|day|week)\b/i.test(request)
    || /\b(?:assignment|lesson|work|schedule|day|week)\b.{0,100}\b(?:move|reschedul\w*|shift|rebalanc\w*|lighten|reorganiz\w*)\b/i.test(request);
  return explicitScheduleAction || isActionConfirmationRequest(request) ? ["schedule_moves"] : [];
}

export function toolsForWorkspaceRequest(goal: WorkspaceGoal, request: string, interactionMode: InteractionMode = "act"): WorkspaceToolName[] {
  if (interactionMode === "answer") return readOnlyTools;
  if (goal === "weekly_plan" && isDayOrganizationRequest(request)) {
    return ["organize_day_schedule", "read_family_context", "present_action_card", "ask_parent"];
  }
  if (goal === "weekly_plan" && isWeeklyBriefingHandoffRequest(request)) {
    return ["move_unfinished_work", "organize_day_schedule", "prepare_planning_changes", ...alwaysRead];
  }
  if (goal !== "general") return toolsForWorkspaceGoal(goal);
  // General conversation is adaptive. Klio decides whether the message needs
  // only a natural reply, a workspace read, or bounded follow-through. The
  // capability and tool gateway remain the authority boundary for every tool.
  return toolsForWorkspaceGoal("general");
}

export function interactionModeForRequest(input: { goal: WorkspaceGoal; request: string; assignmentGuidance?: boolean }): InteractionMode {
  // General messages deliberately use the adaptive execution lane. The model
  // may answer without a tool; if it chooses a tool, the gateway applies family
  // scope, policy, idempotency, snapshot, and approval checks.
  void input.request;
  void input.assignmentGuidance;
  return "act";
}

export function isActionConfirmationRequest(request: string) {
  return /^(?:(?:yes|yep|yeah|okay|ok|sure)[,.!]?\s+)?(?:go\s+ahead|do\s+it|get\s+it\s+done|make\s+(?:it|that)\s+happen|apply\s+(?:it|that|those\s+changes)|proceed|sounds\s+good[,.!]?\s+(?:do\s+it|go\s+ahead))\s*[.!]?$/i.test(request.trim());
}

export async function recoverInterruptedWorkspaceTurns(now = new Date()) {
  const admin = createAdminClient();
  const staleBefore = new Date(now.getTime() - 90_000).toISOString();
  const recovered = await admin.from("agent_turns").update({ status: "queued", normalized_step: "waiting", error_code: "RECOVERED_STALE_TURN", last_progress_at: now.toISOString() })
    .eq("status", "running").lt("last_heartbeat_at", staleBefore).lt("attempt_count", 3).select("id");
  if (recovered.error) throw recovered.error;
  const failed = await admin.from("agent_turns").update({ status: "failed", completed_at: now.toISOString(), normalized_step: "failed", error_code: "RETRY_LIMIT_REACHED", last_progress_at: now.toISOString() })
    .in("status", ["queued", "running"]).gte("attempt_count", 3).select("id");
  if (failed.error) throw failed.error;
  return { recovered: recovered.data.length, failed: failed.data.length };
}

async function nextEventSequence(admin: ReturnType<typeof createAdminClient>, turnId: string) {
  const { data, error } = await admin.from("agent_events").select("sequence").eq("turn_id", turnId).order("sequence", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data?.sequence ?? 0) + 1;
}

function defaultRequest(goal: string) {
  if (goal === "capture") return "Organize the new capture into one grounded family-workspace outcome.";
  return `Complete the requested ${goal.replaceAll("_", " ")} job for this family.`;
}

function taskNameForGoal(goal: WorkspaceGoal) { return ({ capture: "Organizing submitted work", dashboard: "Reviewing recent learning", lesson: "Preparing a lesson", practice: "Creating focused practice", weekly_plan: "Planning the week", portfolio: "Preparing family records", records: "Updating learning records", general: "Handling a family handoff" } as const)[goal]; }
function expectedOutputForGoal(goal: WorkspaceGoal) { return ({ capture: "Filed work or one precise question", dashboard: "A concise learning summary", lesson: "A lesson ready to review", practice: "Focused practice grounded in recent work", weekly_plan: "A capacity-aware week", portfolio: "Prepared family records", records: "A reviewable records update", general: "One concise receipt of what changed" } as const)[goal]; }

async function buildStableSnapshot(input: Parameters<typeof buildFamilyWorkspaceSnapshot>[0]) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await buildFamilyWorkspaceSnapshot(input); }
    catch (error) { if (!(error instanceof Error) || error.message !== "SNAPSHOT_CHANGED_DURING_BUILD") throw error; lastError = error; }
  }
  throw lastError ?? new Error("SNAPSHOT_UNSTABLE");
}

async function readSnapshotIdentity(admin: ReturnType<typeof createAdminClient>, familyId: string, purpose = "queued_workspace_turn") {
  const family = await admin.from("families").select("agent_context_version").eq("id", familyId).single();
  if (family.error) throw family.error;
  const version = family.data.agent_context_version;
  // Queuing needs only a durable version marker. claimWorkspaceTurn replaces
  // this marker with the hash of the one authoritative snapshot it builds.
  const hash = createHash("sha256").update(JSON.stringify({ familyId, version, purpose })).digest("hex");
  return { version, hash };
}

async function ensureWorkspaceThread(admin: ReturnType<typeof createAdminClient>, familyId: string, conversationId?: string | null) {
  let threadQuery = admin.from("agent_threads").select("id,status,turn_count").eq("family_id", familyId).eq("agent_kind", "family_workspace").in("status", ["active", "awaiting_parent", "replacing"]);
  threadQuery = conversationId ? threadQuery.eq("conversation_id", conversationId) : threadQuery.is("conversation_id", null);
  const threadLookup = await threadQuery.maybeSingle();
  if (threadLookup.error) throw threadLookup.error;
  if (threadLookup.data) return threadLookup.data;
  const created = await admin.from("agent_threads").insert({ family_id: familyId, provider: "codex_app_server", status: "active", conversation_id: conversationId ?? null }).select("id,status,turn_count").single();
  if (!created.error) return created.data;
  let existingQuery = admin.from("agent_threads").select("id,status,turn_count").eq("family_id", familyId).eq("agent_kind", "family_workspace").in("status", ["active", "awaiting_parent", "replacing"]);
  existingQuery = conversationId ? existingQuery.eq("conversation_id", conversationId) : existingQuery.is("conversation_id", null);
  const existing = await existingQuery.single();
  if (existing.error) throw created.error;
  return existing.data;
}
