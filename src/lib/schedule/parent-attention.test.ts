import { describe, expect, it } from "vitest";
import {
  calculateSharedParentAvailableMinutes,
  calculateConcurrentIndependentMinutes,
  calculateDailyParentMinutes,
  findParentAttentionConflicts,
  intervalsOverlap,
  lessonInterval,
  parentAttentionInterval,
  resolveAttentionRequirement,
  validateAttentionMode,
} from "./parent-attention";

const resolved = (assignmentMode: unknown, curriculumMode: unknown = "independent", lessonMinutes = 40, assignmentParentMinutes?: unknown, curriculumParentMinutes?: unknown) => resolveAttentionRequirement({ assignmentMode, curriculumMode, lessonMinutes, assignmentParentMinutes, curriculumParentMinutes });

describe("parent attention resolver", () => {
  it("uses an assignment override before the curriculum default", () => {
    expect(resolved("parent_led")).toMatchObject({ mode: "parent_led", parentMinutes: 40, inherited: false, source: "assignment" });
  });

  it("inherits the curriculum default when no override exists", () => {
    expect(resolved(null, "independent")).toMatchObject({ mode: "independent", parentMinutes: 0, inherited: true, source: "curriculum" });
  });

  it("falls back conservatively when no curriculum exists", () => {
    expect(resolveAttentionRequirement({ lessonMinutes: 35 })).toMatchObject({ mode: "unspecified", parentMinutes: 35, source: "fallback" });
  });

  it("resolves parent-led, independent, and flexible minutes", () => {
    expect(resolved("parent_led", null, 45).parentMinutes).toBe(45);
    expect(resolved("independent", null, 45).parentMinutes).toBe(0);
    expect(resolved("flexible", null, 45, 10).parentMinutes).toBe(10);
    expect(calculateDailyParentMinutes([resolved("parent_led"), resolved("independent"), resolved("flexible", null, 30, 5)])).toBe(45);
  });

  it("rejects invalid modes and impossible flexible minutes", () => {
    expect(() => validateAttentionMode("together")).toThrow(/valid parent support/i);
    expect(() => resolved("flexible", null, 30, 31)).toThrow(/longer than the lesson/i);
    expect(() => resolved("flexible", null, 30, 0)).toThrow(/between 1 and 480/i);
  });

  it("handles missing duration without inventing parent minutes", () => {
    expect(resolveAttentionRequirement({ curriculumMode: "parent_led" })).toMatchObject({ lessonMinutes: 0, parentMinutes: 0 });
    expect(() => resolveAttentionRequirement({ curriculumMode: "flexible", curriculumParentMinutes: 10 })).toThrow(/lesson length/i);
  });
});

describe("parent attention intervals", () => {
  it("finds overlapping sibling parent-led lessons and treats adjacent work as safe", () => {
    const first = { id: "a", studentId: "maya", scheduledStart: "09:00", requirement: resolved("parent_led") };
    const overlap = { id: "b", studentId: "noah", scheduledStart: "09:20", requirement: resolved("parent_led") };
    const adjacent = { id: "c", studentId: "noah", scheduledStart: "09:40", requirement: resolved("parent_led") };
    expect(findParentAttentionConflicts([first, overlap])).toHaveLength(1);
    expect(findParentAttentionConflicts([first, adjacent])).toHaveLength(0);
  });

  it("allows independent sibling work during parent instruction", () => {
    const work = [
      { id: "teach", studentId: "maya", scheduledStart: "09:00", requirement: resolved("parent_led") },
      { id: "read", studentId: "noah", scheduledStart: "09:00", requirement: resolved("independent", null, 30) },
    ];
    expect(findParentAttentionConflicts(work)).toHaveLength(0);
    expect(calculateConcurrentIndependentMinutes(work)).toBe(30);
  });

  it("blocks only the flexible introduction and releases the parent afterward", () => {
    const flexible = resolved("flexible", null, 30, 10);
    expect(parentAttentionInterval("09:45", flexible)).toEqual({ start: 585, end: 595 });
    expect(lessonInterval("09:45", 30)).toEqual({ start: 585, end: 615 });
    const sibling = { id: "sibling", studentId: "noah", scheduledStart: "09:55", requirement: resolved("parent_led", null, 30) };
    expect(findParentAttentionConflicts([{ id: "flex", studentId: "maya", scheduledStart: "09:45", requirement: flexible }, sibling])).toHaveLength(0);
  });

  it("treats unspecified work conservatively", () => {
    const requirement = resolveAttentionRequirement({ lessonMinutes: 30 });
    expect(parentAttentionInterval("10:00", requirement)).toEqual({ start: 600, end: 630 });
  });

  it("keeps half-open interval boundaries", () => {
    expect(intervalsOverlap({ start: 540, end: 570 }, { start: 570, end: 600 })).toBe(false);
  });

  it("calculates shared parent availability from overlapping teaching windows and conflicts", () => {
    expect(calculateSharedParentAvailableMinutes([
      { availableMinutes: 120, teachingWindow: { start: "09:00", end: "11:00" }, blockedIntervals: [{ start: 600, end: 630 }] },
      { availableMinutes: 90, teachingWindow: { start: "09:30", end: "11:00" }, blockedIntervals: [] },
    ])).toBe(120);
    expect(calculateSharedParentAvailableMinutes([{ availableMinutes: 90 }, { availableMinutes: 60 }])).toBe(150);
  });
});
