import { describe, expect, it } from "vitest";
import { practiceQualityIssues } from "./quality";
import type { DynamicPracticeSpec } from "./spec";

describe("practice quality", () => {
  it("accepts a varied practice that keeps answers hidden", () => {
    expect(practiceQualityIssues(practice())).toEqual([]);
  });

  it("rejects answer leaks, repeated prompts, repeated answers, and recognition-heavy sets", () => {
    const spec = practice();
    spec.activities = [
      choice("one", "What is 6 + 7?", "13", "The answer is 13."),
      choice("two", "What is 6 + 7?", "13"),
      choice("three", "Which value is correct?", "13"),
      choice("four", "Choose the sum of 8 and 9.", "17"),
      written("five", "Explain how regrouping works."),
    ];
    expect(practiceQualityIssues(spec).map((issue) => issue.code)).toEqual(expect.arrayContaining(["answer_leak", "duplicate_prompt", "repeated_answer", "recognition_heavy"]));
  });
});

function practice(): DynamicPracticeSpec {
  return {
    version: 2,
    subject: "Mathematics",
    skill_key: "addition.regrouping",
    level_band: "k-2",
    instructions: "Solve each problem and show the important step.",
    mastery_percent: 80,
    activities: [
      short("one", "Solve 28 + 17.", "45"),
      short("two", "Solve 46 + 38.", "84"),
      short("three", "Solve 57 + 26.", "83"),
      choice("four", "Which sum needs regrouping?", "6 + 7"),
      written("five", "Explain why 37 + 25 needs regrouping."),
    ],
  };
}

function short(id: string, prompt: string, answer: string) {
  return { id, type: "short_answer" as const, prompt, accepted_answers: [answer], hints: ["Add the ones first."], explanation: `The result is ${answer}.` };
}

function choice(id: string, prompt: string, answer: string, hint = "Compare each choice to the rule.") {
  return { id, type: "multiple_choice" as const, prompt, choices: [answer, "another choice"], correct_answer: answer, hints: [hint], explanation: `${answer} follows the rule.` };
}

function written(id: string, prompt: string) {
  return { id, type: "written_response" as const, prompt, success_criteria: ["Uses a worked step"], hints: ["Start with the ones."], explanation: "The ones make a new ten.", max_length: 400 };
}
