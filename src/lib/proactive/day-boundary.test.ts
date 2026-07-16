import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { isOperationalScheduleReminder } from "./evaluate";

describe("day-boundary operational reminders", () => {
  it("only treats exact lesson rescheduling reminders as executable schedule work", () => {
    expect(isOperationalScheduleReminder("Reschedule World History · Lesson 12")).toBe(true);
    expect(isOperationalScheduleReminder("Reschedule dentist appointment")).toBe(false);
    expect(isOperationalScheduleReminder("Review World History · Lesson 12")).toBe(false);
  });
});
