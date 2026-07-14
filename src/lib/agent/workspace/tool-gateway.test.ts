import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { issueWorkspaceCapability } from "./capability";
import { callWorkspaceTool } from "./tool-gateway";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const capabilitySecret = "workspace-integration-test-secret";
const admin = createClient<Database>(url, secretKey, { auth: { persistSession: false } });
let userId = ""; let familyId = ""; let studentId = ""; let evidenceId = ""; let turnId = ""; let snapshotVersion = 0;

beforeAll(async () => {
  process.env.KLIO_AGENT_CAPABILITY_SECRET = capabilitySecret;
  const user = await admin.auth.admin.createUser({ email: `workspace-${crypto.randomUUID()}@example.test`, password: "KlioWorkspace123", email_confirm: true });
  if (user.error) throw user.error; userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Workspace integration", created_by: userId }).select("id").single();
  if (family.error) throw family.error; familyId = family.data.id;
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "Test learner" }).select("id").single();
  if (student.error) throw student.error; studentId = student.data.id;
  const evidence = await admin.from("evidence_items").insert({ family_id: familyId, created_by: userId, kind: "note", raw_text: "Give out the test Wednesday" }).select("id").single();
  if (evidence.error) throw evidence.error; evidenceId = evidence.data.id;
  const thread = await admin.from("agent_threads").insert({ family_id: familyId, provider: "codex_app_server" }).select("id").single();
  if (thread.error) throw thread.error;
  const version = await admin.from("families").select("agent_context_version").eq("id", familyId).single();
  if (version.error) throw version.error; snapshotVersion = version.data.agent_context_version;
  const turn = await admin.from("agent_turns").insert({ thread_id: thread.data.id, family_id: familyId, requested_by: userId, source_evidence_id: evidenceId, trigger: "capture", goal: "capture", status: "running", idempotency_key: `test:${crypto.randomUUID()}`, initial_snapshot_version: snapshotVersion, current_snapshot_version: snapshotVersion, snapshot_hash: "a".repeat(64) }).select("id").single();
  if (turn.error) throw turn.error; turnId = turn.data.id;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

function authorization() {
  const now = Date.now();
  const token = issueWorkspaceCapability({ familyId, requestedBy: userId, klioTurnId: turnId, snapshotVersion, allowedTools: ["create_reminder", "file_capture"], issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), nonce: crypto.randomUUID().replaceAll("-", "") }, capabilitySecret);
  return `Bearer ${token}`;
}

describe("workspace tool gateway", () => {
  it("commits an idempotent snapshot-bound reminder", async () => {
    const args = { title: "Give out test", dueAt: "2026-07-15T13:00:00.000Z", studentId, sourceEvidenceId: evidenceId, idempotencyKey: "reminder:test:v1" };
    await callWorkspaceTool({ authorization: authorization(), name: "create_reminder", arguments: args });
    await callWorkspaceTool({ authorization: authorization(), name: "create_reminder", arguments: args });
    const reminders = await admin.from("reminders").select("id").eq("family_id", familyId);
    expect(reminders.error).toBeNull(); expect(reminders.data).toHaveLength(1);
  });

  it("creates a direct parent reminder without source evidence", async () => {
    const args = { title: "Grade this week's work", dueAt: "2026-07-18T00:00:00.000Z", studentId, idempotencyKey: "reminder:direct:v1" };
    await callWorkspaceTool({ authorization: authorization(), name: "create_reminder", arguments: args });
    await callWorkspaceTool({ authorization: authorization(), name: "create_reminder", arguments: args });
    const reminders = await admin.from("reminders").select("id, source_evidence_id").eq("family_id", familyId).eq("title", args.title);
    expect(reminders.error).toBeNull();
    expect(reminders.data).toHaveLength(1);
    expect(reminders.data?.[0]?.source_evidence_id).toBeNull();
  });

  it("files a capture without creating an artifact or approval", async () => {
    const result = await callWorkspaceTool({
      authorization: authorization(),
      name: "file_capture",
      arguments: { evidenceId, studentId, category: "Math", documentType: "Note", tags: ["test"], confidence: 0.9, idempotencyKey: "filing:success:v1" },
    });
    expect(result).toMatchObject({ outcome: "filed", artifactCreated: false, approvalCreated: false });
    const [filingQuery, artifactQuery, approvalQuery] = await Promise.all([
      admin.from("evidence_categories").select("evidence_id", { count: "exact", head: true }).eq("family_id", familyId).eq("evidence_id", evidenceId),
      admin.from("artifacts").select("id", { count: "exact", head: true }).eq("family_id", familyId),
      admin.from("approval_requests").select("id", { count: "exact", head: true }).eq("family_id", familyId),
    ]);
    expect(filingQuery.error).toBeNull();
    expect(artifactQuery.error).toBeNull();
    expect(approvalQuery.error).toBeNull();
    expect(filingQuery.count).toBe(1);
    expect(artifactQuery.count).toBe(0);
    expect(approvalQuery.count).toBe(0);
  });

  it("rejects a write after an external workspace change", async () => {
    await admin.from("students").update({ learning_preferences: "Changed by parent" }).eq("id", studentId);
    await expect(callWorkspaceTool({ authorization: authorization(), name: "file_capture", arguments: { evidenceId, studentId, category: "Math", documentType: "Note", tags: [], confidence: 0.9, idempotencyKey: "filing:test:v1" } })).rejects.toThrow("SNAPSHOT_STALE");
  });
});
