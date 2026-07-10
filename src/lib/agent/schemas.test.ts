import { describe, expect, it } from "vitest";
import { agentArtifactSchema } from "./schemas";

describe("agentArtifactSchema", () => {
  it("rejects unsupported status and executable-shaped output", () => {
    const result = agentArtifactSchema.safeParse({ artifact_type: "analysis", title: "Review", summary: "Summary", rationale: "Evidence", uncertainty_flags: [], observations: [{ subject: "Math", skill_key: "fractions", skill_label: "Fractions", status: "mastered", confidence: 1, rationale: "Work", uncertainty_flags: [] }], content: { overview: "", sections: [], suggested_actions: [], plan_items: [], practice: null }, html: "<script />" });
    expect(result.success).toBe(false);
  });
});
