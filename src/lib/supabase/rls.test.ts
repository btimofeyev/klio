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

  it("does not let another family dismiss a guessed practice session", async () => {
    const student = await clients[0].from("students").insert({ family_id: families[0], display_name: "Private practice learner" }).select("id").single();
    if (student.error) throw student.error;
    const session = await clients[0].from("practice_sessions").insert({
      family_id: families[0], student_id: student.data.id, created_by: users[0],
      spec: { subject: "Math", skill_key: "addition" }, status: "ready",
    }).select("id").single();
    if (session.error) throw session.error;

    const forged = await clients[1].from("practice_sessions").update({
      status: "dismissed", dismissed_at: new Date().toISOString(), dismissed_by: users[1], dismissal_reason: "already_understands",
    }).eq("id", session.data.id).select("id");
    expect(forged.error).toBeNull();
    expect(forged.data).toEqual([]);
    expect((await clients[0].from("practice_sessions").select("status").eq("id", session.data.id).single()).data?.status).toBe("ready");
  });

  it("isolates academic terms, goals, pacing, and derived checkpoints", async () => {
    const studentA = await clients[0].from("students").insert({ family_id: families[0], display_name: "Pacing learner A" }).select("id").single();
    const studentB = await clients[1].from("students").insert({ family_id: families[1], display_name: "Pacing learner B" }).select("id").single();
    if (studentA.error ?? studentB.error) throw studentA.error ?? studentB.error;
    const term = await clients[0].from("academic_terms").insert({ family_id: families[0], created_by: users[0], name: "Isolation term", starts_on: "2026-08-01", ends_on: "2027-05-31", status: "active" }).select("id").single();
    if (term.error) throw term.error;
    const goal = await clients[0].from("learning_goals").insert({ family_id: families[0], student_id: studentA.data!.id, term_id: term.data.id, created_by: users[0], title: "Finish science", subject: "Science", status: "active" }).select("id").single();
    if (goal.error) throw goal.error;
    const hiddenTerms = await clients[1].from("academic_terms").select("id").eq("id", term.data.id);
    const hiddenGoals = await clients[1].from("learning_goals").select("id").eq("id", goal.data.id);
    expect(hiddenTerms.error).toBeNull(); expect(hiddenTerms.data).toEqual([]);
    expect(hiddenGoals.error).toBeNull(); expect(hiddenGoals.data).toEqual([]);
    const forgedFamily = await clients[1].from("learning_goals").insert({ family_id: families[0], student_id: studentA.data!.id, term_id: term.data.id, created_by: users[1], title: "Forbidden", subject: "Science" });
    expect(forgedFamily.error).not.toBeNull();
    const forgedLearner = await clients[0].from("learning_goals").insert({ family_id: families[0], student_id: studentB.data!.id, term_id: term.data.id, created_by: users[0], title: "Cross-family learner", subject: "Science" });
    expect(forgedLearner.error).not.toBeNull();
    const forgedCheckpoint = await clients[0].from("pacing_checkpoints").insert({ family_id: families[0], goal_id: goal.data.id, student_id: studentA.data!.id, as_of_date: "2026-09-01", expected_value: 2, actual_value: 1, target_value: 10, remaining_value: 9, state: "at_risk", feasible: true, basis: "plan" });
    expect(forgedCheckpoint.error).not.toBeNull();
    const day = await clients[0].from("instructional_day_records").insert({ family_id: families[0], student_id: studentA.data!.id, term_id: term.data.id, created_by: users[0], instructional_date: "2026-09-01", status: "held", instructional_minutes: 180 }).select("id").single();
    if (day.error) throw day.error;
    expect((await clients[1].from("instructional_day_records").select("id").eq("id", day.data.id)).data).toEqual([]);
    const correction = await clients[0].from("parent_agent_corrections").insert({ family_id: families[0], student_id: studentA.data!.id, domain: "planning", correction_kind: "parent_changed_priority", target_type: "learning_goal", target_entity_id: goal.data.id, original_value: { priority: 50 }, corrected_value: { priority: 80 }, created_by: users[0] }).select("id").single();
    if (correction.error) throw correction.error;
    expect((await clients[1].from("parent_agent_corrections").select("id").eq("id", correction.data.id)).data).toEqual([]);
    expect((await clients[0].from("parent_agent_corrections").update({ note: "Overwrite" }).eq("id", correction.data.id)).error).not.toBeNull();
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

  it("keeps reminders and grounded question history inside the family", async () => {
    const reminder = await clients[0].from("reminders").insert({
      family_id: families[0], title: "Transient private reminder", status: "pending",
      created_by_type: "parent", created_by: users[0],
    }).select("id").single();
    if (reminder.error) throw reminder.error;
    const hiddenReminder = await clients[1].from("reminders").select("id").eq("id", reminder.data.id);
    expect(hiddenReminder.data).toEqual([]);
    const forgedReminder = await clients[1].from("reminders").update({ status: "completed" }).eq("id", reminder.data.id).select("id");
    expect(forgedReminder.data).toEqual([]);

    const thread = await clients[0].from("question_threads").insert({
      family_id: families[0], title: "Transient private question", created_by: users[0],
    }).select("id").single();
    if (thread.error) throw thread.error;
    const message = await clients[0].from("question_messages").insert({
      family_id: families[0], thread_id: thread.data.id, role: "user", content: "What did we save?", created_by: users[0],
    }).select("id").single();
    if (message.error) throw message.error;
    const hiddenThread = await clients[1].from("question_threads").select("id").eq("id", thread.data.id);
    const hiddenMessage = await clients[1].from("question_messages").select("id").eq("id", message.data.id);
    expect(hiddenThread.data).toEqual([]);
    expect(hiddenMessage.data).toEqual([]);
  });

  it("keeps durable Klio conversations inside the family and server-owned", async () => {
    const conversation = await admin.from("agent_conversations").insert({ family_id: families[0], created_by: users[0], title: "Private Klio conversation" }).select("id").single();
    if (conversation.error) throw conversation.error;
    const message = await admin.from("agent_conversation_messages").insert({ family_id: families[0], conversation_id: conversation.data.id, role: "user", content: "What changed this week?" }).select("id").single();
    if (message.error) throw message.error;

    expect((await clients[0].from("agent_conversations").select("id").eq("id", conversation.data.id)).data).toEqual([{ id: conversation.data.id }]);
    expect((await clients[1].from("agent_conversations").select("id").eq("id", conversation.data.id)).data).toEqual([]);
    expect((await clients[1].from("agent_conversation_messages").select("id").eq("id", message.data.id)).data).toEqual([]);
    expect((await clients[0].from("agent_conversation_messages").insert({ family_id: families[0], conversation_id: conversation.data.id, role: "assistant", content: "Forged assistant reply" })).error).not.toBeNull();

    const thread = await admin.from("agent_threads").insert({ family_id: families[0], provider: "codex_app_server", conversation_id: conversation.data.id }).select("id").single();
    if (thread.error) throw thread.error;
    const turn = await admin.from("agent_turns").insert({
      family_id: families[0], thread_id: thread.data.id, requested_by: users[0], trigger: "parent_message", goal: "general",
      idempotency_key: `rls-conversation:${suffix}`, initial_snapshot_version: 0, current_snapshot_version: 0,
      snapshot_hash: "0".repeat(64), conversation_id: conversation.data.id, interaction_mode: "answer",
    }).select("id").single();
    if (turn.error) throw turn.error;
    const linked = await admin.from("agent_conversation_messages").update({ agent_turn_id: turn.data.id }).eq("id", message.data.id);
    if (linked.error) throw linked.error;
    const removedTurn = await admin.from("agent_turns").delete().eq("id", turn.data.id);
    if (removedTurn.error) throw removedTurn.error;
    expect((await admin.from("agent_conversation_messages").select("family_id,agent_turn_id").eq("id", message.data.id).single()).data).toEqual({ family_id: families[0], agent_turn_id: null });

    const removedConversation = await admin.from("agent_conversations").delete().eq("id", conversation.data.id);
    if (removedConversation.error) throw removedConversation.error;
    expect((await admin.from("agent_conversation_messages").select("id").eq("conversation_id", conversation.data.id)).data).toEqual([]);
    expect((await admin.from("agent_threads").select("id").eq("conversation_id", conversation.data.id)).data).toEqual([]);
  });

  it("keeps parent-owned curriculum schedules inside the family", async () => {
    const student = await clients[0].from("students").insert({ family_id: families[0], display_name: "Schedule isolation learner" }).select("id").single();
    if (student.error) throw student.error;
    const item = await clients[0].from("weekly_plan_items").insert({
      family_id: families[0], student_id: student.data.id, artifact_id: null,
      title: "Private curriculum lesson", subject: "Math", scheduled_date: "2026-07-13", source_kind: "parent",
    }).select("id").single();
    if (item.error) throw item.error;

    const hidden = await clients[1].from("weekly_plan_items").select("id").eq("id", item.data.id);
    const forgedUpdate = await clients[1].from("weekly_plan_items").update({ scheduled_date: "2026-07-14" }).eq("id", item.data.id).select("id");
    expect(hidden.data).toEqual([]);
    expect(forgedUpdate.data).toEqual([]);
  });

  it("isolates curriculum, assignments, reviews, and adjustment proposals by family", async () => {
    const student = await clients[0].from("students").insert({ family_id: families[0], display_name: "Operating-loop learner" }).select("id").single();
    if (student.error) throw student.error;
    const unit = await clients[0].from("curriculum_units").insert({ family_id: families[0], student_id: student.data.id, created_by: users[0], subject: "Math", title: "Private Algebra" }).select("id").single();
    if (unit.error) throw unit.error;
    const assignment = await clients[0].from("assignments").insert({ family_id: families[0], student_id: student.data.id, curriculum_unit_id: unit.data.id, created_by: users[0], title: "Private Algebra · Lesson 1", subject: "Math", scheduled_date: "2026-07-13" }).select("id").single();
    if (assignment.error) throw assignment.error;

    expect((await clients[1].from("curriculum_units").select("id").eq("id", unit.data.id)).data).toEqual([]);
    expect((await clients[1].from("assignments").select("id").eq("id", assignment.data.id)).data).toEqual([]);
    expect((await clients[1].from("assignments").update({ status: "completed" }).eq("id", assignment.data.id).select("id")).data).toEqual([]);
    const forged = await clients[1].from("assignments").insert({ family_id: families[0], student_id: student.data.id, title: "Forged work", subject: "Math" });
    expect(forged.error).not.toBeNull();
    const version = await admin.from("families").select("agent_context_version").eq("id", families[0]).single();
    const proposal = await admin.from("planning_proposals").insert({ family_id: families[0], student_id: student.data.id, proposal_kind: "weekly_plan", action_name: "prepare_week", risk: "moderate", title: "Private proposal", summary: "A private family schedule proposal.", reason: "RLS verification", proposed_changes: { assignmentIds: [assignment.data.id], changes: [] }, snapshot_version: version.data!.agent_context_version, idempotency_key: `private-proposal:${suffix}` }).select("id").single();
    if (proposal.error) throw proposal.error;
    expect((await clients[0].from("planning_proposals").select("id").eq("id", proposal.data.id)).data).toEqual([{ id: proposal.data.id }]);
    expect((await clients[1].from("planning_proposals").select("id").eq("id", proposal.data.id)).data).toEqual([]);
    expect((await clients[0].from("planning_proposals").update({ status: "applied" }).eq("id", proposal.data.id)).error).not.toBeNull();
    expect((await clients[1].from("planning_proposals").update({ status: "applied" }).eq("id", proposal.data.id)).error).not.toBeNull();
  });

  it("keeps schedule acknowledgements inside the owning family", async () => {
    const student = await clients[0].from("students").insert({ family_id: families[0], display_name: "Acknowledgement learner" }).select("id").single();
    if (student.error) throw student.error;
    const version = await admin.from("families").select("agent_context_version").eq("id", families[0]).single();
    if (version.error) throw version.error;
    const proposal = await admin.from("adjustment_proposals").insert({
      family_id: families[0], student_id: student.data.id, week_start: "2026-07-13",
      reason: "Transient acknowledgement isolation check", summary: "Moved one transient lesson.",
      status: "applied", snapshot_version: version.data.agent_context_version, undo_status: "available",
    }).select("id").single();
    if (proposal.error) throw proposal.error;

    const forged = await clients[1].from("adjustment_proposals")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: users[1] })
      .eq("id", proposal.data.id)
      .select("id");
    expect(forged.error).toBeNull();
    expect(forged.data).toEqual([]);
    expect((await admin.from("adjustment_proposals").select("acknowledged_at").eq("id", proposal.data.id).single()).data?.acknowledged_at).toBeNull();
  });

  it("does not expose service-only family execution leases", async () => {
    const lease = await admin.rpc("acquire_family_execution_lease", { p_family_id: families[0], p_owner_token: crypto.randomUUID(), p_work_kind: "workspace_turn", p_work_id: crypto.randomUUID(), p_ttl_seconds: 120 });
    expect(lease.data).toBe(true);
    const own = await clients[0].from("family_execution_leases").select("family_id").eq("family_id", families[0]);
    const other = await clients[1].from("family_execution_leases").select("family_id").eq("family_id", families[0]);
    expect(own.error).not.toBeNull(); expect(other.error).not.toBeNull();
  });

  it("isolates autonomy policy, evaluations, insights, and learner references", async () => {
    const student = await clients[0].from("students").insert({ family_id: families[0], display_name: "Autonomy isolation learner" }).select("id").single();
    if (student.error) throw student.error;
    const policy = await clients[0].from("family_autonomy_policies").insert({ family_id: families[0], preset: "proactive", policies: {}, updated_by: users[0] }).select("family_id").single();
    if (policy.error) throw policy.error;
    const evaluation = await admin.from("proactive_evaluations").insert({ family_id: families[0], student_id: student.data.id, requested_by: users[0], event_kind: "manual", entity_type: "family", idempotency_key: `rls:${suffix}` }).select("id").single();
    if (evaluation.error) throw evaluation.error;
    const insight = await admin.from("klio_insights").insert({ family_id: families[0], student_id: student.data.id, evaluation_id: evaluation.data.id, kind: "noticed", title: "Private trend", summary: "Private family learning context", dedupe_key: `rls:${suffix}` }).select("id").single();
    if (insight.error) throw insight.error;

    expect((await clients[1].from("family_autonomy_policies").select("family_id").eq("family_id", families[0])).data).toEqual([]);
    expect((await clients[1].from("proactive_evaluations").select("id").eq("id", evaluation.data.id)).data).toEqual([]);
    expect((await clients[1].from("klio_insights").select("id").eq("id", insight.data.id)).data).toEqual([]);
    expect((await clients[1].from("klio_insights").update({ status: "dismissed", dismissed_by: users[1] }).eq("id", insight.data.id).select("id")).data).toEqual([]);
    const forgedPolicy = await clients[1].from("family_autonomy_policies").update({ preset: "ask_first" }).eq("family_id", families[0]).select("family_id");
    expect(forgedPolicy.data).toEqual([]);
  });

  it("keeps saved workspace arrangements inside the family", async () => {
    const own = await clients[0].from("family_workspace_layouts").upsert({
      family_id: families[0], surface: "week", scope_key: "all", layout_version: 2,
      positions: { schedule: { x: 650, y: 470 }, progress: { x: 180, y: 1510 } }, updated_by: users[0],
    }, { onConflict: "family_id,surface,scope_key" }).select("family_id,surface,scope_key").single();
    expect(own.error).toBeNull();

    const hidden = await clients[1].from("family_workspace_layouts").select("family_id").eq("family_id", families[0]);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const forgedUpdate = await clients[1].from("family_workspace_layouts").update({ positions: { schedule: { x: 0, y: 0 } }, updated_by: users[1] }).eq("family_id", families[0]).select("family_id");
    expect(forgedUpdate.data).toEqual([]);
    const forgedInsert = await clients[1].from("family_workspace_layouts").insert({ family_id: families[0], surface: "day", scope_key: "all", layout_version: 2, positions: {}, updated_by: users[1] });
    expect(forgedInsert.error).not.toBeNull();
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
