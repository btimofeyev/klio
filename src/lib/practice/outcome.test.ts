import { describe, expect, it } from "vitest";
import { buildPracticeOutcome } from "./outcome";

describe("buildPracticeOutcome", () => {
  it("keeps a mastered result concise and leaves curriculum unchanged", () => {
    expect(buildPracticeOutcome({ learnerName: "Noah", subject: "Math", skillKey: "adding_with_regrouping", score: 83, masteryMet: true, reviewNeeded: false })).toMatchObject({
      kind: "understood",
      title: "Noah showed good understanding",
      summary: expect.stringContaining("Regular lessons stay as planned"),
    });
  });

  it("offers support without claiming mastery", () => {
    expect(buildPracticeOutcome({ learnerName: "Noah", subject: "Math", skillKey: "adding_with_regrouping", score: 50, masteryMet: false, reviewNeeded: false })).toMatchObject({
      kind: "needs_support",
      title: "Noah still needs support with adding with regrouping",
    });
  });

  it("does not finalize a written response before it is checked", () => {
    expect(buildPracticeOutcome({ learnerName: "Maya", subject: "Science", skillKey: "osmosis_explanations", score: 100, masteryMet: false, reviewNeeded: true }).kind).toBe("checking");
  });
});
