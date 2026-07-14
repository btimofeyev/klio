import { describe, expect, it } from "vitest";
import { nextLearningDate } from "@/lib/schedule/dates";

describe("family learning dates", () => {
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  it("moves unfinished Friday work to Monday", () => {
    expect(nextLearningDate("2026-07-17", weekdays, "America/New_York")).toBe("2026-07-20");
  });

  it("uses the family timezone when an unscheduled item moves forward", () => {
    const lateSundayUtc = new Date("2026-07-13T02:00:00.000Z");
    expect(nextLearningDate(null, weekdays, "America/New_York", lateSundayUtc)).toBe("2026-07-13");
  });
});
