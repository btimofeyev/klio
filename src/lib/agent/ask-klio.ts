import "server-only";

import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const answerSchema = z.object({
  answer: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  source_keys: z.array(z.string()).max(8),
  follow_up: z.string().nullable(),
});

type Source = {
  key: string;
  type: "evidence" | "artifact" | "observation";
  id: string;
  title: string;
  text: string;
  createdAt: string;
  href: string;
};

export async function askKlio(input: {
  familyId: string;
  parentId: string;
  studentId?: string | null;
  threadId?: string | null;
  question: string;
}) {
  if (!serverEnv.openAiApiKey) throw new Error("OPENAI_KEY_REQUIRED");
  const admin = createAdminClient();
  const [evidenceResult, artifactResult, observationResult] = await Promise.all([
    admin.from("evidence_items")
      .select("id, kind, title, raw_text, extracted_text, created_at, evidence_students(student_id), evidence_categories(categories(name), document_type, tags)")
      .eq("family_id", input.familyId).order("created_at", { ascending: false }).limit(300),
    admin.from("artifacts")
      .select("id, student_id, type, title, summary, rationale, content, status, created_at")
      .eq("family_id", input.familyId).order("created_at", { ascending: false }).limit(200),
    admin.from("skill_observations")
      .select("id, student_id, subject, skill_label, status, rationale, approval_status, created_at")
      .eq("family_id", input.familyId).order("created_at", { ascending: false }).limit(300),
  ]);
  if (evidenceResult.error) throw evidenceResult.error;
  if (artifactResult.error) throw artifactResult.error;
  if (observationResult.error) throw observationResult.error;

  const sources: Source[] = [];
  for (const item of evidenceResult.data) {
    if (input.studentId && !item.evidence_students.some((link) => link.student_id === input.studentId)) continue;
    const category = item.evidence_categories[0];
    sources.push({
      key: `evidence:${item.id}`, type: "evidence", id: item.id,
      title: item.title || item.raw_text?.slice(0, 100) || `${item.kind} record`,
      text: [item.raw_text, item.extracted_text, category?.categories?.name, category?.document_type, ...(category?.tags ?? [])].filter(Boolean).join("\n").slice(0, 12000),
      createdAt: item.created_at,
      href: `/app/records?q=${encodeURIComponent(item.title || item.raw_text?.slice(0, 80) || item.id)}`,
    });
  }
  for (const item of artifactResult.data) {
    if (input.studentId && item.student_id && item.student_id !== input.studentId) continue;
    sources.push({
      key: `artifact:${item.id}`, type: "artifact", id: item.id, title: item.title,
      text: [item.type, item.summary, item.rationale, JSON.stringify(item.content)].filter(Boolean).join("\n").slice(0, 12000),
      createdAt: item.created_at, href: `/app/artifacts/${item.id}`,
    });
  }
  for (const item of observationResult.data) {
    if (input.studentId && item.student_id !== input.studentId) continue;
    sources.push({
      key: `observation:${item.id}`, type: "observation", id: item.id,
      title: `${item.subject}: ${item.skill_label}`,
      text: [item.subject, item.skill_label, item.status, item.rationale, item.approval_status].join("\n"),
      createdAt: item.created_at, href: `/app/records?q=${encodeURIComponent(item.skill_label)}`,
    });
  }

  const ranked = rankSources(input.question, sources).slice(0, 14);
  const thread = await getOrCreateThread(admin, input);
  const { error: userMessageError } = await admin.from("question_messages").insert({
    thread_id: thread.id, family_id: input.familyId, role: "user", content: input.question, created_by: input.parentId,
  });
  if (userMessageError) throw userMessageError;

  const { data: history, error: historyError } = await admin.from("question_messages")
    .select("role, content").eq("thread_id", thread.id).order("created_at", { ascending: false }).limit(8);
  if (historyError) throw historyError;

  const openai = new OpenAI({ apiKey: serverEnv.openAiApiKey });
  const response = await openai.responses.parse({
    model: serverEnv.openAiModel,
    store: false,
    reasoning: { effort: "medium" },
    safety_identifier: createHash("sha256").update(input.parentId).digest("hex").slice(0, 32),
    instructions: `You are Klio, a retrieval assistant for a homeschool parent. Answer only from the supplied family records. Be direct and useful. Never invent work, grades, completion, deadlines, or learner facts. If the records do not answer the question, say what is missing. source_keys must contain only keys from supplied_records that directly support the answer. When the parent asks to bring up work, identify the most relevant saved item and cite it.`,
    input: JSON.stringify({
      question: input.question,
      recent_conversation: [...(history ?? [])].reverse(),
      supplied_records: ranked.map(({ key, type, title, text, createdAt }) => ({ key, type, title, text, created_at: createdAt })),
    }),
    text: { format: zodTextFormat(answerSchema, "klio_answer"), verbosity: "medium" },
  });
  const answer = response.output_parsed;
  if (!answer) throw new Error("MODEL_OUTPUT_INVALID");
  const allowed = new Map(ranked.map((source) => [source.key, source]));
  const cited = [...new Set(answer.source_keys)].map((key) => allowed.get(key)).filter((source): source is Source => Boolean(source));
  const { data: assistantMessage, error: assistantError } = await admin.from("question_messages").insert({
    thread_id: thread.id, family_id: input.familyId, role: "assistant", content: answer.answer,
    confidence: answer.confidence, created_by: null,
  }).select("id").single();
  if (assistantError) throw assistantError;
  if (cited.length) {
    const { error } = await admin.from("question_message_sources").insert(cited.map((source) => ({
      message_id: assistantMessage.id, family_id: input.familyId, source_type: source.type,
      source_id: source.id, title: source.title,
    })));
    if (error) throw error;
  }
  await admin.from("question_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread.id);

  return {
    threadId: thread.id,
    answer: answer.answer,
    confidence: answer.confidence,
    followUp: answer.follow_up,
    sources: cited.map((source) => ({ id: source.id, type: source.type, title: source.title, href: source.href })),
  };
}

async function getOrCreateThread(admin: ReturnType<typeof createAdminClient>, input: {
  familyId: string; parentId: string; studentId?: string | null; threadId?: string | null; question: string;
}) {
  if (input.threadId) {
    const { data, error } = await admin.from("question_threads").select("id").eq("id", input.threadId).eq("family_id", input.familyId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("QUESTION_THREAD_NOT_FOUND");
    return data;
  }
  const { data, error } = await admin.from("question_threads").insert({
    family_id: input.familyId, student_id: input.studentId ?? null,
    title: input.question.trim().slice(0, 200), created_by: input.parentId,
  }).select("id").single();
  if (error) throw error;
  return data;
}

export function rankSources(question: string, sources: Source[]) {
  const terms = tokenize(question);
  return [...sources].sort((a, b) => score(b, terms) - score(a, terms));
}

function score(source: Source, terms: string[]) {
  const title = source.title.toLowerCase();
  const haystack = `${title} ${source.text}`.toLowerCase();
  const lexical = terms.reduce((total, term) => total + (title.includes(term) ? 6 : 0) + (haystack.includes(term) ? 2 : 0), 0);
  const ageDays = Math.max(0, (Date.now() - new Date(source.createdAt).getTime()) / 86_400_000);
  return lexical + Math.max(0, 2 - ageDays / 30);
}

function tokenize(value: string) {
  const stop = new Set(["about", "bring", "could", "from", "have", "into", "klio", "please", "show", "that", "their", "this", "what", "when", "where", "which", "with", "work"]);
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2 && !stop.has(term)) ?? [])];
}
