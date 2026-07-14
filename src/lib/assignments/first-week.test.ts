import { describe, expect, it } from "vitest";
import { buildFirstWeekAssignments } from "./first-week";

const units = ["Math", "English", "Science", "History", "Bible"].map((subject, index) => ({
  id: `unit-${index}`,
  subject,
  title: `${subject} course`,
  sequenceLabel: "Lesson",
  nextSequenceNumber: 1,
  defaultMinutes: 40,
  weeklyFrequency: 2,
  curriculumUrl: null,
  scheduledTime: null,
}));

describe("buildFirstWeekAssignments", () => {
  it("balances curricula across the week without exceeding daily capacity", () => {
    const result = buildFirstWeekAssignments({ units, dates: ["2026-07-13", "2026-07-14"], existing: [], dailyCapacityMinutes: 120 });
    expect(result).toHaveLength(10);
    expect(result.filter((item) => item.scheduledDate === "2026-07-13")).toHaveLength(5);
    expect(result.filter((item) => item.scheduledDate === "2026-07-14")).toHaveLength(5);
    expect(new Set(result.filter((item) => item.scheduledDate === "2026-07-13").map((item) => item.curriculumUnitId)).size).toBe(5);
    expect(result.every((item) => item.estimatedMinutes === 20)).toBe(true);
    expect(result.find((item) => item.curriculumUnitId === "unit-1")?.sequenceNumber).toBe(1);
    expect(result.filter((item) => item.curriculumUnitId === "unit-1").at(-1)?.sequenceNumber).toBe(2);
  });

  it("keeps existing work and does not repeat a curriculum on the same day", () => {
    const result = buildFirstWeekAssignments({
      units: units.map((unit) => ({ ...unit, weeklyFrequency: 1 })),
      dates: ["2026-07-13"],
      dailyCapacityMinutes: 120,
      existing: [{ curriculumUnitId: "unit-0", scheduledDate: "2026-07-13", estimatedMinutes: 40, status: "planned" }],
    });
    expect(result).toHaveLength(4);
    expect(result.some((item) => item.curriculumUnitId === "unit-0")).toBe(false);
  });

  it("honors five sessions per subject and shortens blocks to fit weekly capacity", () => {
    const dailyUnits = Array.from({ length: 6 }, (_, index) => ({ ...units[index % units.length], id: `daily-${index}`, weeklyFrequency: 5 }));
    const result = buildFirstWeekAssignments({ dailyCapacityMinutes: 180, existing: [], units: dailyUnits, dates: ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"] });
    expect(result).toHaveLength(30);
    expect(new Set(result.map((item) => item.curriculumUnitId)).size).toBe(6);
    expect(result.every((item) => item.estimatedMinutes === 30)).toBe(true);
    expect(["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"].every((date) => result.filter((item) => item.scheduledDate === date).length === 6)).toBe(true);
  });

  it("balances a high-school learner's four-times-per-week subjects onto lighter days", () => {
    const jacobUnits = ["Bible", "History", "Literature", "Math", "Science", "Writing and Grammar"].map((subject, index) => ({
      ...units[index % units.length], id: `jacob-${index}`, subject, title: subject, weeklyFrequency: 4,
    }));
    const dates = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];
    const result = buildFirstWeekAssignments({ dailyCapacityMinutes: 180, existing: [], units: jacobUnits, dates });
    expect(result).toHaveLength(24);
    expect(jacobUnits.every((unit) => result.filter((item) => item.curriculumUnitId === unit.id).length === 4)).toBe(true);
    expect(dates.every((date) => result.filter((item) => item.scheduledDate === date).reduce((sum, item) => sum + item.estimatedMinutes, 0) <= 180)).toBe(true);
  });

  it("fits a younger learner's four subjects into a ninety-minute day", () => {
    const malachiUnits = ["Bible", "Math", "Phonics", "Spelling"].map((subject, index) => ({
      ...units[index], id: `malachi-${index}`, subject, title: subject, weeklyFrequency: 4,
    }));
    const dates = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];
    const result = buildFirstWeekAssignments({ dailyCapacityMinutes: 90, existing: [], units: malachiUnits, dates });
    expect(result).toHaveLength(16);
    expect(malachiUnits.every((unit) => result.filter((item) => item.curriculumUnitId === unit.id).length === 4)).toBe(true);
    expect(dates.every((date) => result.filter((item) => item.scheduledDate === date).reduce((sum, item) => sum + item.estimatedMinutes, 0) <= 90)).toBe(true);
  });
});
