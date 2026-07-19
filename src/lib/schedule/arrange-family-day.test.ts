import { describe, expect, it } from "vitest";
import { arrangeFamilyDay, type FamilyDayAssignment } from "./arrange-family-day";
import { resolveAttentionRequirement } from "./parent-attention";

const req = (mode: "unspecified" | "parent_led" | "independent" | "flexible", lessonMinutes = 30, parentMinutes?: number) => resolveAttentionRequirement({ assignmentMode: mode, assignmentParentMinutes: parentMinutes, lessonMinutes });
const work = (id: string, studentId: string, mode: Parameters<typeof req>[0], extras: Partial<FamilyDayAssignment> = {}): FamilyDayAssignment => ({ id, studentId, requirement: req(mode, 30, mode === "flexible" ? 10 : undefined), ...extras });
const availability = (ids = ["maya", "noah"]) => Object.fromEntries(ids.map((id) => [id, { availableMinutes: 180, teachingWindow: { start: "09:00", end: "12:00" }, blockedIntervals: [] }]));

describe("arrangeFamilyDay", () => {
  it("serializes sibling parent-led work and overlaps independent work safely", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("maya-math", "maya", "parent_led"), work("noah-writing", "noah", "parent_led"), work("noah-reading", "noah", "independent")], availability: availability() });
    expect(result.ok).toBe(true);
    expect(result.parentAttentionIntervals).toEqual([
      expect.objectContaining({ assignmentId: "maya-math", start: 540, end: 570 }),
      expect.objectContaining({ assignmentId: "noah-writing", start: 570, end: 600 }),
    ]);
    expect(result.placements.find((item) => item.assignmentId === "noah-reading")?.start).toBe(540);
  });

  it("releases the parent after a flexible introduction", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("maya-practice", "maya", "flexible", { scheduledTime: "09:00", fixed: true }), work("noah-writing", "noah", "parent_led")], availability: availability() });
    expect(result.ok).toBe(true);
    expect(result.placements.find((item) => item.assignmentId === "noah-writing")?.start).toBe(550);
    expect(result.placements.find((item) => item.assignmentId === "maya-practice")?.end).toBe(570);
  });

  it("handles three learners deterministically regardless of input order", () => {
    const assignments = [work("c", "learner-c", "independent"), work("a", "learner-a", "parent_led"), work("b", "learner-b", "parent_led")];
    const first = arrangeFamilyDay({ date: "2026-07-20", assignments, availability: availability(["learner-a", "learner-b", "learner-c"]) });
    const second = arrangeFamilyDay({ date: "2026-07-20", assignments: [...assignments].reverse(), availability: availability(["learner-a", "learner-b", "learner-c"]) });
    expect(first.proposedScheduledTimes).toEqual(second.proposedScheduledTimes);
  });

  it("preserves valid fixed work", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("fixed", "maya", "parent_led", { scheduledTime: "10:00", fixed: true }), work("new", "noah", "parent_led")], availability: availability() });
    expect(result.ok).toBe(true);
    expect(result.placements.find((item) => item.assignmentId === "fixed")).toMatchObject({ start: 600, preserved: true });
  });

  it("returns a bounded failure for a fixed parent collision", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("a", "maya", "parent_led", { scheduledTime: "10:00", fixed: true }), work("b", "noah", "parent_led", { scheduledTime: "10:00", fixed: true })], availability: availability() });
    expect(result).toMatchObject({ ok: false, reason: "fixed_time_collision", placements: [], proposedScheduledTimes: [] });
  });

  it("never overlaps work for the same learner", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("a", "maya", "parent_led"), work("b", "maya", "independent")], availability: availability(["maya"]) });
    expect(result.ok).toBe(true);
    expect(result.placements.map((item) => item.start)).toEqual([540, 570]);
  });

  it("preserves curriculum sequence", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("later", "maya", "parent_led", { curriculumUnitId: "math", sequenceNumber: 2 }), work("earlier", "maya", "independent", { curriculumUnitId: "math", sequenceNumber: 1 })], availability: availability(["maya"]) });
    expect(result.ok).toBe(true);
    expect(result.placements.map((item) => item.assignmentId)).toEqual(["earlier", "later"]);
  });

  it("respects learner capacity and all-day conflicts", () => {
    const capacity = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("a", "maya", "parent_led"), work("b", "maya", "independent")], availability: { maya: { availableMinutes: 45, teachingWindow: { start: "09:00", end: "12:00" } } } });
    expect(capacity.reason).toBe("insufficient_learner_time");
    const blocked = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("a", "maya", "parent_led")], availability: { maya: { availableMinutes: 0, allDayBlocked: true } } });
    expect(blocked.reason).toBe("blocked_by_conflicts");
  });

  it("respects teaching-window boundaries and overlapping calendar conflicts", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("a", "maya", "parent_led")], availability: { maya: { availableMinutes: 60, teachingWindow: { start: "09:00", end: "11:00" }, blockedIntervals: [{ start: 540, end: 585 }, { start: 570, end: 600 }] } } });
    expect(result.ok).toBe(true);
    expect(result.placements[0].start).toBe(600);
  });

  it("reports insufficient shared parent time without returning a partial schedule", () => {
    const result = arrangeFamilyDay({ date: "2026-07-20", assignments: [work("a", "maya", "parent_led", { requirement: req("parent_led", 40) }), work("b", "noah", "parent_led", { requirement: req("parent_led", 40) })], availability: { maya: { availableMinutes: 40, teachingWindow: { start: "09:00", end: "09:40" } }, noah: { availableMinutes: 40, teachingWindow: { start: "09:00", end: "09:40" } } } });
    expect(result).toMatchObject({ ok: false, reason: "insufficient_parent_time", placements: [] });
  });
});
