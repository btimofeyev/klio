import { z } from "zod";
import { courseScopeSuggestionOutputSchema, scopeSuggestionItemSchema } from "./scope-suggestion";

export const curriculumPacingSchema = z.object({
  sourceGranularity: z.enum(["daily_session", "container", "mixed", "unknown"]),
  containerLabel: z.enum(["Module", "Chapter", "Unit", "Week"]).nullable(),
  containerCount: z.number().int().min(1).max(500).nullable(),
  recommendedWeeklyFrequency: z.number().int().min(1).max(7).nullable(),
  recommendedWeekCount: z.number().int().min(1).max(52).nullable(),
  recommendedSessionCount: z.number().int().min(1).max(500).nullable(),
  minutesPerSession: z.number().int().min(5).max(480).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

export const courseScopeResearchOutputSchema = z.object({
  proposal: courseScopeSuggestionOutputSchema,
  pacing: curriculumPacingSchema,
}).strict();

export type CurriculumPacing = z.infer<typeof curriculumPacingSchema>;
export type PreparedCurriculumResearch = {
  proposal: z.infer<typeof courseScopeSuggestionOutputSchema>;
  pacing: CurriculumPacing;
  outlineItems: z.infer<typeof scopeSuggestionItemSchema>[];
  expandedFromContainers: boolean;
};

const unknownPacing: CurriculumPacing = {
  sourceGranularity: "unknown",
  containerLabel: null,
  containerCount: null,
  recommendedWeeklyFrequency: null,
  recommendedWeekCount: null,
  recommendedSessionCount: null,
  minutesPerSession: null,
  confidence: 0,
};

export function prepareCurriculumResearch(raw: unknown, fallbackTargetCount: number): PreparedCurriculumResearch {
  const researched = courseScopeResearchOutputSchema.safeParse(raw);
  if (!researched.success) {
    const proposal = courseScopeSuggestionOutputSchema.parse(raw);
    return { proposal, pacing: unknownPacing, outlineItems: proposal.items, expandedFromContainers: false };
  }
  const { proposal, pacing } = researched.data;
  if (pacing.sourceGranularity !== "container") {
    const recommendedTarget = pacing.recommendedSessionCount ?? proposal.targetLessonCount;
    const adjusted = courseScopeSuggestionOutputSchema.parse({ ...proposal, targetLessonCount: Math.max(recommendedTarget, ...proposal.items.map((item) => item.sequenceNumber), 1) });
    return { proposal: adjusted, pacing, outlineItems: proposal.items, expandedFromContainers: false };
  }

  const derivedSessionCount = pacing.recommendedWeekCount && pacing.recommendedWeeklyFrequency
    ? pacing.recommendedWeekCount * pacing.recommendedWeeklyFrequency
    : null;
  const countsAgree = !derivedSessionCount || !pacing.recommendedSessionCount || derivedSessionCount === pacing.recommendedSessionCount;
  const sessionCount = pacing.recommendedSessionCount ?? derivedSessionCount;
  const completeContainerOutline = proposal.items.length >= 2
    && pacing.containerCount === proposal.items.length
    && proposal.items.every((item, index) => item.sequenceNumber === index + 1);
  const pacingIsSchedulable = countsAgree && sessionCount !== null && sessionCount >= proposal.items.length && pacing.confidence >= 0.6;
  if (!completeContainerOutline || !pacingIsSchedulable) {
    const safeProposal = courseScopeSuggestionOutputSchema.parse({
      ...proposal,
      targetLessonCount: fallbackTargetCount,
      items: [],
      assumptions: [...proposal.assumptions, "The source identifies curriculum containers but does not provide enough reliable pacing to turn them into daily work."].slice(0, 20),
    });
    return { proposal: safeProposal, pacing, outlineItems: proposal.items, expandedFromContainers: false };
  }

  const baseSessions = Math.floor(sessionCount / proposal.items.length);
  const extraSessions = sessionCount % proposal.items.length;
  let sequenceNumber = 1;
  const sessions = proposal.items.flatMap((container, containerIndex) => {
    const count = baseSessions + (containerIndex < extraSessions ? 1 : 0);
    const titledContainer = /^(module|chapter|unit|week)\s+\d+\b/i.test(container.title)
      ? container.title
      : `${pacing.containerLabel ?? "Module"} ${containerIndex + 1}: ${container.title}`;
    return Array.from({ length: count }, (_, sessionIndex) => ({
      sequenceNumber: sequenceNumber++,
      title: `${titledContainer} · Session ${sessionIndex + 1}`.slice(0, 200),
      kind: "lesson" as const,
      path: [titledContainer.slice(0, 120)],
      minutes: pacing.minutesPerSession,
      confidence: Math.min(container.confidence, pacing.confidence),
    }));
  });
  const expanded = courseScopeSuggestionOutputSchema.parse({
    ...proposal,
    targetLessonCount: sessionCount,
    items: sessions,
    assumptions: [...proposal.assumptions, `Klio mapped ${proposal.items.length} source-backed ${pacing.containerLabel?.toLowerCase() ?? "curriculum container"}s into ${sessionCount} schedulable sessions. Exact daily page assignments still require the publisher's daily schedule.`].slice(0, 20),
  });
  return { proposal: expanded, pacing, outlineItems: proposal.items, expandedFromContainers: true };
}

export function curriculumPacingFromSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pacing = "pacing" in value ? (value as { pacing?: unknown }).pacing : null;
  const parsed = curriculumPacingSchema.safeParse(pacing);
  return parsed.success ? parsed.data : null;
}
