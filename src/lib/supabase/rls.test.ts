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

  it("keeps AI-created evidence folders inside their family", async () => {
    const category = await clients[0].from("categories").insert({
      family_id: families[0], name: "History", slug: "history", created_by: users[0], created_by_type: "agent",
    }).select("id").single();
    if (category.error) throw category.error;
    const evidence = await clients[0].from("evidence_items").insert({
      family_id: families[0], created_by: users[0], kind: "note", raw_text: "A transient RLS check",
    }).select("id").single();
    if (evidence.error) throw evidence.error;

    const hidden = await clients[1].from("categories").select("id").eq("id", category.data.id);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const forgedLink = await clients[1].from("evidence_categories").insert({
      family_id: families[0], evidence_id: evidence.data.id, category_id: category.data.id, assigned_by: "agent",
    });
    expect(forgedLink.error).not.toBeNull();
  });

  it("keeps background jobs and filing corrections inside their family", async () => {
    const student = await clients[0].from("students").insert({ family_id: families[0], display_name: "Queue isolation learner" }).select("id").single();
    if (student.error) throw student.error;
    const evidence = await clients[0].from("evidence_items").insert({ family_id: families[0], created_by: users[0], kind: "note", raw_text: "Transient queue isolation evidence" }).select("id").single();
    if (evidence.error) throw evidence.error;
    const category = await clients[0].from("categories").insert({ family_id: families[0], name: "Queue History", slug: `queue-history-${suffix}`, created_by: users[0], created_by_type: "parent" }).select("id").single();
    if (category.error) throw category.error;
    const job = await admin.from("agent_jobs").insert({ family_id: families[0], requested_by: users[0], student_id: student.data.id, total_actions: 1 }).select("id").single();
    if (job.error) throw job.error;
    await admin.from("agent_job_actions").insert({ family_id: families[0], job_id: job.data.id, intent: "organize" });
    await admin.from("agent_job_evidence").insert({ family_id: families[0], job_id: job.data.id, evidence_id: evidence.data.id });

    const ownJob = await clients[0].from("agent_jobs").select("id").eq("id", job.data.id);
    const hiddenJob = await clients[1].from("agent_jobs").select("id").eq("id", job.data.id);
    expect(ownJob.data).toEqual([{ id: job.data.id }]);
    expect(hiddenJob.data).toEqual([]);

    const correction = await clients[0].from("organization_corrections").insert({ family_id: families[0], evidence_id: evidence.data.id, to_category_id: category.data.id, created_by: users[0], cues: ["history"] }).select("id").single();
    if (correction.error) throw correction.error;
    const hiddenCorrection = await clients[1].from("organization_corrections").select("id").eq("id", correction.data.id);
    expect(hiddenCorrection.data).toEqual([]);
  });

  it("allows only one pending draft for the same learner skill", async () => {
    const student = await clients[0].from("students").insert({ family_id: families[0], display_name: "Deduplication learner" }).select("id").single();
    if (student.error) throw student.error;
    const observation = { family_id: families[0], student_id: student.data.id, authored_by: users[0], author_type: "parent" as const, subject: "Reading", skill_key: "reading.main-idea", skill_label: "Finds the main idea", status: "developing" as const, rationale: "Transient draft" };
    const first = await clients[0].from("skill_observations").insert(observation);
    const duplicate = await clients[0].from("skill_observations").insert({ ...observation, rationale: "Duplicate transient draft" });
    expect(first.error).toBeNull();
    expect(duplicate.error?.code).toBe("23505");
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
