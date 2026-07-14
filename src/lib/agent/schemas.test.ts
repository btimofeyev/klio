import { describe, expect, it } from "vitest";
import { agentArtifactSchema } from "./schemas";

describe("agentArtifactSchema", () => {
  it("rejects unsupported status and executable-shaped output", () => {
    const result = agentArtifactSchema.safeParse({ artifact_type: "analysis", title: "Review", summary: "Summary", rationale: "Evidence", uncertainty_flags: [], observations: [{ subject: "Math", skill_key: "fractions", skill_label: "Fractions", status: "mastered", confidence: 1, rationale: "Work", uncertainty_flags: [] }], content: { overview: "", sections: [], suggested_actions: [], plan_items: [], practice: null }, html: "<script />" });
    expect(result.success).toBe(false);
  });

  it("accepts an actionable reminder with an explicit due date", () => {
    const result = agentArtifactSchema.safeParse({
      capture_route: "reminder",
      artifact_type: "analysis",
      organization: { category_name: "Math", document_type: "Parent note", tags: ["homework"], confidence: .95, rationale: "The note is about math homework." },
      title: "Weekly math grading note", summary: "The parent needs to grade this week's math homework.", rationale: "Explicit future action in the note.", uncertainty_flags: [],
      reminders: [{ title: "Grade math homework", notes: "Grade his math homework for the week.", due_at: "2026-07-10T17:00:00-04:00", confidence: .98, rationale: "The parent said I need to grade it." }],
      observations: [], content: { overview: "", sections: [], suggested_actions: [], plan_items: [], practice: null },
    });
    expect(result.success).toBe(true);
  });
});
