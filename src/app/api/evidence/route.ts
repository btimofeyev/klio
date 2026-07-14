import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentApi } from "@/lib/auth/require-parent";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { enqueueAgentJob, safelyProcessAgentJob } from "@/lib/agent/jobs";
import type { AgentIntent } from "@/lib/agent/run-agent";
import { DEFAULT_CAPTURE_INTENT } from "@/lib/agent/intents";
import { enqueueWorkspaceTurn } from "@/lib/agent/workspace/turns";
import { processWorkspaceTurn } from "@/lib/agent/workspace/runtime";
import { serverEnv } from "@/lib/env";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

const inputSchema = z.object({ familyId: z.uuid(), studentId: z.uuid(), assignmentId: z.uuid().optional(), text: z.string().max(20000).optional(), kind: z.enum(["note", "grade", "book", "activity"]).default("note") });
const intentsSchema = z.array(z.enum(["organize", "understand", "update_records", "next_step", "weekly_plan", "lesson", "summary", "practice", "portfolio"])).min(1).max(3);
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/webm", "audio/mpeg", "audio/mp4", "audio/wav", "text/csv"]);

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const rate = checkRateLimit(`evidence:${parent.id}`, 30, 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many captures. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    const form = await request.formData();
    const parsed = inputSchema.safeParse({
      familyId: form.get("familyId"), studentId: form.get("studentId"), assignmentId: typeof form.get("assignmentId") === "string" && form.get("assignmentId") ? form.get("assignmentId") : undefined,
      text: typeof form.get("text") === "string" ? form.get("text") : undefined,
      kind: typeof form.get("kind") === "string" ? form.get("kind") : "note",
    });
    if (!parsed.success) return NextResponse.json({ error: "The capture is missing required details." }, { status: 400 });
    let intentInput: unknown = [DEFAULT_CAPTURE_INTENT];
    try { intentInput = JSON.parse(typeof form.get("intents") === "string" ? String(form.get("intents")) : JSON.stringify([DEFAULT_CAPTURE_INTENT])); } catch { intentInput = null; }
    const intents = intentsSchema.safeParse(intentInput);
    if (!intents.success) return NextResponse.json({ error: "Choose one to three Klio actions." }, { status: 400 });

    const files = form.getAll("file").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length && !parsed.data.text?.trim()) return NextResponse.json({ error: "Add a note, photo, voice clip, or file." }, { status: 400 });
    if (files.length > 10) return NextResponse.json({ error: "You can attach up to 10 files at once." }, { status: 400 });
    if (files.some((file) => file.size > 50 * 1024 * 1024 || !allowedTypes.has(file.type))) {
      return NextResponse.json({ error: "That file type or size is not supported." }, { status: 400 });
    }

    const supabase = await createClient();
    const [{ data: membership }, { data: learners }] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("students").select("id, display_name").eq("family_id", parsed.data.familyId).eq("active", true),
    ]);
    if (!membership || !learners?.some((learner) => learner.id === parsed.data.studentId)) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });
    const linkedAssignment = parsed.data.assignmentId
      ? await supabase.from("assignments").select("id,student_id,title,subject").eq("id", parsed.data.assignmentId).eq("family_id", parsed.data.familyId).maybeSingle()
      : { data: null, error: null };
    if (linkedAssignment.error) throw linkedAssignment.error;
    if (parsed.data.assignmentId && !linkedAssignment.data) return NextResponse.json({ error: "That lesson is not available in this family workspace." }, { status: 404 });
    const text = parsed.data.text?.trim() || null;
    const namedLearner = text ? inferNamedLearner(text, learners) : null;
    const effectiveStudentId = linkedAssignment.data?.student_id ?? namedLearner?.id ?? parsed.data.studentId;

    const captures = files.length ? files.map((file) => ({ id: crypto.randomUUID(), file })) : [{ id: crypto.randomUUID(), file: null }];
    const storagePaths: string[] = [];
    for (const { id, file } of captures) {
      if (!file) continue;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "capture";
      const storagePath = `${parsed.data.familyId}/${id}/${safeName}`;
      const { error: uploadError } = await supabase.storage.from("family-evidence").upload(storagePath, file, { upsert: false, contentType: file.type });
      if (uploadError) {
        if (storagePaths.length) await supabase.storage.from("family-evidence").remove(storagePaths);
        return NextResponse.json({ error: uploadError.message }, { status: 400 });
      }
      storagePaths.push(storagePath);
    }

    const captureSubmissionId = crypto.randomUUID();
    const evidence = captures.map(({ id, file }, index) => ({
      id, family_id: parsed.data.familyId, created_by: parent.id, kind: file ? inferKind(file) : parsed.data.kind,
      title: (index === 0 ? text?.slice(0, 120) : null) || file?.name || null,
      raw_text: index === 0 ? text : null, storage_path: file ? storagePaths[index] : null,
      capture_submission_id: captureSubmissionId,
      mime_type: file?.type || null, file_size: file?.size || null,
      provenance: { source: "klio_inbox", original_filename: file?.name ?? null, assignment_id: linkedAssignment.data?.id ?? null },
    }));
    const { error: evidenceError } = await supabase.from("evidence_items").insert(evidence);
    if (evidenceError) {
      if (storagePaths.length) await supabase.storage.from("family-evidence").remove(storagePaths);
      return NextResponse.json({ error: evidenceError.message }, { status: 400 });
    }

    const ids = captures.map(({ id }) => id);
    const { error: linkError } = await supabase.from("evidence_students").insert(ids.map((id) => ({ evidence_id: id, student_id: effectiveStudentId, family_id: parsed.data.familyId })));
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 400 });

    await writeAuditEvent(createAdminClient(), {
      familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent",
      action: "evidence.captured", entityType: "evidence_item", entityId: ids[0],
      metadata: { item_count: ids.length, has_file: Boolean(files.length), has_text: Boolean(text), selected_student_id: parsed.data.studentId, resolved_student_id: effectiveStudentId, assignment_id: linkedAssignment.data?.id ?? null },
    });
    if (linkedAssignment.data) {
      const admin = createAdminClient();
      const slug = slugify(linkedAssignment.data.subject);
      const { error: categoryUpsertError } = await admin.from("categories").upsert({
        family_id: parsed.data.familyId,
        name: linkedAssignment.data.subject,
        slug,
        description: `${linkedAssignment.data.subject} learning records and source evidence.`,
        created_by_type: "parent",
        created_by: parent.id,
      }, { onConflict: "family_id,slug" });
      if (categoryUpsertError) throw categoryUpsertError;
      const { data: category, error: categoryError } = await admin.from("categories").select("id,name").eq("family_id", parsed.data.familyId).eq("slug", slug).single();
      if (categoryError) throw categoryError;
      const { error: filingError } = await admin.from("evidence_categories").insert(ids.map((evidenceId) => ({
        family_id: parsed.data.familyId,
        evidence_id: evidenceId,
        category_id: category.id,
        assigned_by: "parent",
        document_type: "Assignment work",
        tags: [linkedAssignment.data!.title],
        confidence: 1,
      })));
      if (filingError) throw filingError;
      const { error: readyError } = await admin.from("evidence_items").update({ capture_route: "learning", processing_status: "ready" }).eq("family_id", parsed.data.familyId).in("id", ids);
      if (readyError) throw readyError;
      await writeAuditEvent(admin, { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "evidence.linked_to_assignment", entityType: "assignment", entityId: linkedAssignment.data.id, metadata: { evidence_ids: ids, student_id: effectiveStudentId, subject: linkedAssignment.data.subject } });
      return NextResponse.json({ id: ids[0], ids, status: "ready", job: null, category, studentId: effectiveStudentId, assignmentId: linkedAssignment.data.id }, { status: 201 });
    }
    const explicitSubject = files.length && text ? inferSubject(text) : null;
    if (explicitSubject) {
      const admin = createAdminClient();
      const slug = slugify(explicitSubject);
      const { error: categoryUpsertError } = await admin.from("categories").upsert({
        family_id: parsed.data.familyId,
        name: explicitSubject,
        slug,
        description: `${explicitSubject} learning records and source evidence.`,
        created_by_type: "parent",
        created_by: parent.id,
      }, { onConflict: "family_id,slug" });
      if (categoryUpsertError) throw categoryUpsertError;
      const { data: category, error: categoryError } = await admin.from("categories").select("id, name").eq("family_id", parsed.data.familyId).eq("slug", slug).single();
      if (categoryError) throw categoryError;
      const { error: filingError } = await admin.from("evidence_categories").insert(ids.map((evidenceId) => ({
        family_id: parsed.data.familyId,
        evidence_id: evidenceId,
        category_id: category.id,
        assigned_by: "parent",
        document_type: "File",
        tags: [],
        confidence: 1,
      })));
      if (filingError) throw filingError;
      const { error: readyError } = await admin.from("evidence_items").update({ capture_route: "learning", processing_status: "ready" }).eq("family_id", parsed.data.familyId).in("id", ids);
      if (readyError) throw readyError;
      await writeAuditEvent(admin, { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "evidence.organized_from_label", entityType: "category", entityId: category.id, metadata: { evidence_ids: ids, student_id: effectiveStudentId, subject: explicitSubject } });
      return NextResponse.json({ id: ids[0], ids, status: "ready", job: null, category, studentId: effectiveStudentId }, { status: 201 });
    }
    if (serverEnv.klioAgentRuntime === "codex_app_server") {
      const idempotencyKey = `capture:${createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 32)}:v1`;
      const workspace = await enqueueWorkspaceTurn({ familyId: parsed.data.familyId, requestedBy: parent.id, evidenceIds: ids, studentId: effectiveStudentId, trigger: "capture", goal: "capture", idempotencyKey });
      if (serverEnv.klioAgentInline && !workspace.duplicate) after(() => processWorkspaceTurn(workspace.turn.id));
      return NextResponse.json({ id: ids[0], ids, status: workspace.turn.status, turn: workspace.turn, studentId: effectiveStudentId }, { status: 201 });
    }
    const job = await enqueueAgentJob({
      familyId: parsed.data.familyId,
      parentId: parent.id,
      studentId: effectiveStudentId,
      evidenceIds: ids,
      intents: intents.data as AgentIntent[],
    });
    after(() => safelyProcessAgentJob(job.id));
    return NextResponse.json({ id: ids[0], ids, status: "queued", job, studentId: effectiveStudentId }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (error instanceof Error && (error.message === "aborted" || "code" in error && error.code === "ECONNRESET")) return NextResponse.json({ error: "Those files are too large to upload together. Try fewer files at a time." }, { status: 413 });
    return NextResponse.json({ error: "Klio could not save this capture." }, { status: 500 });
  }
}

function inferKind(file: File | null) {
  if (!file) return "note" as const;
  if (file.type.startsWith("image/")) return "photo" as const;
  if (file.type.startsWith("audio/")) return "voice" as const;
  if (file.type === "text/csv") return "csv_import" as const;
  return "document" as const;
}

function inferNamedLearner(text: string, learners: Array<{ id: string; display_name: string }>) {
  const matches = learners.filter((learner) => {
    const name = learner.display_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!name) return false;
    const pattern = name.split(/\s+/).map(escapeRegex).join("\\s+");
    return new RegExp(`\\b${pattern}(?:['’]?s)?\\b`, "i").test(text);
  });
  return matches.length === 1 ? matches[0] : null;
}

function inferSubject(text: string) {
  const subjects: Array<[string, RegExp]> = [
    ["English", /\b(?:english|language arts?)\b/i],
    ["Reading", /\breading\b/i],
    ["Writing", /\bwriting\b/i],
    ["Math", /\b(?:math|maths|mathematics|algebra|geometry)\b/i],
    ["Science", /\bscience\b/i],
    ["History", /\b(?:history|social studies)\b/i],
    ["Arts", /\b(?:art|arts|music)\b/i],
    ["Life Skills", /\blife skills?\b/i],
  ];
  return subjects.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
