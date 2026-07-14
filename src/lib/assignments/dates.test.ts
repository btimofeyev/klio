import { describe, expect, it } from "vitest";
import { learnerWeekdays } from "./dates";

describe("learnerWeekdays", () => {
  it("uses the learner’s schedule instead of the family default", () => {
    expect(learnerWeekdays({ learningDays: ["Tue", "Thu"] }, ["Mon", "Wed", "Fri"])).toEqual([2, 4]);
  });

  it("falls back to the family schedule for learners without one", () => {
    expect(learnerWeekdays({}, ["Monday", "Wednesday", "Friday"])).toEqual([1, 3, 5]);
  });
});
