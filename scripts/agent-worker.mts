import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

let stopping = false;
let lastScheduledSweep = 0;
let consecutiveInfrastructureFailures = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  const { runAgentWorkerBatch } = await import("../src/lib/worker/agent-worker");

  while (!stopping) {
    try {
      const includeScheduledSweep = Date.now() - lastScheduledSweep >= 60_000;
      const result = await runAgentWorkerBatch({ includeScheduledSweep });
      if (includeScheduledSweep) lastScheduledSweep = Date.now();
      consecutiveInfrastructureFailures = 0;
      if (!result.queuedTurns) await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      consecutiveInfrastructureFailures += 1;
      process.stderr.write(`Klio agent worker retry ${consecutiveInfrastructureFailures}/5: ${errorText(error)}\n`);
      if (consecutiveInfrastructureFailures >= 5) throw new Error(`Repeated worker infrastructure failure: ${errorText(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
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
