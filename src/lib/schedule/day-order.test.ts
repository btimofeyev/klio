import { describe, expect, it } from "vitest";
import { dayOrderTimeUpdates, reorderDayIds } from "./day-order";

describe("daily lesson order", () => {
  it("moves a lesson before or after a drop target", () => {
    expect(reorderDayIds(["a", "b", "c", "d"], "a", "c", false)).toEqual(["b", "a", "c", "d"]);
    expect(reorderDayIds(["a", "b", "c", "d"], "a", "c", true)).toEqual(["b", "c", "a", "d"]);
  });

  it("preserves the day’s existing time slots while changing their assignment order", () => {
    expect(dayOrderTimeUpdates([
      { id: "a", scheduledTime: "08:30:00" },
      { id: "b", scheduledTime: "09:15:00" },
      { id: "c", scheduledTime: "10:00:00" },
    ], ["c", "a", "b"])).toEqual([
      { id: "c", scheduledTime: "08:30:00", previousTime: "10:00:00", position: 0 },
      { id: "a", scheduledTime: "09:15:00", previousTime: "08:30:00", position: 1 },
      { id: "b", scheduledTime: "10:00:00", previousTime: "09:15:00", position: 2 },
    ]);
  });

  it("creates stable slots when unscheduled lessons are mixed in", () => {
    expect(dayOrderTimeUpdates([
      { id: "a", scheduledTime: null },
      { id: "b", scheduledTime: "09:00:00" },
    ], ["b", "a"]).map((item) => item.scheduledTime)).toEqual(["09:00:00", "09:05:00"]);
  });

  it("rejects missing, duplicated, or foreign assignment ids", () => {
    expect(() => dayOrderTimeUpdates([{ id: "a", scheduledTime: null }], ["other"])).toThrow("INVALID_DAY_ORDER");
    expect(() => dayOrderTimeUpdates([{ id: "a", scheduledTime: null }, { id: "b", scheduledTime: null }], ["a", "a"])).toThrow("INVALID_DAY_ORDER");
  });
});
