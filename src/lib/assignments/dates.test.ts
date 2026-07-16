import { describe, expect, it } from "vitest";
import { learnerWeekdays, learningWeekDates } from "./dates";

describe("learnerWeekdays", () => {
  it("uses the learner’s schedule instead of the family default", () => {
    expect(learnerWeekdays({ learningDays: ["Tue", "Thu"] }, ["Mon", "Wed", "Fri"])).toEqual([2, 4]);
  });

  it("falls back to the family schedule for learners without one", () => {
    expect(learnerWeekdays({}, ["Monday", "Wednesday", "Friday"])).toEqual([1, 3, 5]);
  });
});

describe("learningWeekDates", () => {
  it("keeps weekends out until the parent enables them", () => {
    expect(learningWeekDates("2026-07-15", [1, 2, 3, 4, 5])).toEqual([
      "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
    ]);
    expect(learningWeekDates("2026-07-15", [1, 2, 3, 4, 5, 6])).toContain("2026-07-18");
  });

  it("does not leak sparse learning days into the following week", () => {
    expect(learningWeekDates("2026-07-15", [2, 4])).toEqual(["2026-07-14", "2026-07-16"]);
  });
});
