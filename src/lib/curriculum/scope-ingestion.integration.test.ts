import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { applyCurriculumScopeSuggestion, processCurriculumScopeSuggestion } from "./scope-ingestion";
import { queueWebScopeSuggestion } from "./scope-suggestion-store";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let userId = "";
let familyId = "";
let unitId = "";
let studentId = "";
let parentClient: SupabaseClient<Database>;
const userEmail = `scope-search-${crypto.randomUUID()}@example.test`;
const userPassword = "KlioScopeSearch123";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: userEmail, password: userPassword, email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Scope search family", created_by: userId }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const membership = await admin.from("family_members").upsert({ family_id: familyId, user_id: userId, role: "owner" }, { onConflict: "family_id,user_id" });
  if (membership.error) throw membership.error;
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "Search learner" }).select("id").single();
  if (student.error) throw student.error;
  studentId = student.data.id;
  const unit = await admin.from("curriculum_units").insert({
    family_id: familyId,
    student_id: student.data.id,
    created_by: userId,
    subject: "English",
    title: "BJU Press English 7",
    publisher: "BJU Press",
    product_name: "English 7",
    grade_label: "Grade 7",
    edition_label: "4th edition",
    isbn: "9780306406157",
    identity_status: "verified",
    target_lesson_count: 100,
  }).select("id").single();
  if (unit.error) throw unit.error;
  unitId = unit.data.id;
  parentClient = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const signedIn = await parentClient.auth.signInWithPassword({ email: userEmail, password: userPassword });
  if (signedIn.error) throw signedIn.error;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("web-grounded curriculum scope ingestion", () => {
  it("searches with every saved identifier, persists sources, and preserves parent-verified identity", async () => {
    const suggestion = await admin.from("curriculum_scope_suggestions").insert({
      family_id: familyId,
      curriculum_unit_id: unitId,
      requested_by: userId,
      status: "queued",
      publisher: "BJU Press",
      product_name: "English 7",
      grade_label: "Grade 7",
      edition_label: "4th edition",
      isbn: "9780306406157",
      identity_status: "verified",
      source_kind: "web_search",
      source_fingerprint: `web-search-${crypto.randomUUID()}`,
    }).select("id").single();
    if (suggestion.error) throw suggestion.error;

    const result = await processCurriculumScopeSuggestion(suggestion.data.id, {
      search: async ({ course }) => {
        expect(course).toMatchObject({ title: "BJU Press English 7", subject: "English", publisher: "BJU Press", productName: "English 7", gradeLabel: "Grade 7", editionLabel: "4th edition", isbn: "9780306406157", identityStatus: "verified", targetLessonCount: 100 });
        return {
          proposal: {
            proposal: {
              identity: { publisher: "Wrong search publisher", productName: "Wrong edition", subject: "English", gradeLabel: "Grade 8", editionLabel: "5th edition", isbn: null },
              targetLessonCount: 100,
              assumptions: ["Only the first source-backed row is included in this fixture."],
              items: [{ sequenceNumber: 1, title: "The Writing Process", kind: "lesson", path: ["Unit 1"], minutes: 40, confidence: 0.92 }],
              confidence: 0.92,
            },
            pacing: { sourceGranularity: "daily_session", containerLabel: null, containerCount: null, recommendedWeeklyFrequency: 5, recommendedWeekCount: 20, recommendedSessionCount: 100, minutesPerSession: 40, confidence: 0.92 },
          },
          sources: [{ url: "https://publisher.example/english-7/toc#contents", title: "English 7 table of contents" }],
        };
      },
    });

    expect(result).toMatchObject({
      status: "ready",
      publisher: "BJU Press",
      product_name: "English 7",
      grade_label: "Grade 7",
      edition_label: "4th edition",
      isbn: "9780306406157",
      identity_status: "verified",
      source_kind: "web_search",
      source_urls: [{ url: "https://publisher.example/english-7/toc", title: "English 7 table of contents" }],
      proposed_items: [{ sequenceNumber: 1, title: "The Writing Process" }],
      before_snapshot: { pacing: { sourceGranularity: "daily_session", recommendedWeeklyFrequency: 5, recommendedWeekCount: 20, recommendedSessionCount: 100 } },
    });
  });

  it("queues a name-only course once and does not repeat a terminal search", async () => {
    const unit = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: studentId, created_by: userId, subject: "Math", title: "Algebra 1" }).select("id").single();
    if (unit.error) throw unit.error;
    const first = await queueWebScopeSuggestion({ familyId, curriculumUnitId: unit.data.id, requestedBy: userId, process: false });
    const duplicate = await queueWebScopeSuggestion({ familyId, curriculumUnitId: unit.data.id, requestedBy: userId, process: false });
    expect(first).toMatchObject({ status: "queued" });
    expect(duplicate?.id).toBe(first?.id);
    const dismissed = await admin.from("curriculum_scope_suggestions").update({ status: "dismissed" }).eq("id", first!.id).select("id,status").single();
    if (dismissed.error) throw dismissed.error;
    const afterDismissal = await queueWebScopeSuggestion({ familyId, curriculumUnitId: unit.data.id, requestedBy: userId, process: false });
    expect(afterDismissal).toEqual(dismissed.data);
    const refreshed = await queueWebScopeSuggestion({ familyId, curriculumUnitId: unit.data.id, requestedBy: userId, process: false, force: true });
    expect(refreshed).toMatchObject({ status: "queued" });
    expect(refreshed?.id).not.toBe(first?.id);
  });

  it("adopts source-backed pacing without lengthening already scheduled sessions", async () => {
    const unit = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: studentId, created_by: userId, subject: "Science", title: "Container pacing", default_minutes: 30, target_lesson_count: 2, next_sequence_number: 3, schedule_rule: { weeklyFrequency: 5 } }).select("id").single();
    if (unit.error) throw unit.error;
    const assignments = await admin.from("assignments").insert([
      { family_id: familyId, student_id: studentId, created_by: userId, curriculum_unit_id: unit.data.id, subject: "Science", title: "Science · Lesson 1", sequence_number: 1, estimated_minutes: 30, scheduled_date: "2030-01-07", scheduled_time: "09:00" },
      { family_id: familyId, student_id: studentId, created_by: userId, curriculum_unit_id: unit.data.id, subject: "Science", title: "Science · Lesson 2", sequence_number: 2, estimated_minutes: 30 },
    ]).select("id,sequence_number").order("sequence_number");
    if (assignments.error) throw assignments.error;
    const suggestion = await admin.from("curriculum_scope_suggestions").insert({ family_id: familyId, curriculum_unit_id: unit.data.id, requested_by: userId, status: "ready", identity_status: "verified", source_kind: "web_search", source_fingerprint: `container-pacing-${crypto.randomUUID()}`, proposed_target_count: 2, confidence: 0.95, assumptions: [], proposed_items: [{ sequenceNumber: 1, title: "Module 1 · Session 1", kind: "lesson", path: ["Module 1"], minutes: 60, confidence: 0.95 }, { sequenceNumber: 2, title: "Module 1 · Session 2", kind: "lesson", path: ["Module 1"], minutes: 60, confidence: 0.95 }], before_snapshot: { pacing: { sourceGranularity: "container", containerLabel: "Module", containerCount: 1, recommendedWeeklyFrequency: 4, recommendedWeekCount: 1, recommendedSessionCount: 2, minutesPerSession: 60, confidence: 0.95 }, expandedFromContainers: true } }).select("id").single();
    if (suggestion.error) throw suggestion.error;

    await applyCurriculumScopeSuggestion({ supabase: parentClient, suggestionId: suggestion.data.id, parentId: userId, selections: [{ sequenceNumber: 1 }, { sequenceNumber: 2 }] });

    const savedUnit = await admin.from("curriculum_units").select("default_minutes,schedule_rule,sequence_label").eq("id", unit.data.id).single();
    expect(savedUnit.data).toMatchObject({ default_minutes: 60, schedule_rule: { weeklyFrequency: 4 }, sequence_label: "Lesson" });
    const savedAssignments = await admin.from("assignments").select("sequence_number,title,estimated_minutes").eq("curriculum_unit_id", unit.data.id).order("sequence_number");
    expect(savedAssignments.data).toEqual([
      expect.objectContaining({ sequence_number: 1, title: "Module 1 · Session 1", estimated_minutes: 30 }),
      expect.objectContaining({ sequence_number: 2, title: "Module 1 · Session 2", estimated_minutes: 60 }),
    ]);
  });
});
