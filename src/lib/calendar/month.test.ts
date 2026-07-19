import { describe, expect, it } from "vitest";
import { monthGrid, sameLocalDate, shiftMonth } from "./month";

describe("Monday-first month grid", () => {
  it("includes leading and trailing dates", () => {
    const july = monthGrid("2026-07-16");
    expect(july[0]).toEqual({ date: "2026-06-29", inMonth: false });
    expect(july.at(-1)).toEqual({ date: "2026-08-02", inMonth: false });
    expect(july).toHaveLength(35);
  });

  it("handles leap-year February", () => {
    const february = monthGrid("2028-02-10");
    expect(february.some((day) => day.date === "2028-02-29" && day.inMonth)).toBe(true);
  });

  it("handles year transitions", () => {
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftMonth("2027-01-15", -1)).toBe("2026-12-01");
  });

  it("detects the current local date without timezone conversion", () => {
    expect(sameLocalDate("2026-07-16", "2026-07-16")).toBe(true);
    expect(sameLocalDate("2026-07-16", "2026-07-17")).toBe(false);
  });

  it("does not shift a date in a western browser timezone", () => {
    expect(monthGrid("2026-03-01").find((day) => day.inMonth)?.date).toBe("2026-03-01");
  });
});
