import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assignmentReviewDraftSchema } from "./draft-review";

describe("assignmentReviewDraftSchema", () => {
  it("accepts a grounded parent-reviewable grading draft", () => {
    const draft = assignmentReviewDraftSchema.parse({
      score: 88,
      scoreLabel: "B+",
      feedback: "The response uses two accurate details. Recheck the final date before filing it.",
      rubric: [{ criterion: "Historical accuracy", level: "Mostly accurate", note: "One date needs correction." }],
      masterySignals: [{ skill: "Uses historical evidence", status: "developing" }],
      uncertaintyFlags: [],
    });
    expect(draft.score).toBe(88);
  });

  it("supports an honest no-score result when the source is insufficient", () => {
    const draft = assignmentReviewDraftSchema.parse({
      score: null,
      scoreLabel: null,
      feedback: "The second page is not visible, so completion cannot be checked.",
      rubric: [], masterySignals: [], uncertaintyFlags: ["Only page one was supplied."],
    });
    expect(draft.score).toBeNull();
  });
});
