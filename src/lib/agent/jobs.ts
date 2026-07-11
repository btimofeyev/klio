import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { runKlioAgent, type AgentIntent } from "./run-agent";

const terminalStatuses = new Set(["completed", "partial", "failed"]);

export async function enqueueAgentJob(input: {
  familyId: string;
  parentId: string;
  studentId: string;
  evidenceIds: string[];
  intents: AgentIntent[];
}) {
  const admin = createAdminClient();
  const evidenceIds = [...new Set(input.evidenceIds)];
  const intents = [...new Set(input.intents)].slice(0, 20);
  if (!evidenceIds.length || !intents.length) throw new Error("JOB_INPUT_REQUIRED");

  const [{ data: student }, { data: evidence, error: evidenceError }] = await Promise.all([
    admin.from("students").select("id").eq("id", input.studentId).eq("family_id", input.familyId).maybeSingle(),
    admin.from("evidence_items").select("id").eq("family_id", input.familyId).in("id", evidenceIds),
  ]);
  if (!student || evidenceError || evidence?.length !== evidenceIds.length) throw new Error("JOB_EVIDENCE_NOT_FOUND");

  const { data: job, error: jobError } = await admin.from("agent_jobs").insert({
    family_id: input.familyId,
    requested_by: input.parentId,
    student_id: input.studentId,
    total_actions: intents.length,
  }).select("id, status, total_actions, completed_actions, failed_actions, created_at").single();
  if (jobError) throw jobError;

  const [actions, evidenceLinks] = await Promise.all([
    admin.from("agent_job_actions").insert(intents.map((intent) => ({ job_id: job.id, family_id: input.familyId, intent }))),
    admin.from("agent_job_evidence").insert(evidenceIds.map((evidenceId) => ({ job_id: job.id, evidence_id: evidenceId, family_id: input.familyId }))),
  ]);
  if (actions.error || evidenceLinks.error) {
    await admin.from("agent_jobs").delete().eq("id", job.id);
    throw actions.error ?? evidenceLinks.error;
  }

  await admin.from("evidence_items").update({ processing_status: "queued", error_message: null }).eq("family_id", input.familyId).in("id", evidenceIds);
  await writeAuditEvent(admin, {
    familyId: input.familyId,
    actorId: input.parentId,
    actorType: "parent",
    action: "agent.job_queued",
    entityType: "agent_job",
    entityId: job.id,
    metadata: { evidence_ids: evidenceIds, intents },
  });
  return job;
}

export async function processAgentJob(jobId: string) {
  const admin = createAdminClient();
  const { data: job, error } = await admin.from("agent_jobs")
    .select("id, family_id, requested_by, student_id, status, attempt_count, updated_at, last_heartbeat_at, agent_job_actions(id, intent, status, attempt_count), agent_job_evidence(evidence_id)")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!job || terminalStatuses.has(job.status)) return;

  const heartbeat = job.last_heartbeat_at ? new Date(job.last_heartbeat_at).getTime() : 0;
  if (job.status === "processing" && heartbeat > Date.now() - 5 * 60_000) return;

  const now = new Date().toISOString();
  const { data: claimed } = await admin.from("agent_jobs").update({
    status: "processing",
    started_at: job.status === "queued" ? now : undefined,
    last_heartbeat_at: now,
    attempt_count: Math.min(job.attempt_count + 1, 10),
    error_message: null,
  }).eq("id", job.id).eq("updated_at", job.updated_at).select("id").maybeSingle();
  if (!claimed) return;

  const evidenceIds = job.agent_job_evidence.map((link) => link.evidence_id);
  await admin.from("evidence_items").update({ processing_status: "processing", error_message: null }).eq("family_id", job.family_id).in("id", evidenceIds);

  for (const action of job.agent_job_actions) {
    if (action.status === "completed" || action.status === "failed") continue;
    const startedAt = new Date().toISOString();
    const { data: claimedAction } = await admin.from("agent_job_actions").update({
      status: "processing",
      started_at: startedAt,
      attempt_count: Math.min(action.attempt_count + 1, 10),
      error_message: null,
    }).eq("id", action.id).in("status", ["queued", "processing"]).select("id").maybeSingle();
    if (!claimedAction) continue;
    await admin.from("agent_jobs").update({ last_heartbeat_at: startedAt }).eq("id", job.id);

    try {
      const result = await runKlioAgent({
        familyId: job.family_id,
        parentId: job.requested_by,
        studentId: job.student_id,
        evidenceIds,
        intent: action.intent as AgentIntent,
        jobActionId: action.id,
      });
      await admin.from("agent_job_actions").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        artifact_id: result.artifactId,
        agent_run_id: result.runId,
      }).eq("id", action.id);
    } catch (actionError) {
      await admin.from("agent_job_actions").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: safeError(actionError),
      }).eq("id", action.id);
    }
  }

  const { data: finalActions, error: finalActionsError } = await admin.from("agent_job_actions").select("status").eq("job_id", job.id);
  if (finalActionsError) throw finalActionsError;
  const completed = finalActions.filter((action) => action.status === "completed").length;
  const failed = finalActions.filter((action) => action.status === "failed").length;
  const status = completed === finalActions.length ? "completed" : failed === finalActions.length ? "failed" : "partial";
  const completedAt = new Date().toISOString();
  await admin.from("agent_jobs").update({
    status,
    completed_actions: completed,
    failed_actions: failed,
    completed_at: completedAt,
    last_heartbeat_at: completedAt,
    error_message: status === "failed" ? "Klio could not complete the requested actions." : null,
  }).eq("id", job.id);
  await admin.from("evidence_items").update({
    processing_status: status === "failed" ? "failed" : "ready",
    error_message: status === "failed" ? "Klio could not process this record." : null,
  }).eq("family_id", job.family_id).in("id", evidenceIds);
  try {
    await writeAuditEvent(admin, {
      familyId: job.family_id,
      actorType: "system",
      action: `agent.job_${status}`,
      entityType: "agent_job",
      entityId: job.id,
      metadata: { completed_actions: completed, failed_actions: failed },
    });
  } catch {
    // The family may have been removed while an in-flight job was finishing.
  }
}

export async function safelyProcessAgentJob(jobId: string) {
  try {
    await processAgentJob(jobId);
  } catch (error) {
    const admin = createAdminClient();
    await admin.from("agent_jobs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: safeError(error),
    }).eq("id", jobId).in("status", ["queued", "processing"]);
  }
}

export async function recoverAgentJobs(familyId: string, limit = 2) {
  const admin = createAdminClient();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: jobs, error } = await admin.from("agent_jobs").select("id")
    .eq("family_id", familyId)
    .or(`status.eq.queued,and(status.eq.processing,last_heartbeat_at.lt.${staleBefore})`)
    .order("created_at")
    .limit(limit);
  if (error) throw error;
  for (const job of jobs) await safelyProcessAgentJob(job.id);
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "Agent action failed";
  if (error.message === "OPENAI_KEY_INVALID") return "OpenAI rejected the configured API key";
  if (error.message === "OPENAI_KEY_REQUIRED") return "OpenAI is not configured";
  return error.message.slice(0, 300);
}
