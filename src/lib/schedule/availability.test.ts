import { describe, expect, it } from "vitest";
import {
  analyzeDayLoad,
  effectiveAvailability,
  lessonOverlapsConflict,
  mergeIntervals,
  mergeSchedulePreferences,
  parseSchedulePreferences,
  type CalendarConflict,
} from "./availability";

const date = "2026-07-14"; // Tuesday
const studentId = "learner-a";
const timed = (start: string, end: string, appliesTo: string | null = studentId, id = `${start}-${end}`): CalendarConflict => ({
  id, studentId: appliesTo, conflictDate: date, allDay: false, startsAt: start, endsAt: end, title: "Appointment",
});
const availability = (overrides: Partial<Parameters<typeof effectiveAvailability>[0]> = {}) => effectiveAvailability({
  date, studentId, dailyCapacityMinutes: 180,
  schedulePreferences: { learningDays: ["Tue"] }, conflicts: [], ...overrides,
});

describe("teaching availability", () => {
  it("keeps existing flexible learners limited by daily capacity", () => {
    expect(availability().availableMinutes).toBe(180);
  });

  it("returns zero on a non-learning day", () => {
    expect(availability({ schedulePreferences: { learningDays: ["Mon"] } }).availableMinutes).toBe(0);
  });

  it("uses the smaller of the teaching window and daily capacity", () => {
    expect(availability({ schedulePreferences: { learningDays: ["Tue"], teachingWindows: { Tue: { start: "09:00", end: "11:00" } } } }).availableMinutes).toBe(120);
    expect(availability({ dailyCapacityMinutes: 90, schedulePreferences: { learningDays: ["Tue"], teachingWindows: { Tue: { start: "09:00", end: "12:00" } } } }).availableMinutes).toBe(90);
  });

  it("subtracts only the portion of a conflict inside a teaching window", () => {
    const schedulePreferences = { learningDays: ["Tue"], teachingWindows: { Tue: { start: "09:00", end: "12:00" } } };
    expect(availability({ schedulePreferences, conflicts: [timed("10:00", "10:45")] }).availableMinutes).toBe(135);
    expect(availability({ schedulePreferences, conflicts: [timed("08:30", "09:30")] }).availableMinutes).toBe(150);
    expect(availability({ schedulePreferences, conflicts: [timed("13:00", "14:00")] }).availableMinutes).toBe(180);
  });

  it("merges overlapping conflicts before subtraction", () => {
    expect(mergeIntervals([{ start: 600, end: 660 }, { start: 630, end: 720 }])).toEqual([{ start: 600, end: 720 }]);
    expect(availability({ conflicts: [timed("10:00", "11:00"), timed("10:30", "12:00")] }).availableMinutes).toBe(60);
  });

  it("applies family conflicts to siblings and isolates learner conflicts", () => {
    expect(availability({ conflicts: [timed("10:00", "11:00", null)] }).availableMinutes).toBe(120);
    expect(availability({ studentId: "learner-b", conflicts: [timed("10:00", "11:00", studentId)] }).availableMinutes).toBe(180);
  });

  it("returns zero for an applicable all-day conflict", () => {
    const conflict: CalendarConflict = { id: "all-day", studentId: null, conflictDate: date, allDay: true, startsAt: null, endsAt: null, title: "Family day" };
    expect(availability({ conflicts: [conflict] })).toMatchObject({ availableMinutes: 0, allDayBlocked: true });
  });

  it("subtracts timed conflicts from flexible teaching capacity", () => {
    expect(availability({ conflicts: [timed("10:00", "11:30")] }).availableMinutes).toBe(90);
  });

  it("parses dates without crossing midnight or timezone boundaries", () => {
    expect(availability({ date: "2026-07-15", schedulePreferences: { learningDays: ["Tue"] } }).availableMinutes).toBe(0);
    expect(availability({ date: "2026-07-14", schedulePreferences: { learningDays: ["Tue"] } }).availableMinutes).toBe(180);
  });

  it("rejects invalid teaching-window input and ignores invalid stored input", () => {
    expect(() => mergeSchedulePreferences({}, { learningDays: ["Tue"], teachingWindows: { Tue: { start: "12:00", end: "12:20" } } })).toThrow(/at least 30 minutes/i);
    expect(parseSchedulePreferences({ learningDays: ["Tue"], teachingWindows: { Tue: { start: "nope", end: "12:00" } } }).teachingWindows).toEqual({});
  });

  it("preserves unrelated valid preference keys while replacing visible rules", () => {
    expect(mergeSchedulePreferences({ pacing: { style: "steady" }, learningDays: ["Mon"] }, { learningDays: ["Tue"], teachingWindows: {} })).toEqual({ pacing: { style: "steady" }, learningDays: ["Tue"], teachingWindows: {} });
  });
});

describe("affected scheduled work", () => {
  it("detects a timed lesson overlap", () => {
    expect(lessonOverlapsConflict({ id: "math", studentId, scheduledDate: date, scheduledTime: "10:30", estimatedMinutes: 45 }, timed("11:00", "12:00"))).toBe(true);
  });

  it("counts untimed work toward daily load without claiming a clock overlap", () => {
    const result = analyzeDayLoad({
      date, studentId, dailyCapacityMinutes: 60, schedulePreferences: { learningDays: ["Tue"] }, conflicts: [timed("10:00", "10:30")],
      assignments: [{ id: "reading", studentId, scheduledDate: date, scheduledTime: null, estimatedMinutes: 45 }],
    });
    expect(result.directOverlapIds).toEqual([]);
    expect(result).toMatchObject({ plannedMinutes: 45, availableMinutes: 30, overCapacity: true });
  });
});
