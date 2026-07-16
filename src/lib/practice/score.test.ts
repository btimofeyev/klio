import { describe, expect, it } from "vitest";
import { evaluateActivityAnswer, scoreDynamicPractice, scorePractice } from "./score";

describe("scorePractice", () => {
  const questions = [{ correct_answer: "Mercury" }, { correct_answer: "8" }];

  it("scores complete answers and applies mastery", () => {
    expect(scorePractice(questions, [" mercury ", "8"], 80)).toEqual({ score: 100, masteryMet: true, complete: true });
    expect(scorePractice(questions, ["Venus", "8"], 80)).toEqual({ score: 50, masteryMet: false, complete: true });
  });

  it("does not score an incomplete result", () => {
    expect(scorePractice(questions, ["Mercury"], 80)).toEqual({ score: 0, masteryMet: false, complete: false });
  });
});

describe("dynamic practice scoring", () => {
  const spec = {
    version: 2 as const, subject: "Algebra I", skill_key: "graphing", level_band: "9", instructions: "Practice", mastery_percent: 75,
    activities: [
      { id: "choice", type: "multiple_choice" as const, prompt: "Slope?", choices: ["-2", "2"], correct_answer: "-2", hints: [], explanation: "m=-2" },
      { id: "text", type: "short_answer" as const, prompt: "Convert", accepted_answers: ["y = -2x + 5"], hints: [], explanation: "Subtract 2x." },
      { id: "graph", type: "graph_line" as const, prompt: "Graph", expected_slope: -2, expected_y_intercept: 5, x_min: -6, x_max: 6, y_min: -6, y_max: 6, hints: [], explanation: "Use the slope." },
      { id: "explain", type: "written_response" as const, prompt: "Explain", success_criteria: ["Mentions direction"], max_length: 500, hints: [], explanation: "Review with a parent." },
    ],
  };

  it("scores graph coordinates by slope and intercept", () => {
    expect(evaluateActivityAnswer(spec.activities[2], { activityId: "graph", type: "graph_line", points: [{ x: 0, y: 5 }, { x: 1, y: 3 }] })).toBe(true);
  });

  it("scores auto-graded activities and flags written review", () => {
    const result = scoreDynamicPractice(spec, [
      { activityId: "choice", type: "multiple_choice", value: "-2" },
      { activityId: "text", type: "short_answer", value: "y=-2x+5" },
      { activityId: "graph", type: "graph_line", points: [{ x: 0, y: 5 }, { x: 1, y: 3 }] },
      { activityId: "explain", type: "written_response", value: "It falls as x increases." },
    ]);
    expect(result).toMatchObject({ score: 100, masteryMet: false, complete: true, gradedCount: 3, reviewNeeded: true, scoringState: "provisional" });
  });

  it("never declares mastery when all responses require parent review", () => {
    const written = {
      ...spec,
      activities: [{ id: "written", type: "written_response" as const, prompt: "Explain", success_criteria: ["Uses evidence"], max_length: 500, hints: [], explanation: "Review with a parent." }],
    };
    expect(scoreDynamicPractice(written, [{ activityId: "written", type: "written_response", value: "My explanation" }]))
      .toMatchObject({ score: 0, masteryMet: false, reviewNeeded: true, scoringState: "provisional" });
  });

  it("includes a Klio-reviewed written response in the final result", () => {
    const result = scoreDynamicPractice(spec, [
      { activityId: "choice", type: "multiple_choice", value: "-2" },
      { activityId: "text", type: "short_answer", value: "y=-2x+5" },
      { activityId: "graph", type: "graph_line", points: [{ x: 0, y: 5 }, { x: 1, y: 3 }] },
      { activityId: "explain", type: "written_response", value: "It falls as x increases." },
    ], new Map([["explain", true]]));
    expect(result).toMatchObject({ score: 100, masteryMet: true, complete: true, gradedCount: 4, reviewNeeded: false, scoringState: "final" });
  });
});
