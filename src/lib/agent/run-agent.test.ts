import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildContext, effectiveCaptureRoute, parseReviewReason } from "./run-agent";
import { DEFAULT_CAPTURE_INTENT } from "./intents";

describe("parent review corrections in agent context", () => {
  it("includes bounded learner corrections alongside approved context", () => {
    const context = JSON.parse(buildContext({
      student: { display_name: "Maya", grade_band: "3", learning_preferences: null }, evidence: [],
      observations: [{ subject: "Reading", skill_label: "Finds main idea", status: "secure", rationale: "Confirmed by parent" }],
      recentArtifacts: [], categories: [], corrections: [], intent: "understand", timezone: "America/New_York",
      parentReviewCorrections: {
        observations: [{ subject: "Math", skill_label: "Adds independently", rationale: "One worksheet", rejection_reason: JSON.stringify({ code: "parent_or_sibling_helped", detail: "Worked together" }), reviewed_at: "2026-07-11T12:00:00Z" }],
        artifacts: [{ type: "analysis", title: "Mastery summary", summary: "Insufficient sample", rejection_reason: JSON.stringify({ code: "not_enough_information" }), reviewed_at: "2026-07-11T12:00:00Z" }],
      },
    }));
    expect(context.approved_skill_context[0].skill_label).toBe("Finds main idea");
    expect(context.parent_review_corrections.observations[0].correction.code).toBe("parent_or_sibling_helped");
    expect(context.parent_review_corrections.artifacts[0].correction.code).toBe("not_enough_information");
    expect(JSON.stringify(context)).not.toContain("sibling learner");
  });

  it("treats malformed legacy reasons as absent", () => {
    expect(parseReviewReason("Rejected by parent")).toBeNull();
    expect(parseReviewReason(JSON.stringify({ code: "not_enough_information" }))).toEqual({ code: "not_enough_information" });
  });
});

describe("capture routing", () => {
  it("organizes ordinary captures without creating approval drafts by default", () => {
    expect(DEFAULT_CAPTURE_INTENT).toBe("organize");
  });

  it("keeps reminder-only notes out of learning when a reminder was created", () => {
    expect(effectiveCaptureRoute("reminder", 1)).toBe("reminder");
  });

  it("falls back to a tiny review question when reminder extraction produced nothing", () => {
    expect(effectiveCaptureRoute("reminder", 0)).toBe("uncertain");
    expect(effectiveCaptureRoute("mixed", 0)).toBe("learning");
  });
});
