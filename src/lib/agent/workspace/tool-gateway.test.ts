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
let userId = ""; let familyId = ""; let studentId = ""; let evidenceId = ""; let turnId = ""; let snapshotVersion = 0; let termId = ""; let otherFamilyId = ""; let otherStudentId = "";

beforeAll(async () => {
  process.env.KLIO_AGENT_CAPABILITY_SECRET = capabilitySecret;
  const user = await admin.auth.admin.createUser({ email: `workspace-${crypto.randomUUID()}@example.test`, password: "KlioWorkspace123", email_confirm: true });
  if (user.error) throw user.error; userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Workspace integration", created_by: userId }).select("id").single();
  if (family.error) throw family.error; familyId = family.data.id;
  await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "Test learner" }).select("id").single();
  if (student.error) throw student.error; studentId = student.data.id;
  const term = await admin.from("academic_terms").insert({ family_id: familyId, created_by: userId, name: "Tool term", starts_on: "2026-07-01", ends_on: "2027-06-30", status: "active" }).select("id").single();
  if (term.error) throw term.error; termId = term.data.id;
  const otherFamily = await admin.from("families").insert({ name: "Other family", created_by: userId }).select("id").single();
  if (otherFamily.error) throw otherFamily.error; otherFamilyId = otherFamily.data.id;
  await admin.from("family_members").insert({ family_id: otherFamilyId, user_id: userId, role: "owner" });
  const otherStudent = await admin.from("students").insert({ family_id: otherFamilyId, display_name: "Other learner" }).select("id").single();
  if (otherStudent.error) throw otherStudent.error; otherStudentId = otherStudent.data.id;
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
  if (otherFamilyId) await admin.from("families").delete().eq("id", otherFamilyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

function authorization() {
  const now = Date.now();
  const token = issueWorkspaceCapability({ familyId, requestedBy: userId, klioTurnId: turnId, snapshotVersion, allowedTools: ["create_reminder", "file_capture", "propose_learner_goal", "create_assignment", "read_goals_and_pacing", "read_relevant_history", "record_explicit_parent_score", "update_assignment_status", "create_practice_activity", "remove_supplemental_practice"], issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), nonce: crypto.randomUUID().replaceAll("-", "") }, capabilitySecret);
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

  it("creates one idempotent parent-reviewable goal proposal", async () => {
    const args = { studentId, termId, subject: "Science", title: "Finish Biology", goalKind: "curriculum_progress" as const, targetValue: 30, targetUnit: "assignments", targetDate: "2027-05-31", weeklyEffortMinutes: 180, weeklyCadence: 4, priority: 70, reason: "The parent asked for a Biology pacing goal.", idempotencyKey: "goal-proposal:test:v1" };
    const first = await callWorkspaceTool({ authorization: authorization(), name: "propose_learner_goal", arguments: args });
    const duplicate = await callWorkspaceTool({ authorization: authorization(), name: "propose_learner_goal", arguments: args });
    expect(duplicate).toEqual(first);
    const proposals = await admin.from("planning_proposals").select("id,status,proposal_kind").eq("family_id", familyId).eq("idempotency_key", args.idempotencyKey);
    expect(proposals.data).toEqual([expect.objectContaining({ status: "proposed", proposal_kind: "learner_goal" })]);
  });

  it("creates one assignment, increments versions, and preserves an explicit parent score", async () => {
    const args = { studentId, title: "Parent-requested oral review", subject: "Science", scheduledDate: "2026-07-20", estimatedMinutes: 25, sourceKind: "parent" as const, idempotencyKey: "assignment:create:explicit-score" };
    const first = await callWorkspaceTool({ authorization: authorization(), name: "create_assignment", arguments: args });
    const duplicate = await callWorkspaceTool({ authorization: authorization(), name: "create_assignment", arguments: args });
    expect(duplicate).toEqual(first);
    const assignmentId = (first as { assignmentId: string }).assignmentId;
    await callWorkspaceTool({ authorization: authorization(), name: "update_assignment_status", arguments: { assignmentId, status: "doing", explicitParentAuthorization: true, reason: "The parent explicitly started this work.", idempotencyKey: "assignment:status:doing" } });
    expect((await admin.from("assignments").select("version,status").eq("id", assignmentId).single()).data).toMatchObject({ version: 2, status: "doing" });
    const score = await callWorkspaceTool({ authorization: authorization(), name: "record_explicit_parent_score", arguments: { assignmentId, score: 91, scoreLabel: "Strong", feedback: "The parent observed the oral explanation.", idempotencyKey: "assignment:explicit-score:91" } });
    const scoreDuplicate = await callWorkspaceTool({ authorization: authorization(), name: "record_explicit_parent_score", arguments: { assignmentId, score: 91, scoreLabel: "Strong", feedback: "The parent observed the oral explanation.", idempotencyKey: "assignment:explicit-score:91" } });
    expect(scoreDuplicate).toEqual(score);
    expect((await admin.from("assignment_reviews").select("score,score_origin,grading_state,status").eq("id", (score as { reviewId: string }).reviewId).single()).data).toMatchObject({ score: 91, score_origin: "explicit_parent", grading_state: "final", status: "approved" });
  });

  it("returns a real cursor for bounded history pagination", async () => {
    const result = await callWorkspaceTool({ authorization: authorization(), name: "read_relevant_history", arguments: { studentId, limit: 1 } }) as { records: Array<{ updated_at: string }>; nextBefore: string | null };
    expect(result.records).toHaveLength(1);
    expect(result.nextBefore).toBe(result.records[0].updated_at);
  });

  it("makes ordinary focused practice available automatically under the proactive policy", async () => {
    const result = await callWorkspaceTool({ authorization: authorization(), name: "create_practice_activity", arguments: {
      studentId, title: "Regrouping practice", summary: "A short set based on the parent’s lesson update.", rationale: "The parent reported a specific struggle with regrouping.", idempotencyKey: "practice:automatic:regrouping",
      content: { practice: { version: 2, subject: "Mathematics", skill_key: "addition.regrouping", level_band: "k-2", instructions: "Solve each problem and explain one regrouping step.", mastery_percent: 80, activities: [
        { id: "sum-1", type: "short_answer", prompt: "Solve 28 + 17.", accepted_answers: ["45"], hints: ["Regroup 15 ones."], explanation: "8 + 7 is 15, so regroup one ten and keep 5 ones." },
        { id: "sum-2", type: "short_answer", prompt: "Solve 46 + 38.", accepted_answers: ["84"], hints: ["Add the ones first."], explanation: "6 + 8 is 14; regroup one ten, then add the tens." },
        { id: "sum-3", type: "short_answer", prompt: "Solve 57 + 26.", accepted_answers: ["83"], hints: ["Regroup 13 ones."], explanation: "7 + 6 is 13; keep 3 ones and add the regrouped ten to make 8 tens." },
        { id: "choose-1", type: "multiple_choice", prompt: "Which ones sum requires regrouping?", choices: ["4 + 3", "6 + 7", "2 + 5"], correct_answer: "6 + 7", hints: ["Look for a sum greater than 9."], explanation: "Six plus seven is 13, so ten of those ones must be regrouped." },
        { id: "explain-1", type: "written_response", prompt: "Explain why 37 + 25 needs regrouping.", success_criteria: ["States that 7 + 5 is 12", "Explains moving one ten to the tens place"], hints: ["Start with the ones."], explanation: "The ones total 12, so 10 ones become one additional ten.", max_length: 400 },
        { id: "explain-2", type: "written_response", prompt: "Explain the regrouping step in 48 + 36, then give the sum.", success_criteria: ["States that 8 + 6 is 14", "Regroups one ten", "Gives 84"], hints: ["Start with the ones, then add every ten."], explanation: "The 14 ones become one ten and four ones; adding that ten gives eight tens and four ones, or 84.", max_length: 400 },
      ] } },
    } });
    expect(result).toMatchObject({ outcome: "automatic_action", approved: true, approvalRequestId: null });
    const artifactId = (result as { artifactId: string }).artifactId;
    expect((await admin.from("artifacts").select("status").eq("id", artifactId).single()).data).toEqual({ status: "approved" });
    expect((await admin.from("approval_requests").select("id", { count: "exact", head: true }).eq("entity_id", artifactId)).count).toBe(0);
    expect((await admin.from("klio_insights").select("kind,action_ref").eq("family_id", familyId).eq("action_ref->>artifactId", artifactId).single()).data).toMatchObject({ kind: "practice_ready" });
  });

  it("removes only supplemental practice through the undoable policy path", async () => {
    const practice = await admin.from("assignments").insert({ family_id: familyId, student_id: studentId, created_by: userId, created_by_type: "agent", title: "Extra science practice", subject: "Science", source_kind: "practice", status: "planned", scheduled_date: "2026-07-22", estimated_minutes: 15 }).select("id").single();
    if (practice.error) throw practice.error;
    await admin.from("weekly_plan_items").insert({ family_id: familyId, student_id: studentId, assignment_id: practice.data.id, artifact_id: null, title: "Extra science practice", subject: "Science", source_kind: "klio", scheduled_date: "2026-07-22", estimated_minutes: 15 });
    const current = await admin.from("families").select("agent_context_version").eq("id", familyId).single();
    await admin.from("agent_turns").update({ current_snapshot_version: current.data!.agent_context_version }).eq("id", turnId);
    const result = await callWorkspaceTool({ authorization: authorization(), name: "remove_supplemental_practice", arguments: { assignmentId: practice.data.id, reason: "The parent reports that finalized improvement makes this extra support unnecessary.", idempotencyKey: "practice:remove:undoable" } });
    expect(result).toMatchObject({ outcome: "automatic_action", status: "applied", undoAvailable: true });
    expect((await admin.from("assignments").select("status,scheduled_date").eq("id", practice.data.id).single()).data).toMatchObject({ status: "skipped", scheduled_date: null });
    const undone = await admin.rpc("undo_klio_adjustment", { p_proposal_id: (result as { proposalId: string }).proposalId, p_actor_id: userId });
    expect(undone.data).toMatchObject({ status: "undone" });
    expect((await admin.from("assignments").select("status,scheduled_date").eq("id", practice.data.id).single()).data).toMatchObject({ status: "planned", scheduled_date: "2026-07-22" });
    const fresh = await admin.from("families").select("agent_context_version").eq("id", familyId).single();
    await admin.from("agent_turns").update({ current_snapshot_version: fresh.data!.agent_context_version }).eq("id", turnId);
  });

  it("rejects malformed and cross-family assignment writes", async () => {
    await expect(callWorkspaceTool({ authorization: authorization(), name: "create_assignment", arguments: { studentId, title: "", subject: "Math", idempotencyKey: "invalid:assignment" } })).rejects.toThrow();
    await expect(callWorkspaceTool({ authorization: authorization(), name: "create_assignment", arguments: { studentId: otherStudentId, title: "Cross-family", subject: "Math", sourceKind: "agent", idempotencyKey: "cross-family:assignment" } })).rejects.toThrow("STUDENT_NOT_FOUND");
  });

  it("rejects a write after an external workspace change", async () => {
    await admin.from("students").update({ learning_preferences: "Changed by parent" }).eq("id", studentId);
    await expect(callWorkspaceTool({ authorization: authorization(), name: "file_capture", arguments: { evidenceId, studentId, category: "Math", documentType: "Note", tags: [], confidence: 0.9, idempotencyKey: "filing:test:v1" } })).rejects.toThrow("SNAPSHOT_STALE");
  });

  it("rejects an unexpired capability after the turn is no longer active", async () => {
    await admin.from("agent_turns").update({ status: "completed" }).eq("id", turnId);
    await expect(callWorkspaceTool({ authorization: authorization(), name: "read_goals_and_pacing", arguments: { studentId } })).rejects.toThrow("AGENT_TURN_NOT_ACTIVE");
  });
});
