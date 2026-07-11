export type ReviewSource = { id: string; kind: string; title: string | null; rawText: string | null; mimeType: string | null; sourceAt: string };
export type ReviewSuggestion = {
  requestId: string; runId: string | null; entityType: "artifact" | "skill_observation"; id: string; studentName: string; createdAt: string;
  label: "Something Klio noticed" | "Something Klio made"; conclusion: string; explanation: string; consequence: string; uncertainty: string[];
  confidence?: number | null; subject?: string; status?: "emerging" | "developing" | "secure" | "needs-review";
  artifact?: { type: string; summary: string | null; overview: string | null }; sources: ReviewSource[];
};
export type ReviewGroup = { id: string; runId: string | null; studentName: string; createdAt: string; sources: ReviewSource[]; suggestions: ReviewSuggestion[] };
export type ReviewHistoryItem = { id: string; sentence: string; learner: string | null; createdAt: string };
export type ReviewAuditEvent = { id: string; action: string; entity_type: string; metadata: unknown; created_at: string };

export function groupReviewSuggestions(suggestions: ReviewSuggestion[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const suggestion of suggestions) {
    const groupId = suggestion.runId ?? suggestion.requestId;
    const existing = groups.get(groupId);
    if (existing) {
      existing.suggestions.push(suggestion);
      for (const source of suggestion.sources) if (!existing.sources.some((item) => item.id === source.id)) existing.sources.push(source);
    } else groups.set(groupId, { id: groupId, runId: suggestion.runId, studentName: suggestion.studentName, createdAt: suggestion.createdAt, sources: [...suggestion.sources], suggestions: [suggestion] });
  }
  return [...groups.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function formatReviewHistory(event: ReviewAuditEvent): ReviewHistoryItem {
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {};
  const title = typeof metadata.title === "string" ? metadata.title : typeof metadata.skill_label === "string" ? metadata.skill_label : null;
  const learner = typeof metadata.student_name === "string" ? metadata.student_name : null;
  const reason = typeof metadata.correction_label === "string" ? metadata.correction_label : null;
  let sentence = "A family record was updated";
  if (event.action === "artifact.approved") sentence = `${title ?? "A Klio draft"} was marked as looking right`;
  if (event.action === "artifact.rejected") sentence = `${title ?? "A Klio draft"} was marked not quite${reason ? ` — ${reason}` : ""}`;
  if (event.action === "artifact.edited") sentence = `${title ?? "A Klio draft"} was edited`;
  if (event.action === "skill_observation.approved") sentence = `${title ?? "A learning note"} was marked as looking right`;
  if (event.action === "skill_observation.rejected") sentence = `${title ?? "A learning note"} was corrected${reason ? ` — ${reason}` : ""}`;
  if (event.action === "skill_observation.edited") sentence = `${title ?? "A learning note"} was edited`;
  return { id: event.id, sentence, learner, createdAt: event.created_at };
}

export function reviewStatusLabel(status: ReviewSuggestion["status"]) {
  return ({ emerging: "Just getting started", developing: "Still practicing", secure: "Doing this independently", "needs-review": "Needs another look" } as const)[status ?? "needs-review"];
}

export function reviewConfidenceLabel(confidence: number) {
  return confidence >= .8 ? "Strong match" : confidence >= .55 ? "Likely" : "Klio is unsure";
}
