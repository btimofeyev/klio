export type ReceiptState = "queued" | "running" | "paused" | "awaiting_parent" | "completed" | "failed" | "cancelled";

export function deriveReceiptState(input: { status: string; createdAt: string; lastHeartbeatAt: string | null; now: number; runningTimeoutMs?: number; queuedTimeoutMs?: number }): ReceiptState {
  if (input.status === "running") {
    const heartbeat = input.lastHeartbeatAt ? new Date(input.lastHeartbeatAt).getTime() : new Date(input.createdAt).getTime();
    return input.now - heartbeat > (input.runningTimeoutMs ?? 45_000) ? "paused" : "running";
  }
  if (input.status === "queued") return input.now - new Date(input.createdAt).getTime() > (input.queuedTimeoutMs ?? 90_000) ? "paused" : "queued";
  if (input.status === "awaiting_parent" || input.status === "completed" || input.status === "failed" || input.status === "cancelled") return input.status;
  return "failed";
}
