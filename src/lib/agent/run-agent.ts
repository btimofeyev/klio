import "server-only";

import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { createHash } from "node:crypto";
import { addDays, formatISO } from "date-fns";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { agentArtifactSchema, type AgentArtifact } from "./schemas";

export type AgentIntent = "organize" | "understand" | "update_records" | "next_step" | "weekly_plan" | "lesson" | "summary" | "practice" | "portfolio";

export async function runKlioAgent(input: {
  familyId: string; studentId: string; evidenceIds: string[]; intent: AgentIntent; parentId: string; jobActionId?: string;
}) {
  if (!serverEnv.openAiApiKey) throw new Error("OPENAI_KEY_REQUIRED");
  const admin = createAdminClient();

  const [{ data: family }, { data: student, error: studentError }, { data: evidence, error: evidenceError }, { data: observations }, { data: recentArtifacts }, { data: categories }, { data: corrections }, { data: rejectedObservations }, { data: rejectedArtifacts }] = await Promise.all([
    admin.from("families").select("timezone").eq("id", input.familyId).single(),
    admin.from("students").select("id, display_name, grade_band, learning_preferences").eq("id", input.studentId).eq("family_id", input.familyId).single(),
    admin.from("evidence_items").select("id, kind, title, raw_text, storage_path, mime_type, source_at").eq("family_id", input.familyId).in("id", input.evidenceIds),
    admin.from("skill_observations").select("subject, skill_label, status, rationale").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("approval_status", "approved").order("created_at", { ascending: false }).limit(25),
    admin.from("artifacts").select("type, title, summary, content").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("status", "approved").order("created_at", { ascending: false }).limit(5),
    admin.from("categories").select("name, slug, description").eq("family_id", input.familyId).order("name"),
    admin.from("organization_corrections").select("from_category_name, evidence_title, evidence_excerpt, cues, categories(name, slug)").eq("family_id", input.familyId).order("created_at", { ascending: false }).limit(20),
    admin.from("skill_observations").select("subject, skill_label, rationale, rejection_reason, reviewed_at").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("approval_status", "rejected").order("reviewed_at", { ascending: false }).limit(20),
    admin.from("artifacts").select("type, title, summary, rejection_reason, reviewed_at").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("status", "rejected").order("reviewed_at", { ascending: false }).limit(10),
  ]);
  if (studentError || !student) throw new Error("STUDENT_NOT_FOUND");
  if (evidenceError || !evidence || evidence.length !== new Set(input.evidenceIds).size) throw new Error("EVIDENCE_NOT_FOUND");

  let run: { id: string } | null = null;
  if (input.jobActionId) {
    const { data: existingRun } = await admin.from("agent_runs").select("id").eq("job_action_id", input.jobActionId).maybeSingle();
    run = existingRun;
    if (run) {
      const { data: existingArtifact } = await admin.from("artifacts").select("id").eq("agent_run_id", run.id).maybeSingle();
      if (existingArtifact) return { artifactId: existingArtifact.id, runId: run.id };
    }
  }
  if (!run) {
    const { data: createdRun, error: runError } = await admin.from("agent_runs").insert({
      family_id: input.familyId, requested_by: input.parentId, intent: input.intent,
      model: serverEnv.openAiModel, input_summary: { evidence_ids: input.evidenceIds, student_id: input.studentId },
      job_action_id: input.jobActionId ?? null,
    }).select("id").single();
    if (runError) throw runError;
    run = createdRun;
  }
  if (!run) throw new Error("AGENT_RUN_NOT_CREATED");
  await admin.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", run.id);
  await admin.from("agent_run_evidence").upsert(input.evidenceIds.map((id) => ({ agent_run_id: run.id, evidence_id: id, family_id: input.familyId })), { onConflict: "agent_run_id,evidence_id" });

  try {
    const openai = new OpenAI({ apiKey: serverEnv.openAiApiKey });
    const content: ResponseInputContent[] = [{ type: "input_text", text: buildContext({ student, evidence, observations: observations ?? [], recentArtifacts: recentArtifacts ?? [], categories: categories ?? [], corrections: corrections ?? [], parentReviewCorrections: { observations: rejectedObservations ?? [], artifacts: rejectedArtifacts ?? [] }, intent: input.intent, timezone: family?.timezone ?? "America/New_York" }) }];

    for (const item of evidence) {
      if (!item.storage_path || !item.mime_type) continue;
      const { data: blob, error } = await admin.storage.from("family-evidence").download(item.storage_path);
      if (error) throw error;
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (item.mime_type.startsWith("audio/")) {
        const transcription = await openai.audio.transcriptions.create({
          file: await toFile(bytes, item.title || "voice-note.webm", { type: item.mime_type }),
          model: "gpt-4o-mini-transcribe",
        });
        content[0] = { type: "input_text", text: `${(content[0] as { text: string }).text}\n\nVoice note transcript (${item.id}):\n${transcription.text}` };
        await admin.from("evidence_items").update({ extracted_text: transcription.text, processing_status: "processing" }).eq("id", item.id);
      } else if (item.mime_type.startsWith("image/")) {
        content.push({ type: "input_image", image_url: `data:${item.mime_type};base64,${bytes.toString("base64")}`, detail: "high" });
      } else if (item.mime_type === "application/pdf") {
        content.push({ type: "input_file", filename: item.title || "document.pdf", file_data: `data:${item.mime_type};base64,${bytes.toString("base64")}`, detail: "high" });
      } else if (item.mime_type === "text/csv") {
        content[0] = { type: "input_text", text: `${(content[0] as { text: string }).text}\n\nCSV file (${item.id}):\n${bytes.toString("utf8").slice(0, 100000)}` };
      }
    }

    const response = await openai.responses.parse({
      model: serverEnv.openAiModel,
      store: false,
      reasoning: { effort: "medium" },
      safety_identifier: createHash("sha256").update(input.parentId).digest("hex").slice(0, 32),
      instructions: KLIO_INSTRUCTIONS,
      input: [{ role: "user", content }],
      text: { format: zodTextFormat(agentArtifactSchema, "klio_artifact"), verbosity: "medium" },
    });
    const result = response.output_parsed;
    if (!result) throw new Error("MODEL_OUTPUT_INVALID");

    const categoryName = cleanCategoryName(result.organization.category_name);
    const categorySlug = slugifyCategory(categoryName);
    const tags = [...new Set(result.organization.tags.map(cleanTag).filter(Boolean))].slice(0, 8);
    const documentType = result.organization.document_type.trim().slice(0, 80) || "Record";
    const categoryDescription = `${categoryName} learning records and source evidence.`;
    const { error: categoryUpsertError } = await admin.from("categories").upsert({
      family_id: input.familyId,
      name: categoryName,
      slug: categorySlug,
      description: categoryDescription,
      created_by_type: "agent",
      created_by: input.parentId,
    }, { onConflict: "family_id,slug" });
    if (categoryUpsertError) throw categoryUpsertError;
    const { data: category, error: categoryError } = await admin.from("categories")
      .select("id")
      .eq("family_id", input.familyId)
      .eq("slug", categorySlug)
      .single();
    if (categoryError || !category) throw categoryError ?? new Error("CATEGORY_NOT_CREATED");
    const { error: evidenceCategoryError } = await admin.from("evidence_categories").upsert(
      input.evidenceIds.map((evidenceId) => ({
        family_id: input.familyId,
        evidence_id: evidenceId,
        category_id: category.id,
        assigned_by: "agent",
        confidence: result.organization.confidence,
        document_type: documentType,
        tags,
      })),
      { onConflict: "evidence_id,category_id" },
    );
    if (evidenceCategoryError) throw evidenceCategoryError;

    const reminderIds = await persistReminders(admin, {
      familyId: input.familyId,
      studentId: input.studentId,
      runId: run.id,
      parentId: input.parentId,
      evidenceId: input.evidenceIds[0],
      reminders: result.reminders,
    });

    if (input.intent === "organize") {
      await admin.from("evidence_items").update({ processing_status: "ready", error_message: null }).in("id", input.evidenceIds).eq("family_id", input.familyId);
      await admin.from("agent_runs").update({ status: "completed", completed_at: new Date().toISOString(), output_summary: { category_id: category.id, reminder_ids: reminderIds }, tool_trace: [{ tool: "read_evidence" }, { tool: "organize_evidence", category_id: category.id }, { tool: "create_reminders", reminder_ids: reminderIds }] }).eq("id", run.id);
      await writeAuditEvent(admin, { familyId: input.familyId, actorType: "agent", action: "evidence.organized", entityType: "category", entityId: category.id, metadata: { run_id: run.id, evidence_ids: input.evidenceIds } });
      return { artifactId: null, runId: run.id, categoryId: category.id, categoryName };
    }

    const { data: artifact, error: artifactError } = await admin.from("artifacts").insert({
      family_id: input.familyId, student_id: input.studentId, agent_run_id: run.id,
      created_by: input.parentId, type: result.artifact_type, title: result.title,
      summary: result.summary, rationale: result.rationale,
      content: { ...result.content, uncertainty_flags: result.uncertainty_flags }, status: "draft",
    }).select("id").single();
    if (artifactError) throw artifactError;
    await admin.from("artifact_sources").insert(input.evidenceIds.map((id) => ({ artifact_id: artifact.id, evidence_id: id, family_id: input.familyId })));

    if (result.content.plan_items.length) {
      await admin.from("weekly_plan_items").insert(result.content.plan_items.map((item, position) => ({
        family_id: input.familyId, artifact_id: artifact.id, student_id: input.studentId,
        scheduled_date: item.day_offset === null ? null : formatISO(addDays(new Date(), item.day_offset), { representation: "date" }),
        position, title: item.title, description: item.description,
        estimated_minutes: item.estimated_minutes, subject: item.subject, skill_key: item.skill_key,
      })));
    }

    let observationCount = 0;
    for (const observation of result.observations) {
      const observationId = await persistObservation(admin, {
        familyId: input.familyId, studentId: input.studentId, runId: run.id,
        evidenceIds: input.evidenceIds, observation,
      });
      if (observationId) observationCount += 1;
    }
    await admin.from("approval_requests").insert({ family_id: input.familyId, requested_by_run: run.id, entity_type: "artifact", entity_id: artifact.id });
    await admin.from("evidence_items").update({ processing_status: "ready" }).in("id", input.evidenceIds).eq("family_id", input.familyId);
    await admin.from("agent_runs").update({ status: "completed", completed_at: new Date().toISOString(), output_summary: { artifact_id: artifact.id, observation_count: observationCount, category_id: category.id, reminder_ids: reminderIds }, tool_trace: [{ tool: "read_student_context" }, { tool: "organize_evidence", category_id: category.id }, { tool: "create_reminders", reminder_ids: reminderIds }, { tool: "create_draft_artifact", artifact_id: artifact.id }] }).eq("id", run.id);
    await writeAuditEvent(admin, { familyId: input.familyId, actorType: "agent", action: "agent.draft_created", entityType: "artifact", entityId: artifact.id, metadata: { run_id: run.id, intent: input.intent, evidence_ids: input.evidenceIds } });
    return { artifactId: artifact.id, runId: run.id, categoryId: category.id, categoryName };
  } catch (error) {
    const authenticationFailed = error instanceof OpenAI.AuthenticationError;
    const code = authenticationFailed
      ? "OPENAI_AUTHENTICATION_FAILED"
      : error instanceof OpenAI.APIError
        ? `OPENAI_API_${error.status ?? "ERROR"}`
        : error instanceof Error
          ? error.message.slice(0, 120)
          : "UNKNOWN";
    await admin.from("agent_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_code: code }).eq("id", run.id);
    if (authenticationFailed) throw new Error("OPENAI_KEY_INVALID");
    throw error;
  }
}

async function persistReminders(admin: ReturnType<typeof createAdminClient>, input: {
  familyId: string;
  studentId: string;
  runId: string;
  parentId: string;
  evidenceId: string;
  reminders: AgentArtifact["reminders"];
}) {
  const ids: string[] = [];
  for (const reminder of input.reminders) {
    const title = reminder.title.trim().slice(0, 200);
    if (!title) continue;
    const parsedDueAt = reminder.due_at ? new Date(reminder.due_at) : null;
    const dueAt = parsedDueAt && !Number.isNaN(parsedDueAt.getTime()) ? parsedDueAt.toISOString() : null;
    const values = {
      student_id: input.studentId,
      agent_run_id: input.runId,
      notes: reminder.notes.trim().slice(0, 2000) || null,
      due_at: dueAt,
      confidence: reminder.confidence,
      rationale: reminder.rationale.trim().slice(0, 2000),
    };
    const { data: existing, error: findError } = await admin.from("reminders")
      .select("id")
      .eq("family_id", input.familyId)
      .eq("source_evidence_id", input.evidenceId)
      .eq("status", "pending")
      .ilike("title", title)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) {
      const { error } = await admin.from("reminders").update(values).eq("id", existing.id);
      if (error) throw error;
      ids.push(existing.id);
      continue;
    }
    const { data: created, error } = await admin.from("reminders").insert({
      family_id: input.familyId,
      source_evidence_id: input.evidenceId,
      title,
      created_by_type: "agent",
      created_by: input.parentId,
      ...values,
    }).select("id").single();
    if (error?.code === "23505") {
      const { data: concurrent, error: concurrentError } = await admin.from("reminders")
        .select("id")
        .eq("family_id", input.familyId)
        .eq("source_evidence_id", input.evidenceId)
        .eq("status", "pending")
        .ilike("title", title)
        .single();
      if (concurrentError) throw concurrentError;
      ids.push(concurrent.id);
    } else if (error) throw error;
    else ids.push(created.id);
  }
  return ids;
}

async function persistObservation(admin: ReturnType<typeof createAdminClient>, input: {
  familyId: string;
  studentId: string;
  runId: string;
  evidenceIds: string[];
  observation: AgentArtifact["observations"][number];
}) {
  const skillKey = input.observation.skill_key.trim().toLowerCase().slice(0, 160);
  const { data: candidates, error: candidateError } = await admin.from("skill_observations")
    .select("id, status, approval_status")
    .eq("family_id", input.familyId)
    .eq("student_id", input.studentId)
    .ilike("skill_key", skillKey)
    .in("approval_status", ["draft", "approved"])
    .order("updated_at", { ascending: false });
  if (candidateError) throw candidateError;

  const draft = candidates?.find((candidate) => candidate.approval_status === "draft");
  const approved = candidates?.find((candidate) => candidate.approval_status === "approved");
  if (!draft && approved?.status === input.observation.status) return null;

  const values = {
    subject: input.observation.subject.trim().slice(0, 80),
    skill_key: skillKey,
    skill_label: input.observation.skill_label.trim().slice(0, 200),
    status: input.observation.status,
    confidence: input.observation.confidence,
    rationale: input.observation.rationale,
    uncertainty_flags: input.observation.uncertainty_flags,
  };

  let observationId = draft?.id ?? null;
  if (observationId) {
    const { error } = await admin.from("skill_observations").update(values).eq("id", observationId);
    if (error) throw error;
  } else {
    const created = await admin.from("skill_observations").insert({
      family_id: input.familyId,
      student_id: input.studentId,
      author_type: "agent",
      approval_status: "draft",
      ...values,
    }).select("id").single();
    if (created.error?.code === "23505") {
      const { data: concurrentDraft, error } = await admin.from("skill_observations")
        .select("id")
        .eq("family_id", input.familyId)
        .eq("student_id", input.studentId)
        .ilike("skill_key", skillKey)
        .eq("approval_status", "draft")
        .single();
      if (error) throw error;
      observationId = concurrentDraft.id;
      const { error: updateError } = await admin.from("skill_observations").update(values).eq("id", observationId);
      if (updateError) throw updateError;
    } else if (created.error) {
      throw created.error;
    } else {
      observationId = created.data.id;
    }
  }

  if (!observationId) return null;
  const { error: evidenceLinkError } = await admin.from("observation_evidence").upsert(
    input.evidenceIds.map((evidenceId) => ({ observation_id: observationId!, evidence_id: evidenceId, family_id: input.familyId })),
    { onConflict: "observation_id,evidence_id" },
  );
  if (evidenceLinkError) throw evidenceLinkError;

  const { data: pendingRequest } = await admin.from("approval_requests")
    .select("id")
    .eq("family_id", input.familyId)
    .eq("entity_type", "skill_observation")
    .eq("entity_id", observationId)
    .eq("status", "pending")
    .maybeSingle();
  if (!pendingRequest) {
    const { error } = await admin.from("approval_requests").insert({
      family_id: input.familyId,
      requested_by_run: input.runId,
      entity_type: "skill_observation",
      entity_id: observationId,
    });
    if (error) throw error;
  }
  return observationId;
}

export function buildContext({ student, evidence, observations, recentArtifacts, categories, corrections, parentReviewCorrections, intent, timezone }: {
  student: { display_name: string; grade_band: string | null; learning_preferences: string | null };
  evidence: Array<{ id: string; kind: string; title: string | null; raw_text: string | null; source_at: string }>;
  observations: Array<{ subject: string; skill_label: string; status: string; rationale: string }>;
  recentArtifacts: Array<{ type: string; title: string; summary: string | null; content: unknown }>;
  categories: Array<{ name: string; slug: string; description: string | null }>;
  corrections: Array<{ from_category_name: string | null; evidence_title: string | null; evidence_excerpt: string | null; cues: string[]; categories: { name: string; slug: string } }>;
  parentReviewCorrections: {
    observations: Array<{ subject: string; skill_label: string; rationale: string; rejection_reason: string | null; reviewed_at: string | null }>;
    artifacts: Array<{ type: string; title: string; summary: string | null; rejection_reason: string | null; reviewed_at: string | null }>;
  };
  intent: AgentIntent;
  timezone: string;
}) {
  return JSON.stringify({
    request: intent,
    learner: student,
    selected_evidence: evidence.map((item) => ({ id: item.id, kind: item.kind, title: item.title, raw_text: item.raw_text, source_at: item.source_at })),
    approved_skill_context: observations,
    recent_approved_artifacts: recentArtifacts,
    existing_family_categories: categories,
    parent_filing_corrections: corrections.map((correction) => ({
      previous_category: correction.from_category_name,
      corrected_category: correction.categories,
      evidence_title: correction.evidence_title,
      evidence_excerpt: correction.evidence_excerpt,
      cues: correction.cues,
    })),
    parent_review_corrections: {
      observations: parentReviewCorrections.observations.map((item) => ({
        subject: item.subject, rejected_conclusion: item.skill_label, rejected_summary: item.rationale,
        correction: parseReviewReason(item.rejection_reason), reviewed_at: item.reviewed_at,
      })),
      artifacts: parentReviewCorrections.artifacts.map((item) => ({
        type: item.type, rejected_title: item.title, rejected_summary: item.summary,
        correction: parseReviewReason(item.rejection_reason), reviewed_at: item.reviewed_at,
      })),
    },
    current_datetime: new Date().toISOString(),
    family_timezone: timezone,
  });
}

export function parseReviewReason(value: string | null): { code: string; detail?: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.code !== "string") return null;
    return { code: record.code, ...(typeof record.detail === "string" ? { detail: record.detail } : {}) };
  } catch { return null; }
}

const KLIO_INSTRUCTIONS = `You are Klio, a capable homeschool-specific agent working for a parent. Turn the selected evidence and durable learner context into the requested useful artifact.

Ground every claim in the supplied evidence or approved context. Never invent completed work, grades, diagnoses, laws, sources, or facts about the learner. Keep siblings distinct. If evidence is weak or ambiguous, state that in uncertainty_flags and ask for a useful next observation. Candidate skill observations must be conservative and source-backed; they are always drafts for parent approval.

Parent review corrections are authoritative negative examples for this learner. Do not repeat a rejected conclusion or draft unless materially new evidence supports it. A wrong_learner correction must never become context for this learner; parent_or_sibling_helped means the work cannot establish independent mastery; not_enough_information is a constraint to gather more evidence, never a learner fact. Follow correction detail when supplied, but do not quote it unnecessarily.

Always organize the selected evidence into one stable, broad curriculum category. Reuse an existing family category when it fits. Parent filing corrections are authoritative examples; follow their pattern when the new evidence has similar cues. Prefer durable folders such as History, Math, Science, Language Arts, Reading, Writing, Art, Music, Physical Education, Life Skills, Field Trips, or General—not narrow one-off topics. A history chapter review belongs in History, with Review as its document type and specific topics as tags. Keep tags short, useful for search, and free of duplicates. The organization rationale should briefly explain the filing choice.

Extract genuine parent obligations as reminders whenever the capture uses actionable future language such as “I need to,” “remember to,” “we should,” or gives a deadline. Do not turn completed work, observations, or generic teaching suggestions into reminders. Use a concise verb-first title. Preserve useful context in notes. Resolve relative dates from current_datetime in family_timezone; “for the week” means by the upcoming Friday at 5:00 PM local time. Return due_at as an ISO 8601 timestamp with an offset, or null when the capture gives no reasonable timing. Reminders are saved immediately and do not need draft approval.

Match artifact_type to the request: organize→analysis, understand→analysis, next_step→next_step, weekly_plan→weekly_plan, lesson→lesson, practice→practice, summary→summary, portfolio→portfolio. For organize requests, classification is the only output that will be kept. For weekly plans, keep the workload manageable and use day offsets 0–13. For lessons, create practical parent-ready material. Only fill practice when explicitly asked; otherwise set it to null. Never output executable code or HTML.`;

function cleanCategoryName(value: string) {
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return cleaned || "General";
}

function slugifyCategory(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "general";
}

function cleanTag(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}
