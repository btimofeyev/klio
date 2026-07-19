import { describe, expect, it } from "vitest";
import { conflictDTO, conflictInputSchema } from "./conflict-model";

const timed = {
  studentId: "00000000-0000-4000-8000-000000000001",
  conflictDate: "2026-07-21",
  allDay: false,
  startsAt: "10:00",
  endsAt: "11:30",
  title: "Dentist",
  note: null,
};

describe("calendar conflict mutation input", () => {
  it("accepts a normalized timed conflict", () => {
    expect(conflictInputSchema.parse(timed)).toEqual(timed);
  });

  it("accepts an all-day family conflict without times", () => {
    expect(conflictInputSchema.safeParse({ ...timed, studentId: null, allDay: true, startsAt: null, endsAt: null, title: "Family day" }).success).toBe(true);
  });

  it("rejects an invalid or incomplete time range", () => {
    expect(conflictInputSchema.safeParse({ ...timed, endsAt: "09:59" }).success).toBe(false);
    expect(conflictInputSchema.safeParse({ ...timed, startsAt: null }).success).toBe(false);
    expect(conflictInputSchema.safeParse({ ...timed, startsAt: "9:00" }).success).toBe(false);
  });

  it("rejects arbitrary writable fields and invalid learner ids", () => {
    expect(conflictInputSchema.safeParse({ ...timed, familyId: "00000000-0000-4000-8000-000000000099" }).success).toBe(false);
    expect(conflictInputSchema.safeParse({ ...timed, studentId: "not-a-uuid" }).success).toBe(false);
  });

  it("normalizes database time values in returned DTOs", () => {
    expect(conflictDTO({
      id: "00000000-0000-4000-8000-000000000002",
      student_id: timed.studentId,
      conflict_date: timed.conflictDate,
      all_day: false,
      starts_at: "10:00:00",
      ends_at: "11:30:00",
      title: timed.title,
      note: null,
      created_at: "2026-07-16T12:00:00Z",
      updated_at: "2026-07-16T12:00:00Z",
    })).toMatchObject({ startsAt: "10:00", endsAt: "11:30", studentId: timed.studentId });
  });
});
