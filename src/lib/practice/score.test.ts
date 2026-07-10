import { describe, expect, it } from "vitest";
import { scorePractice } from "./score";

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
