import { timingSafeEqual } from "node:crypto";
import { runAgentWorkerBatch } from "@/lib/worker/agent-worker";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function GET(request: Request) {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await runAgentWorkerBatch();
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("klio_agent_worker_failed", error);
    return Response.json({ error: "Worker invocation failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

function isAuthorized(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
