import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { ReviewWorkspace } from "@/components/review-workspace";
import { HelpFilingQueue } from "@/components/help-filing-queue";
import { formatReviewHistory, groupReviewSuggestions, type ReviewHistoryItem, type ReviewSource, type ReviewSuggestion } from "@/lib/review/presentation";

type EvidenceRow = { id: string; kind: string; title: string | null; raw_text: string | null; mime_type: string | null; source_at: string };

export default async function ActivityPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data: requests, error: requestError } = await supabase.from("approval_requests")
    .select("id, requested_by_run, entity_type, entity_id, created_at")
    .eq("family_id", workspace.family.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(300);
  if (requestError) throw requestError;

  const artifactIds = (requests ?? []).filter((request) => request.entity_type === "artifact").map((request) => request.entity_id);
  const observationIds = (requests ?? []).filter((request) => request.entity_type === "skill_observation").map((request) => request.entity_id);
  const [{ data: artifacts, error: artifactError }, { data: observations, error: observationError }, { data: artifactLinks }, { data: observationLinks }, { data: events }] = await Promise.all([
    artifactIds.length ? supabase.from("artifacts").select("id, agent_run_id, student_id, type, title, summary, rationale, content, created_at").eq("family_id", workspace.family.id).eq("status", "draft").in("id", artifactIds) : Promise.resolve({ data: [], error: null }),
    observationIds.length ? supabase.from("skill_observations").select("id, student_id, subject, skill_label, status, rationale, confidence, uncertainty_flags, created_at").eq("family_id", workspace.family.id).eq("approval_status", "draft").in("id", observationIds) : Promise.resolve({ data: [], error: null }),
    artifactIds.length ? supabase.from("artifact_sources").select("artifact_id, evidence_id").eq("family_id", workspace.family.id).in("artifact_id", artifactIds) : Promise.resolve({ data: [], error: null }),
    observationIds.length ? supabase.from("observation_evidence").select("observation_id, evidence_id").eq("family_id", workspace.family.id).in("observation_id", observationIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("audit_events").select("id, action, entity_type, metadata, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(40),
  ]);
  if (artifactError) throw artifactError;
  if (observationError) throw observationError;

  const evidenceIds = [...new Set([...(artifactLinks ?? []).map((link) => link.evidence_id), ...(observationLinks ?? []).map((link) => link.evidence_id)])];
  const { data: evidence, error: evidenceError } = evidenceIds.length
    ? await supabase.from("evidence_items").select("id, kind, title, raw_text, mime_type, source_at").eq("family_id", workspace.family.id).in("id", evidenceIds)
    : { data: [], error: null };
  if (evidenceError) throw evidenceError;

  const studentNames = new Map(workspace.students.map((student) => [student.id, student.displayName]));
  const evidenceById = new Map((evidence as EvidenceRow[]).map((item) => [item.id, toSource(item)]));
  const artifactById = new Map((artifacts ?? []).map((item) => [item.id, item]));
  const observationById = new Map((observations ?? []).map((item) => [item.id, item]));
  const artifactEvidence = new Map<string, string[]>();
  for (const link of artifactLinks ?? []) artifactEvidence.set(link.artifact_id, [...(artifactEvidence.get(link.artifact_id) ?? []), link.evidence_id]);
  const observationEvidence = new Map<string, string[]>();
  for (const link of observationLinks ?? []) observationEvidence.set(link.observation_id, [...(observationEvidence.get(link.observation_id) ?? []), link.evidence_id]);

  const suggestions: ReviewSuggestion[] = [];
  let staleCount = 0;
  for (const request of requests ?? []) {
    if (request.entity_type === "artifact") {
      const artifact = artifactById.get(request.entity_id);
      if (!artifact) { staleCount += 1; continue; }
      const content = artifact.content && typeof artifact.content === "object" && !Array.isArray(artifact.content) ? artifact.content as Record<string, unknown> : {};
      suggestions.push({
        requestId: request.id, runId: request.requested_by_run ?? artifact.agent_run_id, entityType: "artifact", id: artifact.id,
        studentName: artifact.student_id ? studentNames.get(artifact.student_id) ?? "Learner" : "Family", createdAt: artifact.created_at,
        label: "Something Klio made", conclusion: artifact.title, explanation: artifact.rationale || artifact.summary || "Klio made this from the work you shared.",
        consequence: "This draft will be available to use in plans and learning records.", uncertainty: stringArray(content.uncertainty_flags),
        sources: (artifactEvidence.get(artifact.id) ?? []).map((id) => evidenceById.get(id)).filter(Boolean) as ReviewSource[],
        artifact: { type: artifact.type, summary: artifact.summary, overview: typeof content.overview === "string" ? content.overview : null },
      });
    } else {
      const observation = observationById.get(request.entity_id);
      if (!observation) { staleCount += 1; continue; }
      suggestions.push({
        requestId: request.id, runId: request.requested_by_run, entityType: "skill_observation", id: observation.id,
        studentName: studentNames.get(observation.student_id) ?? "Learner", createdAt: observation.created_at,
        label: "Something Klio noticed", conclusion: observation.skill_label, explanation: observation.rationale,
        consequence: "Klio will use this when suggesting what to practice and plan next.", confidence: observation.confidence,
        uncertainty: stringArray(observation.uncertainty_flags), status: observation.status as ReviewSuggestion["status"], subject: observation.subject,
        sources: (observationEvidence.get(observation.id) ?? []).map((id) => evidenceById.get(id)).filter(Boolean) as ReviewSource[],
      });
    }
  }

  const groups = groupReviewSuggestions(suggestions);
  const history: ReviewHistoryItem[] = (events ?? []).map((event) => formatReviewHistory(event));
  const unfiled = workspace.evidence.filter((item) => item.captureRoute !== "reminder" && (item.status === "needs_review" || (item.status === "ready" && item.categories.length === 0)));
  return (
    <div className="section-page activity-page">
      <header><p className="eyebrow">Temporary queue</p><h1>Klio needs your help</h1><p>File anything Klio could not place, then confirm what it understood. This disappears when you are done.</p></header>
      <HelpFilingQueue familyId={workspace.family.id} categories={workspace.categories} initialItems={unfiled} students={workspace.students} />
      {groups.length || !unfiled.length ? <ReviewWorkspace familyId={workspace.family.id} initialGroups={groups} initialHistory={history} staleCount={staleCount} /> : null}
    </div>
  );
}

function toSource(item: EvidenceRow): ReviewSource {
  return { id: item.id, kind: item.kind, title: item.title, rawText: item.raw_text, mimeType: item.mime_type, sourceAt: item.source_at };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
