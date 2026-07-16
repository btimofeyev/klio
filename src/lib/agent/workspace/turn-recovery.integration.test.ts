import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { claimWorkspaceTurn, recoverInterruptedWorkspaceTurns } from "./turns";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
let userId = "";
let familyId = "";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `recovery-${crypto.randomUUID()}@example.test`, password: "KlioRecovery123", email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Worker recovery", created_by: userId }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const member = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  if (member.error) throw member.error;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("durable worker recovery", () => {
  it("recovers a stale running turn exactly once and terminally fails exhausted work", async () => {
    const thread = await admin.from("agent_threads").insert({ family_id: familyId, provider: "codex_app_server" }).select("id").single();
    if (thread.error) throw thread.error;
    const base = { thread_id: thread.data.id, family_id: familyId, requested_by: userId, trigger: "parent_message", goal: "general", initial_snapshot_version: 0, current_snapshot_version: 0, snapshot_hash: "a".repeat(64) };
    const turns = await admin.from("agent_turns").insert([
      { ...base, status: "running", attempt_count: 1, idempotency_key: `recover:${crypto.randomUUID()}`, last_heartbeat_at: "2026-07-14T15:55:00Z", normalized_step: "checking" },
      { ...base, status: "queued", attempt_count: 3, idempotency_key: `fail:${crypto.randomUUID()}`, last_heartbeat_at: "2026-07-14T15:55:00Z", normalized_step: "waiting" },
    ]).select("id,attempt_count");
    if (turns.error) throw turns.error;
    const recoveredId = turns.data.find((item) => item.attempt_count === 1)!.id;
    const failedId = turns.data.find((item) => item.attempt_count === 3)!.id;
    const queuedEvent = await admin.from("agent_events").insert({ family_id: familyId, turn_id: recoveredId, sequence: 1, kind: "turn.queued", payload: {} });
    if (queuedEvent.error) throw queuedEvent.error;
    const first = await recoverInterruptedWorkspaceTurns(new Date("2026-07-14T16:00:00Z"));
    expect(first).toMatchObject({ recovered: 1, failed: 1 });
    expect((await admin.from("agent_turns").select("status,error_code").eq("id", recoveredId).single()).data).toMatchObject({ status: "queued", error_code: "RECOVERED_STALE_TURN" });
    expect((await admin.from("agent_turns").select("status,error_code").eq("id", failedId).single()).data).toMatchObject({ status: "failed", error_code: "RETRY_LIMIT_REACHED" });
    const second = await recoverInterruptedWorkspaceTurns(new Date("2026-07-14T16:00:01Z"));
    expect(second).toMatchObject({ recovered: 0, failed: 0 });

    const firstClaim = await claimWorkspaceTurn(recoveredId);
    expect(firstClaim).not.toBeNull();
    await admin.from("agent_turns").update({ status: "queued" }).eq("id", recoveredId);
    await admin.rpc("release_family_execution_lease", { p_family_id: familyId, p_owner_token: firstClaim!.leaseToken });
    expect(await claimWorkspaceTurn(recoveredId)).not.toBeNull();
    const events = await admin.from("agent_events").select("sequence").eq("turn_id", recoveredId).order("sequence");
    expect(events.data?.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });
});
