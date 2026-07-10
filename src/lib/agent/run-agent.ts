import "server-only";

import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { createHash } from "node:crypto";
import { addDays, formatISO } from "date-fns";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { agentArtifactSchema } from "./schemas";

export type AgentIntent = "understand" | "update_records" | "next_step" | "weekly_plan" | "lesson" | "summary" | "practice" | "portfolio";

export async function runKlioAgent(input: {
  familyId: string; studentId: string; evidenceIds: string[]; intent: AgentIntent; parentId: string;
}) {
  if (!serverEnv.openAiApiKey) throw new Error("OPENAI_KEY_REQUIRED");
  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: student, error: studentError }, { data: evidence, error: evidenceError }, { data: observations }, { data: recentArtifacts }] = await Promise.all([
    supabase.from("students").select("id, display_name, grade_band, learning_preferences").eq("id", input.studentId).eq("family_id", input.familyId).single(),
    supabase.from("evidence_items").select("id, kind, title, raw_text, storage_path, mime_type, source_at").eq("family_id", input.familyId).in("id", input.evidenceIds),
    supabase.from("skill_observations").select("subject, skill_label, status, rationale").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("approval_status", "approved").order("created_at", { ascending: false }).limit(25),
    supabase.from("artifacts").select("type, title, summary, content").eq("family_id", input.familyId).eq("student_id", input.studentId).eq("status", "approved").order("created_at", { ascending: false }).limit(5),
  ]);
  if (studentError || !student) throw new Error("STUDENT_NOT_FOUND");
  if (evidenceError || !evidence || evidence.length !== new Set(input.evidenceIds).size) throw new Error("EVIDENCE_NOT_FOUND");

  const { data: run, error: runError } = await supabase.from("agent_runs").insert({
    family_id: input.familyId, requested_by: input.parentId, intent: input.intent,
    model: serverEnv.openAiModel, input_summary: { evidence_ids: input.evidenceIds, student_id: input.studentId },
  }).select("id").single();
  if (runError) throw runError;
  await admin.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", run.id);
  await admin.from("agent_run_evidence").insert(input.evidenceIds.map((id) => ({ agent_run_id: run.id, evidence_id: id, family_id: input.familyId })));

  try {
    const openai = new OpenAI({ apiKey: serverEnv.openAiApiKey });
    const content: ResponseInputContent[] = [{ type: "input_text", text: buildContext({ student, evidence, observations: observations ?? [], recentArtifacts: recentArtifacts ?? [], intent: input.intent }) }];

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

    for (const observation of result.observations) {
      const { data: createdObservation, error } = await admin.from("skill_observations").insert({
        family_id: input.familyId, student_id: input.studentId, author_type: "agent",
        subject: observation.subject, skill_key: observation.skill_key, skill_label: observation.skill_label,
        status: observation.status, confidence: observation.confidence, rationale: observation.rationale,
        uncertainty_flags: observation.uncertainty_flags, approval_status: "draft",
      }).select("id").single();
      if (error) throw error;
      await admin.from("observation_evidence").insert(input.evidenceIds.map((id) => ({ observation_id: createdObservation.id, evidence_id: id, family_id: input.familyId })));
      await admin.from("approval_requests").insert({ family_id: input.familyId, requested_by_run: run.id, entity_type: "skill_observation", entity_id: createdObservation.id });
    }
    await admin.from("approval_requests").insert({ family_id: input.familyId, requested_by_run: run.id, entity_type: "artifact", entity_id: artifact.id });
    await admin.from("evidence_items").update({ processing_status: "ready" }).in("id", input.evidenceIds).eq("family_id", input.familyId);
    await admin.from("agent_runs").update({ status: "completed", completed_at: new Date().toISOString(), output_summary: { artifact_id: artifact.id, observation_count: result.observations.length }, tool_trace: [{ tool: "read_student_context" }, { tool: "create_draft_artifact", artifact_id: artifact.id }] }).eq("id", run.id);
    await writeAuditEvent(admin, { familyId: input.familyId, actorType: "agent", action: "agent.draft_created", entityType: "artifact", entityId: artifact.id, metadata: { run_id: run.id, intent: input.intent, evidence_ids: input.evidenceIds } });
    return { artifactId: artifact.id, runId: run.id };
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
    await admin.from("evidence_items").update({ processing_status: "failed", error_message: "Agent processing failed" }).in("id", input.evidenceIds).eq("family_id", input.familyId);
    if (authenticationFailed) throw new Error("OPENAI_KEY_INVALID");
    throw error;
  }
}

function buildContext({ student, evidence, observations, recentArtifacts, intent }: {
  student: { display_name: string; grade_band: string | null; learning_preferences: string | null };
  evidence: Array<{ id: string; kind: string; title: string | null; raw_text: string | null; source_at: string }>;
  observations: Array<{ subject: string; skill_label: string; status: string; rationale: string }>;
  recentArtifacts: Array<{ type: string; title: string; summary: string | null; content: unknown }>;
  intent: AgentIntent;
}) {
  return JSON.stringify({
    request: intent,
    learner: student,
    selected_evidence: evidence.map((item) => ({ id: item.id, kind: item.kind, title: item.title, raw_text: item.raw_text, source_at: item.source_at })),
    approved_skill_context: observations,
    recent_approved_artifacts: recentArtifacts,
    today: new Date().toISOString(),
  });
}

const KLIO_INSTRUCTIONS = `You are Klio, a capable homeschool-specific agent working for a parent. Turn the selected evidence and durable learner context into the requested useful artifact.

Ground every claim in the supplied evidence or approved context. Never invent completed work, grades, diagnoses, laws, sources, or facts about the learner. Keep siblings distinct. If evidence is weak or ambiguous, state that in uncertainty_flags and ask for a useful next observation. Candidate skill observations must be conservative and source-backed; they are always drafts for parent approval.

Match artifact_type to the request: understand→analysis, next_step→next_step, weekly_plan→weekly_plan, lesson→lesson, practice→practice, summary→summary, portfolio→portfolio. For weekly plans, keep the workload manageable and use day offsets 0–13. For lessons, create practical parent-ready material. Only fill practice when explicitly asked; otherwise set it to null. Never output executable code or HTML.`;
