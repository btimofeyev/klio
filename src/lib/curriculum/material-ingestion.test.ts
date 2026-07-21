import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { applyCurriculumMaterialSuggestion, materialSuggestionSchema, processCurriculumMaterialSuggestion } from "./material-ingestion";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let client: SupabaseClient<Database>;
let userId = "";
let familyId = "";
let studentId = "";
let unitId = "";
let assignmentId = "";
const password = "KlioMaterial123";

beforeAll(async () => {
  const email = `material-ingestion-${crypto.randomUUID()}@example.test`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Material ingestion family", created_by: userId, timezone: "UTC", available_days: ["Mon"] }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const member = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  if (member.error) throw member.error;
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "Material learner", daily_capacity_minutes: 60, schedule_preferences: { learningDays: ["Mon"], teachingWindows: { Mon: { start: "09:00", end: "10:00" } } } }).select("id").single();
  if (student.error) throw student.error;
  studentId = student.data.id;
  const unit = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: studentId, created_by: userId, subject: "Science", title: "Material Science" }).select("id").single();
  if (unit.error) throw unit.error;
  unitId = unit.data.id;
  const assignment = await admin.from("assignments").insert({ family_id: familyId, student_id: studentId, curriculum_unit_id: unitId, created_by: userId, title: "Material Science · Lesson 1", subject: "Science", sequence_number: 1, estimated_minutes: 30, curriculum_item_kind: "lesson", curriculum_item_state: "placeholder" }).select("id").single();
  if (assignment.error) throw assignment.error;
  assignmentId = assignment.data.id;
  client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("curriculum material ingestion", () => {
  it("enforces bounded strict structured output", () => {
    expect(materialSuggestionSchema.safeParse(validSuggestion()).success).toBe(true);
    expect(materialSuggestionSchema.safeParse({ ...validSuggestion(), unsupportedClaim: "exact edition" }).success).toBe(false);
    expect(materialSuggestionSchema.safeParse({ ...validSuggestion(), instructions: "x".repeat(1001) }).success).toBe(false);
  });

  it("preserves the private source and material relation when OpenAI is not configured", async () => {
    const record = await createSuggestion({ attachMaterial: true });
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await processCurriculumMaterialSuggestion(record.suggestionId);
    vi.unstubAllEnvs();
    expect(result).toMatchObject({ status: "failed", error_code: "OPENAI_KEY_REQUIRED" });
    expect((await admin.from("evidence_items").select("id").eq("id", record.evidenceId).single()).data?.id).toBe(record.evidenceId);
    expect((await admin.from("assignment_materials").select("evidence_id").eq("assignment_id", assignmentId).eq("evidence_id", record.evidenceId).single()).data?.evidence_id).toBe(record.evidenceId);
    expect((await admin.from("assignment_submission_evidence").select("evidence_id").eq("evidence_id", record.evidenceId)).data).toEqual([]);
  });

  it("reads a private image, rejects invalid output, and retries idempotently", async () => {
    const path = `${familyId}/${crypto.randomUUID()}/teacher-page.png`;
    const upload = await admin.storage.from("family-evidence").upload(path, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { contentType: "image/png" });
    if (upload.error) throw upload.error;
    const record = await createSuggestion({ storagePath: path, mimeType: "image/png", fileSize: 4 });
    const failed = await processCurriculumMaterialSuggestion(record.suggestionId, { extract: async ({ content }) => {
      expect(content.some((item) => item.type === "input_image")).toBe(true);
      return { title: "missing required fields" };
    } });
    expect(failed).toMatchObject({ status: "failed", error_code: "MODEL_OUTPUT_INVALID" });
    const ready = await processCurriculumMaterialSuggestion(record.suggestionId, { extract: async () => validSuggestion() });
    expect(ready).toMatchObject({ status: "ready", proposed_title: "Cells and their jobs", proposed_kind: "lesson" });
    const idempotent = await processCurriculumMaterialSuggestion(record.suggestionId, { extract: async () => { throw new Error("should not run"); } });
    expect(idempotent.status).toBe("ready");
  });

  it("applies confirmed descriptive fields to the stable unscheduled assignment", async () => {
    const record = await createSuggestion({ status: "ready", proposed: validSuggestion() });
    const result = await applyCurriculumMaterialSuggestion({ supabase: client, suggestionId: record.suggestionId, parentId: userId });
    expect(result).toMatchObject({ applied: true, historicalProtected: false });
    const assignment = await admin.from("assignments").select("id,title,instructions,estimated_minutes,curriculum_item_kind,curriculum_item_state,curriculum_path").eq("id", assignmentId).single();
    expect(assignment.data).toMatchObject({ id: assignmentId, title: "Cells and their jobs", estimated_minutes: 25, curriculum_item_kind: "lesson", curriculum_item_state: "enriched", curriculum_path: ["Unit 1"] });
  });

  it("rejects stale decisions", async () => {
    const staleAssignment = await createAssignment({ sequence: 2 });
    const record = await createSuggestion({ assignment: staleAssignment, status: "ready", proposed: validSuggestion(), beforeVersion: 1 });
    await admin.from("assignments").update({ version: 2 }).eq("id", staleAssignment);
    await expect(applyCurriculumMaterialSuggestion({ supabase: client, suggestionId: record.suggestionId, parentId: userId })).rejects.toThrow("MATERIAL_SUGGESTION_STALE");
  });

  it("protects historical assignment fields while retaining the material", async () => {
    const historicalAssignment = await createAssignment({ sequence: 3, status: "completed", title: "Historical title" });
    const record = await createSuggestion({ assignment: historicalAssignment, status: "ready", proposed: validSuggestion(), attachMaterial: true });
    const result = await applyCurriculumMaterialSuggestion({ supabase: client, suggestionId: record.suggestionId, parentId: userId });
    expect(result).toMatchObject({ applied: true, historicalProtected: true, changedFields: [] });
    expect((await admin.from("assignments").select("title").eq("id", historicalAssignment).single()).data?.title).toBe("Historical title");
    expect((await admin.from("assignment_materials").select("evidence_id").eq("assignment_id", historicalAssignment)).data).toHaveLength(1);
  });

  it("rejects a scheduled duration that no longer fits", async () => {
    const scheduledAssignment = await createAssignment({ sequence: 4, scheduledDate: "2026-07-20", scheduledTime: "09:00", minutes: 30 });
    const record = await createSuggestion({ assignment: scheduledAssignment, status: "ready", proposed: { ...validSuggestion(), minutes: 120 } });
    await expect(applyCurriculumMaterialSuggestion({ supabase: client, suggestionId: record.suggestionId, parentId: userId })).rejects.toThrow("SCHEDULE_EXCEEDS_AVAILABLE_TIME");
    expect((await admin.from("assignments").select("estimated_minutes").eq("id", scheduledAssignment).single()).data?.estimated_minutes).toBe(30);
  });
});

function validSuggestion() {
  return { title: "Cells and their jobs", itemKind: "lesson" as const, instructions: "Review the diagram and discuss each cell part.", minutes: 25, path: ["Unit 1"], confidence: 0.86, rationale: "The source labels a lesson on cell parts.", uncertaintyFlags: ["Page order was not supplied."] };
}

async function createAssignment(input: { sequence: number; status?: "planned" | "completed"; title?: string; scheduledDate?: string; scheduledTime?: string; minutes?: number }) {
  const row = await admin.from("assignments").insert({
    family_id: familyId, student_id: studentId, curriculum_unit_id: unitId, created_by: userId,
    title: input.title ?? `Material Science · Lesson ${input.sequence}`, subject: "Science", sequence_number: input.sequence,
    estimated_minutes: input.minutes ?? 30, status: input.status ?? "planned", scheduled_date: input.scheduledDate ?? null,
    scheduled_time: input.scheduledTime ?? null, curriculum_item_kind: "lesson", curriculum_item_state: "placeholder",
    completed_at: input.status === "completed" ? new Date().toISOString() : null,
  }).select("id").single();
  if (row.error) throw row.error;
  return row.data.id;
}

async function createSuggestion(input: {
  assignment?: string;
  status?: "queued" | "ready";
  proposed?: ReturnType<typeof validSuggestion>;
  beforeVersion?: number;
  attachMaterial?: boolean;
  storagePath?: string;
  mimeType?: string;
  fileSize?: number;
} = {}) {
  const targetAssignment = input.assignment ?? assignmentId;
  const evidence = await admin.from("evidence_items").insert({ family_id: familyId, created_by: userId, kind: input.storagePath ? "photo" : "note", title: "Private teacher source", raw_text: input.storagePath ? null : "A lesson about cells and their jobs.", storage_path: input.storagePath ?? null, mime_type: input.mimeType ?? null, file_size: input.fileSize ?? null }).select("id").single();
  if (evidence.error) throw evidence.error;
  if (input.attachMaterial) {
    const material = await admin.from("assignment_materials").insert({ family_id: familyId, assignment_id: targetAssignment, evidence_id: evidence.data.id });
    if (material.error) throw material.error;
  }
  const proposed = input.proposed;
  const suggestion = await admin.from("curriculum_material_suggestions").insert({
    family_id: familyId, assignment_id: targetAssignment, evidence_id: evidence.data.id, requested_by: userId,
    status: input.status ?? "queued", before_snapshot: { version: input.beforeVersion ?? 1 },
    proposed_title: proposed?.title, proposed_kind: proposed?.itemKind, proposed_instructions: proposed?.instructions,
    proposed_minutes: proposed?.minutes, proposed_path: proposed?.path, confidence: proposed?.confidence,
    rationale: proposed?.rationale, uncertainty_flags: proposed?.uncertaintyFlags,
  }).select("id").single();
  if (suggestion.error) throw suggestion.error;
  return { evidenceId: evidence.data.id, suggestionId: suggestion.data.id };
}
