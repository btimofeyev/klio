import { z } from "zod";
import { curriculumPacingSchema, type PreparedCurriculumResearch } from "./curriculum-pacing";
import { courseScopeSuggestionOutputSchema, scopeSuggestionSourceSchema } from "./scope-suggestion";

export const curriculumResearchResultSchema = z.object({
  proposal: courseScopeSuggestionOutputSchema,
  sources: z.array(scopeSuggestionSourceSchema).max(20),
  pacing: curriculumPacingSchema,
  structure: z.object({
    sequenceLabel: z.enum(["Lesson", "Module", "Chapter", "Unit", "Week"]),
    detectedItemCount: z.number().int().min(1).max(500).nullable(),
    isCompleteDetectedOutline: z.boolean(),
    containerLabel: z.enum(["Module", "Chapter", "Unit", "Week"]).nullable(),
    containerCount: z.number().int().min(1).max(500).nullable(),
    expandedFromContainers: z.boolean(),
  }).strict(),
}).strict();

export type CurriculumResearchResult = z.infer<typeof curriculumResearchResultSchema>;

const supportedLabels = ["Module", "Chapter", "Unit", "Week", "Lesson"] as const;

function titleSequenceLabel(value: string) {
  const match = value.trim().match(/^(module|chapter|unit|week|lesson)\s+\d+\b/i);
  if (!match) return null;
  return supportedLabels.find((label) => label.toLowerCase() === match[1].toLowerCase()) ?? null;
}

export function analyzeCurriculumResearch(proposal: z.infer<typeof courseScopeSuggestionOutputSchema>, prepared?: PreparedCurriculumResearch) {
  const sequenceNumbers = proposal.items.map((item) => item.sequenceNumber).sort((a, b) => a - b);
  const contiguous = sequenceNumbers.length > 0 && sequenceNumbers.every((sequence, index) => sequence === index + 1);
  const labelCounts = new Map<(typeof supportedLabels)[number], number>();
  for (const item of proposal.items) {
    const label = titleSequenceLabel(item.title) ?? item.path.map(titleSequenceLabel).find(Boolean) ?? null;
    if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const sequenceLabel = prepared?.expandedFromContainers ? "Lesson" : [...labelCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Lesson";
  const isCompleteDetectedOutline = contiguous && proposal.items.length === proposal.targetLessonCount;
  return {
    sequenceLabel,
    detectedItemCount: isCompleteDetectedOutline ? proposal.items.length : null,
    isCompleteDetectedOutline,
    containerLabel: prepared?.pacing.containerLabel ?? null,
    containerCount: prepared?.pacing.containerCount ?? null,
    expandedFromContainers: prepared?.expandedFromContainers ?? false,
  };
}
