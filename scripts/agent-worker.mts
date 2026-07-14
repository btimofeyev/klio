import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { processWorkspaceTurn } = await import("../src/lib/agent/workspace/runtime");

  while (!stopping) {
    const admin = createAdminClient();
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    await admin.from("agent_turns").update({ status: "queued", error_code: "RECOVERED_STALE_TURN" }).eq("status", "running").lt("last_heartbeat_at", staleBefore).lt("attempt_count", 3);
    const { data: turns, error } = await admin.from("agent_turns").select("id").eq("status", "queued").order("created_at").limit(10);
    if (error) throw error;
    if (!turns.length) { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
    for (const turn of turns) {
      if (stopping) break;
      try { await processWorkspaceTurn(turn.id); }
      catch (error) { process.stderr.write(`Klio agent turn ${turn.id} failed: ${error instanceof Error ? error.message : "unknown"}\n`); }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`Klio agent worker stopped: ${error instanceof Error ? error.stack ?? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
