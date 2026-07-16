import { describe, expect, it } from "vitest";
import { dynamicPracticeSpecSchema, generatedPracticeSpecSchema, normalizePracticeSpec, parsePracticeSpec } from "./spec";

const dynamic = {
  version: 2 as const,
  subject: "Algebra I",
  skill_key: "algebra.graph-lines",
  level_band: "9",
  instructions: "Complete each activity.",
  mastery_percent: 75,
  activities: [
    { id: "identify", type: "multiple_choice" as const, prompt: "What is the slope?", choices: ["-2", "2"], correct_answer: "-2", hints: ["Look at m."], explanation: "m is -2." },
    { id: "convert", type: "short_answer" as const, prompt: "Rewrite the equation.", accepted_answers: ["y=-2x+5"], hints: [], explanation: "Subtract 2x.", placeholder: "y =" },
    { id: "graph", type: "graph_line" as const, prompt: "Graph the line.", expected_slope: -2, expected_y_intercept: 5, x_min: -6, x_max: 6, y_min: -6, y_max: 6, hints: [], explanation: "Plot the intercept, then use the slope." },
  ],
};

describe("dynamicPracticeSpecSchema", () => {
  it("accepts subject-aware mixed activities", () => expect(dynamicPracticeSpecSchema.parse(dynamic)).toEqual(dynamic));
  it("requires more than one activity type", () => expect(dynamicPracticeSpecSchema.safeParse({ ...dynamic, activities: [dynamic.activities[0], { ...dynamic.activities[0], id: "two" }, { ...dynamic.activities[0], id: "three" }] }).success).toBe(false));
  it("rejects an open-ended worksheet array", () => expect(parsePracticeSpec([{ prompt: "Graph a line" }])).toBeNull());
  it("normalizes legacy multiple-choice practice", () => {
    const normalized = normalizePracticeSpec({ skill_key: "math", level_band: "9", instructions: "Choose.", mastery_percent: 75, questions: [{ prompt: "2+2", choices: ["3", "4"], correct_answer: "4", hints: [] }] });
    expect(normalized?.activities[0]).toMatchObject({ type: "multiple_choice", correct_answer: "4" });
  });
});

describe("generatedPracticeSpecSchema", () => {
  const fiveActivities = [
    ...dynamic.activities,
    { ...dynamic.activities[0], id: "identify-2" },
    { ...dynamic.activities[1], id: "convert-2" },
  ];

  it("requires at least five activities for newly generated practice", () => {
    expect(generatedPracticeSpecSchema.safeParse({ ...dynamic, activities: fiveActivities.slice(0, 4) }).success).toBe(false);
    expect(generatedPracticeSpecSchema.safeParse({ ...dynamic, activities: fiveActivities }).success).toBe(true);
  });
});
