import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const password = "KlioRlsTest123";
const suffix = crypto.randomUUID();
const emails = [`rls-a-${suffix}@example.test`, `rls-b-${suffix}@example.test`];
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
const users: string[] = [];
const clients: SupabaseClient<Database>[] = [];
const families: string[] = [];

beforeAll(async () => {
  if (!url || !publishable || !secret) throw new Error("Local Supabase environment is required for RLS tests.");
  for (const email of emails) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const client = createClient<Database>(url, publishable, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    clients.push(client);
    const family = await client.from("families").insert({ name: "Transient isolation test", created_by: data.user.id }).select("id").single();
    if (family.error) throw family.error;
    families.push(family.data.id);
    const member = await client.from("family_members").insert({ family_id: family.data.id, user_id: data.user.id, role: "owner" });
    if (member.error) throw member.error;
  }
});

afterAll(async () => {
  for (const id of families) await admin.from("families").delete().eq("id", id);
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("family RLS isolation", () => {
  it("does not reveal another family's row", async () => {
    const result = await clients[0].from("families").select("id").eq("id", families[1]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("rejects inserting a student into another family", async () => {
    const result = await clients[0].from("students").insert({ family_id: families[1], display_name: "Forbidden" });
    expect(result.error).not.toBeNull();
  });

  it("rejects uploading into another family's storage prefix", async () => {
    const result = await clients[0].storage.from("family-evidence").upload(`${families[1]}/${crypto.randomUUID()}/note.txt`, new Blob(["private"]), { contentType: "text/plain" });
    expect(result.error).not.toBeNull();
  });

  it("does not trust an unexpired token after its Auth user is deleted", async () => {
    const email = `deleted-session-${crypto.randomUUID()}@example.test`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const client = createClient<Database>(url, publishable, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error("No session");
    await admin.auth.admin.deleteUser(created.data.user.id);

    const verified = await client.auth.getUser(signedIn.data.session.access_token);
    expect(verified.data.user).toBeNull();
    expect(verified.error).not.toBeNull();
  });
});
