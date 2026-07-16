import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

let stopping = false;
let lastScheduledSweep = 0;
let consecutiveInfrastructureFailures = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { processWorkspaceTurn } = await import("../src/lib/agent/workspace/runtime");
  const { enqueueScheduledFamilyEvaluations, processQueuedProactiveEvaluations } = await import("../src/lib/proactive/evaluate");
  const { recoverInterruptedWorkspaceTurns } = await import("../src/lib/agent/workspace/turns");
  const { fairFamilyQueue, runBounded } = await import("../src/lib/worker/concurrency");
  const concurrency = workerConcurrency(process.env.KLIO_WORKER_CONCURRENCY);

  while (!stopping) {
    try {
      const admin = createAdminClient();
      await recoverInterruptedWorkspaceTurns();
      if (Date.now() - lastScheduledSweep >= 60_000) { await enqueueScheduledFamilyEvaluations(); lastScheduledSweep = Date.now(); }
      await processQueuedProactiveEvaluations(8, concurrency);
      const { data: turns, error } = await admin.from("agent_turns").select("id,family_id").eq("status", "queued").order("created_at").limit(100);
      if (error) throw error;
      consecutiveInfrastructureFailures = 0;
      if (!turns.length) { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
      await runBounded(fairFamilyQueue(turns, 20), concurrency, async (turn: { id: string }) => {
        if (stopping) return;
        try { await processWorkspaceTurn(turn.id); }
        catch (error) {
          // A family or turn can be intentionally deleted while provider work is in flight.
          // There is no receipt left to retry, and treating that cleanup as a worker failure is misleading.
          if (!isDeletedWorkError(error)) process.stderr.write(`Klio agent turn ${turn.id} failed: ${errorText(error)}\n`);
        }
      });
    } catch (error) {
      consecutiveInfrastructureFailures += 1;
      process.stderr.write(`Klio agent worker retry ${consecutiveInfrastructureFailures}/5: ${errorText(error)}\n`);
      if (consecutiveInfrastructureFailures >= 5) throw new Error(`Repeated worker infrastructure failure: ${errorText(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

function workerConcurrency(value: string | undefined) {
  const parsed = Number(value ?? 4);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 4;
}

main().catch((error) => {
  process.stderr.write(`Klio agent worker stopped: ${errorText(error)}\n`);
  process.exitCode = 1;
});

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
