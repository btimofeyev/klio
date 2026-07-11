import { describe, expect, it } from "vitest";
import { formatReviewHistory, groupReviewSuggestions, type ReviewSuggestion } from "@/lib/review/presentation";

const source = { id: "evidence-1", kind: "note", title: "Fraction worksheet", rawText: "Compared fractions", mimeType: null, sourceAt: "2026-07-11T12:00:00Z" };
function suggestion(overrides: Partial<ReviewSuggestion>): ReviewSuggestion {
  return { requestId: crypto.randomUUID(), runId: "run-1", entityType: "skill_observation", id: crypto.randomUUID(), studentName: "Maya", createdAt: "2026-07-11T12:00:00Z", label: "Something Klio noticed", conclusion: "Compares fractions", explanation: "Shown in the worksheet", consequence: "Used for planning", uncertainty: [], sources: [source], subject: "Math", status: "developing", ...overrides };
}

describe("parent review presentation", () => {
  it("groups one artifact and two observations from the same run around one source", () => {
    const groups = groupReviewSuggestions([
      suggestion({ entityType: "artifact", id: "artifact-1", label: "Something Klio made", conclusion: "Fraction practice", artifact: { type: "practice", summary: "A short practice", overview: null } }),
      suggestion({ id: "observation-1" }), suggestion({ id: "observation-2", conclusion: "Explains reasoning" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].suggestions).toHaveLength(3);
    expect(groups[0].sources).toEqual([source]);
  });

  it("keeps suggestions without a run in separate request groups", () => {
    const groups = groupReviewSuggestions([suggestion({ runId: null, requestId: "request-a" }), suggestion({ runId: null, requestId: "request-b" })]);
    expect(groups.map((group) => group.id).sort()).toEqual(["request-a", "request-b"]);
  });

  it("turns known audit actions into parent language and protects unknown actions", () => {
    expect(formatReviewHistory({ id: "1", action: "artifact.approved", entity_type: "artifact", metadata: { title: "Reading plan", student_name: "Maya" }, created_at: "2026-07-11T12:00:00Z" }).sentence).toBe("Reading plan was marked as looking right");
    expect(formatReviewHistory({ id: "2", action: "skill_observation.rejected", entity_type: "skill_observation", metadata: { skill_label: "Reads fluently", correction_label: "Not enough information" }, created_at: "2026-07-11T12:00:00Z" }).sentence).toContain("Not enough information");
    expect(formatReviewHistory({ id: "3", action: "system.mystery", entity_type: "unknown", metadata: {}, created_at: "2026-07-11T12:00:00Z" }).sentence).toBe("A family record was updated");
  });
});
