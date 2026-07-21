import { createHash } from "node:crypto";
import { z } from "zod";
import { curriculumItemKindSchema, curriculumPathSchema } from "./scope";
import { courseIdentityFingerprint, normalizeCourseIdentity, type CourseIdentity, type IdentityAuthority } from "./course-identity";

export const scopeSuggestionItemSchema = z.object({
  sequenceNumber: z.number().int().min(1).max(500),
  title: z.string().trim().min(1).max(200),
  kind: curriculumItemKindSchema,
  path: curriculumPathSchema.default([]),
  minutes: z.number().int().min(5).max(480).nullable().optional(),
  confidence: z.number().min(0).max(1),
}).strict();

export const courseScopeSuggestionOutputSchema = z.object({
  identity: z.object({
    publisher: z.string().trim().max(120).nullable(),
    productName: z.string().trim().max(200).nullable(),
    subject: z.string().trim().min(1).max(80),
    gradeLabel: z.string().trim().max(80).nullable(),
    editionLabel: z.string().trim().max(120).nullable(),
    isbn: z.string().trim().max(32).nullable(),
  }).strict(),
  targetLessonCount: z.number().int().min(1).max(500),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(20),
  items: z.array(scopeSuggestionItemSchema).max(500),
  confidence: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  const seen = new Set<number>();
  for (const item of value.items) {
    if (seen.has(item.sequenceNumber)) context.addIssue({ code: "custom", message: `Sequence ${item.sequenceNumber} is duplicated.`, path: ["items"] });
    seen.add(item.sequenceNumber);
    if (item.sequenceNumber > value.targetLessonCount) context.addIssue({ code: "custom", message: "An item exceeds the proposed target.", path: ["items"] });
  }
});

export const scopeSuggestionSourceSchema = z.object({
  url: z.url().max(2_000),
  title: z.string().trim().min(1).max(300).nullable(),
}).strict();

export type ScopeSuggestionSource = z.infer<typeof scopeSuggestionSourceSchema>;

export type ScopeProposalAssignment = {
  id: string;
  sequenceNumber: number;
  title: string;
  status: string;
  scheduledDate: string | null;
  curriculumItemState: string | null;
};

export function normalizeScopeSuggestionIdentity(identity: unknown, source: IdentityAuthority): CourseIdentity {
  return normalizeCourseIdentity(identity, source);
}

export function scopeSuggestionFingerprint(input: { identity: CourseIdentity; sourceKind: string; evidenceIds?: string[]; courseTitle?: string }) {
  return createHash("sha256").update(JSON.stringify({ identity: courseIdentityFingerprint(input.identity), sourceKind: input.sourceKind, evidenceIds: [...(input.evidenceIds ?? [])].sort(), courseTitle: input.courseTitle?.trim().toLowerCase() ?? null })).digest("hex");
}

export function normalizeScopeSuggestionSources(value: unknown): ScopeSuggestionSource[] {
  if (!Array.isArray(value)) return [];
  const sources = new Map<string, ScopeSuggestionSource>();
  for (const candidate of value.slice(0, 200)) {
    const parsed = scopeSuggestionSourceSchema.safeParse(candidate);
    if (!parsed.success) continue;
    try {
      const url = new URL(parsed.data.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      url.hash = "";
      const normalizedUrl = url.toString();
      const current = sources.get(normalizedUrl);
      if (!current || (!current.title && parsed.data.title)) sources.set(normalizedUrl, { url: normalizedUrl, title: parsed.data.title });
    } catch {
      // Invalid or unsafe URLs are intentionally omitted from parent-facing citations.
    }
  }
  return [...sources.values()].slice(0, 20);
}

export function collectScopeSuggestionSources(output: unknown): ScopeSuggestionSource[] {
  if (!Array.isArray(output)) return [];
  const titles = new Map<string, string>();
  const citations: Array<{ url: unknown; title: unknown }> = [];
  const searched: Array<{ url: unknown; title: unknown }> = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "message" && Array.isArray(record.content)) {
      for (const content of record.content) {
        if (!content || typeof content !== "object") continue;
        const annotations = (content as Record<string, unknown>).annotations;
        if (!Array.isArray(annotations)) continue;
        for (const annotation of annotations) {
          if (!annotation || typeof annotation !== "object") continue;
          const citation = annotation as Record<string, unknown>;
          if (citation.type !== "url_citation" || typeof citation.url !== "string") continue;
          if (typeof citation.title === "string" && citation.title.trim()) titles.set(citation.url, citation.title);
          citations.push({ url: citation.url, title: typeof citation.title === "string" ? citation.title : null });
        }
      }
    }
    if (record.type !== "web_search_call" || !record.action || typeof record.action !== "object") continue;
    const action = record.action as Record<string, unknown>;
    if (Array.isArray(action.sources)) {
      for (const source of action.sources) {
        if (!source || typeof source !== "object") continue;
        const url = (source as Record<string, unknown>).url;
        searched.push({ url, title: null });
      }
    }
    if (typeof action.url === "string") searched.push({ url: action.url, title: null });
  }
  return normalizeScopeSuggestionSources([...citations, ...searched.map((source) => ({ ...source, title: typeof source.url === "string" ? titles.get(source.url) ?? null : null }))]);
}

export function buildScopeSuggestionDiff(input: {
  assignments: ScopeProposalAssignment[];
  proposal: z.infer<typeof courseScopeSuggestionOutputSchema>;
}) {
  const bySequence = new Map(input.assignments.map((assignment) => [assignment.sequenceNumber, assignment]));
  return input.proposal.items.map((item) => {
    const assignment = bySequence.get(item.sequenceNumber) ?? null;
    const protectedHistory = Boolean(assignment && ["doing", "submitted", "needs_review", "completed"].includes(assignment.status));
    const explicitReview = Boolean(assignment && !protectedHistory && (assignment.scheduledDate || assignment.curriculumItemState === "enriched"));
    return {
      sequenceNumber: item.sequenceNumber,
      assignmentId: assignment?.id ?? null,
      beforeTitle: assignment?.title ?? null,
      proposed: item,
      disposition: protectedHistory ? "protected" as const : explicitReview ? "review" as const : assignment ? "safe" as const : "append" as const,
    };
  });
}

export function scopeSuggestionConfidenceWording(confidence: number) {
  if (confidence >= 0.85) return "Strong source match; review before applying.";
  if (confidence >= 0.6) return "Likely starting outline; confirm the assumptions.";
  return "Tentative outline; keep generic lessons unless the source confirms it.";
}
