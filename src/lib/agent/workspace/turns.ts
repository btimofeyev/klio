import "server-only";

import { issueWorkspaceCapability } from "./capability";
import { workspaceToolNames } from "./contracts";
import { buildFamilyWorkspaceSnapshot } from "./snapshot";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export type WorkspaceGoal = "capture" | "dashboard" | "lesson" | "practice" | "weekly_plan" | "portfolio" | "records" | "general";

export async function enqueueWorkspaceTurn(input: {
  familyId: string; requestedBy: string; evidenceIds?: string[]; studentId?: string | null;
  trigger: "capture" | "parent_message" | "clarification_answer" | "scheduled" | "retry";
  goal: WorkspaceGoal; idempotencyKey: string; request?: string | null;
}) {
  const admin = createAdminClient();
  const preflight = await buildStableSnapshot({ familyId: input.familyId, evidenceIds: input.evidenceIds, studentId: input.studentId });
  const threadLookup = await admin.from("agent_threads").select("id").eq("family_id", input.familyId).eq("agent_kind", "family_workspace").in("status", ["active", "awaiting_parent", "replacing"]).maybeSingle();
  let thread = threadLookup.data;
  const threadError = threadLookup.error;
  if (threadError) throw threadError;
  if (!thread) {
    const created = await admin.from("agent_threads").insert({ family_id: input.familyId, provider: "codex_app_server", status: "active" }).select("id").single();
    if (created.error) {
      const existing = await admin.from("agent_threads").select("id").eq("family_id", input.familyId).eq("agent_kind", "family_workspace").in("status", ["active", "awaiting_parent", "replacing"]).single();
      if (existing.error) throw created.error;
      thread = existing.data;
    } else thread = created.data;
  }
  const evidenceIds = [...new Set(input.evidenceIds ?? [])];
  const createdTurn = await admin.from("agent_turns").insert({
    thread_id: thread.id, family_id: input.familyId, requested_by: input.requestedBy,
    source_evidence_id: evidenceIds[0] ?? null, trigger: input.trigger, goal: input.goal,
    idempotency_key: input.idempotencyKey, initial_snapshot_version: preflight.version,
    current_snapshot_version: preflight.version, snapshot_hash: preflight.hash,
    snapshot_summary: { evidence_ids: evidenceIds, student_id: input.studentId ?? null, request: input.request?.trim().slice(0, 4000) || null },
  }).select("id, thread_id, family_id, status, initial_snapshot_version, snapshot_hash").single();
  if (createdTurn.error) {
    if (createdTurn.error.code === "23505") {
      const existing = await admin.from("agent_turns").select("id, thread_id, family_id, status, initial_snapshot_version, snapshot_hash").eq("family_id", input.familyId).eq("idempotency_key", input.idempotencyKey).single();
      if (existing.error) throw existing.error;
      return { turn: existing.data, snapshot: preflight.snapshot, duplicate: true };
    }
    throw createdTurn.error;
  }
  await admin.from("agent_events").insert({ family_id: input.familyId, turn_id: createdTurn.data.id, sequence: 1, kind: "turn.queued", payload: { goal: input.goal } });
  if (evidenceIds.length) await admin.from("evidence_items").update({ processing_status: "queued", error_message: null }).eq("family_id", input.familyId).in("id", evidenceIds);
  return { turn: createdTurn.data, snapshot: preflight.snapshot, duplicate: false };
}

export async function claimWorkspaceTurn(turnId: string) {
  const admin = createAdminClient();
  const { data: queued, error } = await admin.from("agent_turns").select("id, thread_id, family_id, requested_by, status, goal, snapshot_summary, attempt_count").eq("id", turnId).single();
  if (error) throw error;
  if (queued.status !== "queued") return null;
  const summary = queued.snapshot_summary as { evidence_ids?: string[]; student_id?: string | null; request?: string | null };
  const preflight = await buildStableSnapshot({ familyId: queued.family_id, evidenceIds: summary.evidence_ids, studentId: summary.student_id });
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin.from("agent_turns").update({
    status: "running", initial_snapshot_version: preflight.version, current_snapshot_version: preflight.version,
    snapshot_hash: preflight.hash, started_at: now, last_heartbeat_at: now, attempt_count: Math.min(queued.attempt_count + 1, 10),
  }).eq("id", turnId).eq("status", "queued").select("id, thread_id, family_id, requested_by, goal, initial_snapshot_version").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed || !claimed.requested_by) return null;
  await admin.from("agent_events").insert({ family_id: claimed.family_id, turn_id: claimed.id, sequence: 2, kind: "turn.started", payload: {} });
  const issuedAt = Date.now();
  const capability = issueWorkspaceCapability({
    familyId: claimed.family_id, requestedBy: claimed.requested_by, klioTurnId: claimed.id,
    snapshotVersion: claimed.initial_snapshot_version, allowedTools: [...workspaceToolNames],
    issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(issuedAt + 15 * 60_000).toISOString(), nonce: crypto.randomUUID().replaceAll("-", ""),
  }, serverEnv.klioAgentCapabilitySecret);
  return { turn: claimed, request: summary.request ?? defaultRequest(claimed.goal), snapshot: preflight.snapshot, serializedSnapshot: preflight.serialized, capability };
}

function defaultRequest(goal: string) {
  if (goal === "capture") return "Organize the new capture into one grounded family-workspace outcome.";
  return `Complete the requested ${goal.replaceAll("_", " ")} job for this family.`;
}

async function buildStableSnapshot(input: Parameters<typeof buildFamilyWorkspaceSnapshot>[0]) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await buildFamilyWorkspaceSnapshot(input); }
    catch (error) { if (!(error instanceof Error) || error.message !== "SNAPSHOT_CHANGED_DURING_BUILD") throw error; lastError = error; }
  }
  throw lastError ?? new Error("SNAPSHOT_UNSTABLE");
}
