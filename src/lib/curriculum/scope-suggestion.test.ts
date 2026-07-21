import { describe, expect, it } from "vitest";
import { buildScopeSuggestionDiff, collectScopeSuggestionSources, courseScopeSuggestionOutputSchema, normalizeScopeSuggestionIdentity, normalizeScopeSuggestionSources, scopeSuggestionFingerprint } from "./scope-suggestion";

describe("publisher-aware scope suggestions", () => {
  it("maps a synthetic 100-item proposal onto stable IDs", () => {
    const proposal = output(100);
    const assignments = Array.from({ length: 100 }, (_, index) => ({ id: `stable-${index + 1}`, sequenceNumber: index + 1, title: `Course · Lesson ${index + 1}`, status: "planned", scheduledDate: null, curriculumItemState: "placeholder" }));
    const diff = buildScopeSuggestionDiff({ assignments, proposal });
    expect(diff).toHaveLength(100);
    expect(diff[0]).toMatchObject({ assignmentId: "stable-1", disposition: "safe" });
  });

  it("protects history and flags scheduled or enriched future rows", () => {
    const proposal = output(3);
    const diff = buildScopeSuggestionDiff({ proposal, assignments: [
      { id: "one", sequenceNumber: 1, title: "One", status: "completed", scheduledDate: null, curriculumItemState: "enriched" },
      { id: "two", sequenceNumber: 2, title: "Two", status: "planned", scheduledDate: "2026-09-01", curriculumItemState: "placeholder" },
      { id: "three", sequenceNumber: 3, title: "Three", status: "planned", scheduledDate: null, curriculumItemState: "enriched" },
    ] });
    expect(diff.map((item) => item.disposition)).toEqual(["protected", "review", "review"]);
  });

  it("rejects malformed, duplicate, and oversized outlines", () => {
    expect(courseScopeSuggestionOutputSchema.safeParse({ ...output(1), items: [{ ...output(1).items[0], kind: "chapter" }] }).success).toBe(false);
    expect(courseScopeSuggestionOutputSchema.safeParse({ ...output(2), items: [output(2).items[0], output(2).items[0]] }).success).toBe(false);
    expect(courseScopeSuggestionOutputSchema.safeParse(output(501)).success).toBe(false);
  });

  it("cannot turn a model prior into edition verification", () => {
    expect(normalizeScopeSuggestionIdentity({ publisher: "BJU Press", productName: "English", subject: "Language Arts", gradeLabel: "7", editionLabel: "4th", isbn: "9780306406157" }, "model_prior").status).toBe("recognized");
    expect(normalizeScopeSuggestionIdentity({ publisher: "BJU Press", productName: "English", subject: "Language Arts", gradeLabel: "7", editionLabel: "4th", isbn: "9780306406157" }, "web_search").status).toBe("recognized");
  });

  it("searches again when the parent changes only the course name", () => {
    const identity = normalizeScopeSuggestionIdentity({ publisher: null, productName: null, subject: "English", gradeLabel: "7", editionLabel: null, isbn: null }, "web_search");
    expect(scopeSuggestionFingerprint({ identity, sourceKind: "web_search", courseTitle: "BJU English 7" }))
      .not.toBe(scopeSuggestionFingerprint({ identity, sourceKind: "web_search", courseTitle: "Abeka Grammar and Composition" }));
  });

  it("keeps safe, deduplicated web citations and their titles", () => {
    const sources = collectScopeSuggestionSources([
      { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://example.com/toc#page" }, { type: "url", url: "javascript:alert(1)" }] } },
      { type: "message", content: [{ type: "output_text", annotations: [{ type: "url_citation", url: "https://example.com/toc", title: "Official table of contents" }] }] },
    ]);
    expect(sources).toEqual([{ url: "https://example.com/toc", title: "Official table of contents" }]);
    expect(normalizeScopeSuggestionSources([{ url: "file:///tmp/toc", title: "Unsafe" }, { url: "https://library.example/book", title: null }]))
      .toEqual([{ url: "https://library.example/book", title: null }]);
  });

  it("supersedes editions through distinct source fingerprints", () => {
    const third = normalizeScopeSuggestionIdentity({ publisher: "BJU Press", productName: "English", subject: "Language Arts", gradeLabel: "7", editionLabel: "3rd", isbn: null }, "parent_evidence");
    const fourth = normalizeScopeSuggestionIdentity({ publisher: "BJU Press", productName: "English", subject: "Language Arts", gradeLabel: "7", editionLabel: "4th", isbn: null }, "parent_evidence");
    expect(scopeSuggestionFingerprint({ identity: third, sourceKind: "parent_evidence", evidenceIds: ["a"] })).not.toBe(scopeSuggestionFingerprint({ identity: fourth, sourceKind: "parent_evidence", evidenceIds: ["a"] }));
  });
});

function output(count: number) {
  return {
    identity: { publisher: "Example Press", productName: "Synthetic Course", subject: "Math", gradeLabel: "7", editionLabel: null, isbn: null },
    targetLessonCount: Math.min(count, 500), assumptions: ["Edition is unknown."], confidence: 0.7,
    items: Array.from({ length: count }, (_, index) => ({ sequenceNumber: index + 1, title: `Synthetic item ${index + 1}`, kind: "lesson" as const, path: [], minutes: 30, confidence: 0.7 })),
  };
}
