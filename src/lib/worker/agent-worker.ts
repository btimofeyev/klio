import "server-only";

import { recoverInterruptedWorkspaceTurns } from "@/lib/agent/workspace/turns";
import { enqueueScheduledFamilyEvaluations, processQueuedProactiveEvaluations } from "@/lib/proactive/evaluate";
import { createAdminClient } from "@/lib/supabase/admin";
import { fairFamilyQueue, runBounded } from "@/lib/worker/concurrency";

export type AgentWorkerBatchOptions = {
  concurrency?: number;
  includeScheduledSweep?: boolean;
  turnLimit?: number;
};

export async function runAgentWorkerBatch(options: AgentWorkerBatchOptions = {}) {
  // Keep the Codex SDK behind a native dynamic import. The standalone tsx
  // worker otherwise lowers this ESM-only dependency to CommonJS.
  const { processWorkspaceTurn } = await import("@/lib/agent/workspace/runtime");
  const concurrency = boundedInteger(options.concurrency ?? configuredInteger("KLIO_WORKER_CONCURRENCY", 1), 1, 8);
  const turnLimit = boundedInteger(options.turnLimit ?? configuredInteger("KLIO_WORKER_BATCH_SIZE", 4), 1, 20);
  const admin = createAdminClient();
  const recovery = await recoverInterruptedWorkspaceTurns();
  const scheduledEvaluations = options.includeScheduledSweep === false ? 0 : await enqueueScheduledFamilyEvaluations();

  await processQueuedProactiveEvaluations(8, concurrency);

  const queued = await admin
    .from("agent_turns")
    .select("id,family_id")
    .eq("status", "queued")
    .order("created_at")
    .limit(Math.max(turnLimit * 5, 20));
  if (queued.error) throw queued.error;

  const turns = fairFamilyQueue(queued.data, turnLimit);
  let completedTurns = 0;
  let failedTurns = 0;
  await runBounded(turns, concurrency, async (turn) => {
    try {
      await processWorkspaceTurn(turn.id);
      completedTurns += 1;
    } catch (error) {
      if (!isDeletedWorkError(error)) {
        failedTurns += 1;
        console.error("klio_agent_turn_failed", { turnId: turn.id, error: errorText(error) });
      }
    }
  });

  return {
    queuedTurns: turns.length,
    completedTurns,
    failedTurns,
    recoveredTurns: recovery.recovered,
    terminalTurns: recovery.failed,
    scheduledEvaluations,
  };
}

export function workerConcurrency(value: string | undefined) {
  return boundedInteger(Number(value ?? 1), 1, 8);
}

function configuredInteger(name: string, fallback: number) {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function boundedInteger(value: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : minimum;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.stack ?? error.message;
  if (error && typeof error === "object") {
    try { return JSON.stringify(error); } catch { return "unserializable worker error"; }
  }
  return String(error ?? "unknown");
}

function isDeletedWorkError(error: unknown) {
  return error instanceof Error && error.message === "AGENT_TURN_NOT_FOUND";
}
