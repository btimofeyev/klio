import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let userId = ""; let familyA = ""; let familyB = "";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `leases-${crypto.randomUUID()}@example.test`, password: "KlioLeases123", email_confirm: true });
  if (user.error) throw user.error; userId = user.data.user.id;
  const families = await admin.from("families").insert([{ name: "Lease A", created_by: userId }, { name: "Lease B", created_by: userId }]).select("id,name");
  if (families.error) throw families.error;
  familyA = families.data.find((item) => item.name === "Lease A")!.id;
  familyB = families.data.find((item) => item.name === "Lease B")!.id;
});

afterAll(async () => {
  if (familyA || familyB) await admin.from("families").delete().in("id", [familyA, familyB].filter(Boolean));
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("per-family execution leases", () => {
  it("serializes one family while allowing unrelated families to run", async () => {
    const ownerA = crypto.randomUUID(); const contender = crypto.randomUUID(); const ownerB = crypto.randomUUID();
    const [first, sameFamily, otherFamily] = await Promise.all([
      admin.rpc("acquire_family_execution_lease", { p_family_id: familyA, p_owner_token: ownerA, p_work_kind: "workspace_turn", p_work_id: crypto.randomUUID(), p_ttl_seconds: 120 }),
      admin.rpc("acquire_family_execution_lease", { p_family_id: familyA, p_owner_token: contender, p_work_kind: "proactive_evaluation", p_work_id: crypto.randomUUID(), p_ttl_seconds: 120 }),
      admin.rpc("acquire_family_execution_lease", { p_family_id: familyB, p_owner_token: ownerB, p_work_kind: "proactive_evaluation", p_work_id: crypto.randomUUID(), p_ttl_seconds: 120 }),
    ]);
    expect(first.error ?? sameFamily.error ?? otherFamily.error).toBeNull();
    expect([first.data, sameFamily.data].filter(Boolean)).toHaveLength(1);
    expect(otherFamily.data).toBe(true);
    const activeOwner = first.data ? ownerA : contender;
    expect((await admin.rpc("heartbeat_family_execution_lease", { p_family_id: familyA, p_owner_token: crypto.randomUUID(), p_ttl_seconds: 120 })).data).toBe(false);
    expect((await admin.rpc("heartbeat_family_execution_lease", { p_family_id: familyA, p_owner_token: activeOwner, p_ttl_seconds: 120 })).data).toBe(true);
  });

  it("recovers an expired lease without arbitrary timing sleeps", async () => {
    const row = await admin.from("family_execution_leases").select("owner_token").eq("family_id", familyA).single();
    if (row.error) throw row.error;
    await admin.from("family_execution_leases").update({ expires_at: "2000-01-01T00:00:00Z" }).eq("family_id", familyA);
    const replacement = crypto.randomUUID();
    const acquired = await admin.rpc("acquire_family_execution_lease", { p_family_id: familyA, p_owner_token: replacement, p_work_kind: "workspace_turn", p_work_id: crypto.randomUUID(), p_ttl_seconds: 120 });
    expect(acquired.data).toBe(true);
    expect((await admin.rpc("release_family_execution_lease", { p_family_id: familyA, p_owner_token: row.data.owner_token })).data).toBe(false);
    expect((await admin.rpc("release_family_execution_lease", { p_family_id: familyA, p_owner_token: replacement })).data).toBe(true);
  });
});
