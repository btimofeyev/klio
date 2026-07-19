import { describe, expect, it } from "vitest";
import { shouldEnqueueWeeklyBriefing, weeklyBriefingSchedule } from "./weekly-schedule";

describe("weekly briefing schedule", () => {
  it("is not due before 5:00 Monday in the family timezone", () => {
    expect(weeklyBriefingSchedule(new Date("2026-07-13T08:59:00Z"), "America/New_York")).toMatchObject({
      localDate: "2026-07-13", localHour: 4, localMinute: 59, weekStart: "2026-07-13", due: false,
    });
  });

  it("becomes due at 5:00 Monday and remains due later Monday", () => {
    expect(weeklyBriefingSchedule(new Date("2026-07-13T09:00:00Z"), "America/New_York")?.due).toBe(true);
    expect(weeklyBriefingSchedule(new Date("2026-07-13T18:45:00Z"), "America/New_York")?.due).toBe(true);
  });

  it.each([
    ["Tuesday", "2026-07-14T17:00:00Z"],
    ["Friday", "2026-07-17T17:00:00Z"],
  ])("catches up on %s when the current week was missed", (_label, now) => {
    expect(weeklyBriefingSchedule(new Date(now), "America/New_York")).toMatchObject({ weekStart: "2026-07-13", due: true, idempotencyKey: "weekly-briefing:2026-07-13" });
  });

  it("prevents an already-enqueued family/week identity", () => {
    expect(shouldEnqueueWeeklyBriefing(new Date("2026-07-14T17:00:00Z"), "America/New_York", ["weekly-briefing:2026-07-13"])).toBe(false);
  });

  it("evaluates two timezones independently at the same instant", () => {
    const now = new Date("2026-07-13T10:00:00Z");
    expect(weeklyBriefingSchedule(now, "Pacific/Honolulu")).toMatchObject({ localDate: "2026-07-13", localHour: 0, due: false });
    expect(weeklyBriefingSchedule(now, "Asia/Tokyo")).toMatchObject({ localDate: "2026-07-13", localHour: 19, due: true });
  });

  it("uses timezone rules across the daylight-saving boundary", () => {
    expect(weeklyBriefingSchedule(new Date("2026-03-09T08:59:00Z"), "America/New_York")?.due).toBe(false);
    expect(weeklyBriefingSchedule(new Date("2026-03-09T09:00:00Z"), "America/New_York")).toMatchObject({ localHour: 5, due: true, weekStart: "2026-03-09" });
  });

  it("keeps Sunday in the week that began the prior Monday", () => {
    expect(weeklyBriefingSchedule(new Date("2026-07-19T16:00:00Z"), "America/New_York")).toMatchObject({ localDate: "2026-07-19", weekStart: "2026-07-13", weekEnd: "2026-07-19", due: true });
  });

  it("returns no decision for an invalid family timezone", () => {
    expect(weeklyBriefingSchedule(new Date("2026-07-13T12:00:00Z"), "Deleted/Timezone")).toBeNull();
  });
});
