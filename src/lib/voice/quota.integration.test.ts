import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
const userIds: string[] = [];

describe("voice transcription quota", () => {
  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  it("allows only one active transcription for a parent across concurrent claims", async () => {
    const userId = await createUser();
    const firstToken = crypto.randomUUID();
    const secondToken = crypto.randomUUID();
    const [first, second] = await Promise.all([
      claim(userId, firstToken, 30),
      claim(userId, secondToken, 30),
    ]);
    const claims = [first, second].map((result) => result.data as { allowed: boolean; reason?: string; leaseToken?: string });
    expect(claims.filter((item) => item.allowed)).toHaveLength(1);
    expect(claims.find((item) => !item.allowed)?.reason).toBe("concurrent");
    const activeToken = claims.find((item) => item.allowed)?.leaseToken;
    expect(activeToken).toBeTruthy();
    expect((await release(userId, activeToken!)).data).toBe(true);
    const replacementToken = crypto.randomUUID();
    expect(((await claim(userId, replacementToken, 30)).data as { allowed: boolean }).allowed).toBe(true);
    await release(userId, replacementToken);
  });

  it("enforces five attempts per ten-minute database window", async () => {
    const userId = await createUser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = crypto.randomUUID();
      const result = await claim(userId, token, 10);
      expect((result.data as { allowed: boolean }).allowed).toBe(true);
      await release(userId, token);
    }
    const denied = await claim(userId, crypto.randomUUID(), 10);
    expect(denied.error).toBeNull();
    expect(denied.data).toMatchObject({ allowed: false, reason: "rate_limit" });
    expect((denied.data as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });

  it("caps global transcription concurrency at four durable slots", async () => {
    const users = await Promise.all(Array.from({ length: 5 }, () => createUser()));
    const tokens = users.map(() => crypto.randomUUID());
    const results = [];
    for (let index = 0; index < users.length; index += 1) results.push(await claim(users[index], tokens[index], 20));
    expect(results.slice(0, 4).every((result) => (result.data as { allowed: boolean }).allowed)).toBe(true);
    expect(results[4].data).toMatchObject({ allowed: false, reason: "capacity" });
    await Promise.all(users.slice(0, 4).map((userId, index) => release(userId, tokens[index])));
  });

  it("does not expose quota RPCs to an authenticated browser client", async () => {
    const password = "VoiceQuotaTest123!";
    const email = `voice-quota-${crypto.randomUUID()}@example.test`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("USER_CREATE_FAILED");
    userIds.push(created.data.user.id);
    const browser = createClient<Database>(url, publishable, { auth: { persistSession: false } });
    await browser.auth.signInWithPassword({ email, password });
    const result = await browser.rpc("claim_voice_transcription", {
      p_user_id: created.data.user.id,
      p_lease_token: crypto.randomUUID(),
      p_audio_seconds: 10,
      p_lease_seconds: 90,
    });
    expect(result.error?.code).toBe("42501");
  });
});

async function createUser() {
  const created = await admin.auth.admin.createUser({
    email: `voice-quota-${crypto.randomUUID()}@example.test`,
    password: "VoiceQuotaTest123!",
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("USER_CREATE_FAILED");
  userIds.push(created.data.user.id);
  return created.data.user.id;
}

function claim(userId: string, token: string, seconds: number) {
  return admin.rpc("claim_voice_transcription", {
    p_user_id: userId,
    p_lease_token: token,
    p_audio_seconds: seconds,
    p_lease_seconds: 90,
  });
}

function release(userId: string, token: string) {
  return admin.rpc("release_voice_transcription", { p_user_id: userId, p_lease_token: token });
}
