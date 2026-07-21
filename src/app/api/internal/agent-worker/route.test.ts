import { afterEach, describe, expect, it, vi } from "vitest";

const { runAgentWorkerBatch } = vi.hoisted(() => ({ runAgentWorkerBatch: vi.fn() }));
vi.mock("@/lib/worker/agent-worker", () => ({ runAgentWorkerBatch }));

import { GET } from "./route";

describe("GET /api/internal/agent-worker", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    runAgentWorkerBatch.mockReset();
  });

  it("rejects requests without the cron secret", async () => {
    process.env.CRON_SECRET = "test-cron-secret";

    const response = await GET(new Request("http://localhost/api/internal/agent-worker"));

    expect(response.status).toBe(401);
    expect(runAgentWorkerBatch).not.toHaveBeenCalled();
  });

  it("runs one bounded batch for an authorized invocation", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    runAgentWorkerBatch.mockResolvedValue({ queuedTurns: 1, completedTurns: 1, failedTurns: 0 });

    const response = await GET(new Request("http://localhost/api/internal/agent-worker", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, queuedTurns: 1, completedTurns: 1 });
    expect(runAgentWorkerBatch).toHaveBeenCalledOnce();
  });

  it("does not expose worker failures", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    runAgentWorkerBatch.mockRejectedValue(new Error("sensitive provider detail"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request("http://localhost/api/internal/agent-worker", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Worker invocation failed" });
    consoleError.mockRestore();
  });
});
