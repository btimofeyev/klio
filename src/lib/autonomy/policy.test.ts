import { describe, expect, it } from "vitest";
import { autonomyActions, autonomyActionRegistry, policyDecision, policyForPreset, recommendedPolicy, sanitizePolicy } from "./policy";

describe("family autonomy policy", () => {
  it("uses proactive reversible defaults for ordinary schedule work", () => {
    expect(policyDecision(recommendedPolicy, "move_unfinished_work")).toMatchObject({ appliesAutomatically: true, undoRequired: true });
    expect(policyDecision(recommendedPolicy, "record_inferred_grades")).toMatchObject({ appliesAutomatically: false, parentConfirmationRequired: true });
    expect(recommendedPolicy.delete_source_records).toBe("never");
  });

  it("keeps ask-first conservative and sanitizes custom policy input", () => {
    expect(policyForPreset("ask_first").schedule_supplemental_practice).toBe("confirm");
    expect(sanitizePolicy({ move_unfinished_work: "automatic", arbitrary_sql: "automatic" })).toEqual({ move_unfinished_work: "automatic" });
  });

  it("maps every advertised action to an enforcement handler", () => {
    expect(Object.keys(autonomyActionRegistry)).toEqual([...autonomyActions]);
    for (const action of autonomyActions) {
      const definition = autonomyActionRegistry[action];
      expect(definition.handler.length).toBeGreaterThan(0);
      if (definition.exposed) expect(definition.handler).not.toBe("unavailable");
    }
  });

  it("enforces distinct automatic, undo, confirm, ask, and never semantics", () => {
    expect(policyDecision(recommendedPolicy, "organize_submitted_work")).toMatchObject({ appliesAutomatically: true, interaction: "none", denied: false });
    expect(policyDecision(recommendedPolicy, "move_unfinished_work")).toMatchObject({ undoRequired: true, interaction: "none" });
    expect(policyDecision(recommendedPolicy, "record_inferred_grades")).toMatchObject({ appliesAutomatically: false, interaction: "proposal", denied: false });
    expect(policyDecision(recommendedPolicy, "change_curriculum_direction")).toMatchObject({ interaction: "clarification" });
    expect(policyDecision(recommendedPolicy, "delete_source_records")).toMatchObject({ appliesAutomatically: false, interaction: "none", denied: true, handler: "unavailable" });
  });

  it("does not allow a custom policy to make high-risk conclusions automatic", () => {
    expect(sanitizePolicy({ record_inferred_grades: "automatic", major_schedule_changes: "automatic_with_undo", delete_source_records: "automatic" })).toEqual({
      record_inferred_grades: "confirm", major_schedule_changes: "confirm", delete_source_records: "never",
    });
  });
});
