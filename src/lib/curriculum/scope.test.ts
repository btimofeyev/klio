import { describe, expect, it } from "vitest";
import {
  assignmentAllowsDescriptiveRewrite,
  buildGenericScope,
  classifyConfirmedMaterialChanges,
  evaluateTargetChange,
  genericScopeTitle,
  isUntouchedPlaceholder,
  normalizeCurriculumItemKind,
  normalizeCurriculumPath,
  selectNextEligibleScopeItems,
  type EligibleScopeItem,
  type ScopeAssignmentState,
} from "./scope";

describe("generic curriculum scope", () => {
  it("builds exactly 100 calm unscheduled-ready placeholders by default", () => {
    const rows = buildGenericScope({ courseTitle: "English 7" });
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({ title: "English 7 · Lesson 1", sequenceNumber: 1, curriculumItemKind: "lesson", curriculumItemState: "placeholder", curriculumPath: [] });
    expect(rows.at(-1)?.title).toBe("English 7 · Lesson 100");
  });

  it("supports a custom bounded target and sequence label", () => {
    expect(buildGenericScope({ courseTitle: "Biology", sequenceLabel: "Session", targetLessonCount: 3 }).map((row) => row.title)).toEqual([
      "Biology · Session 1", "Biology · Session 2", "Biology · Session 3",
    ]);
    expect(() => buildGenericScope({ courseTitle: "Biology", targetLessonCount: 501 })).toThrow();
  });

  it("keeps assessment vocabulary separate from the pacing number", () => {
    expect(genericScopeTitle("Math", "Lesson", 23)).toBe("Math · Lesson 23");
    expect(normalizeCurriculumItemKind("assessment")).toBe("assessment");
    expect(normalizeCurriculumPath([" Unit 2 ", "Chapter   4"])).toEqual(["Unit 2", "Chapter 4"]);
    expect(() => normalizeCurriculumPath(Array.from({ length: 9 }, (_, index) => `Unit ${index}`))).toThrow();
  });

  it("recognizes only truly untouched placeholders", () => {
    const row = assignment(100);
    expect(isUntouchedPlaceholder(row, { courseTitle: "Course", sequenceLabel: "Lesson" })).toBe(true);
    expect(isUntouchedPlaceholder({ ...row, materialCount: 1 }, { courseTitle: "Course", sequenceLabel: "Lesson" })).toBe(false);
    expect(isUntouchedPlaceholder({ ...row, status: "completed" }, { courseTitle: "Course", sequenceLabel: "Lesson" })).toBe(false);
  });

  it("increases by appending and reduces only untouched trailing rows", () => {
    expect(evaluateTargetChange({ currentTarget: 100, nextTarget: 110, assignments: [], courseTitle: "Course", sequenceLabel: "Lesson" }).appendSequenceNumbers).toEqual([101,102,103,104,105,106,107,108,109,110]);
    const safe = evaluateTargetChange({ currentTarget: 100, nextTarget: 98, assignments: [assignment(99), assignment(100)], courseTitle: "Course", sequenceLabel: "Lesson" });
    expect(safe).toMatchObject({ allowed: true, removeAssignmentIds: ["assignment-100", "assignment-99"] });
    const unsafe = evaluateTargetChange({ currentTarget: 100, nextTarget: 98, assignments: [assignment(99), { ...assignment(100), scheduledDate: "2026-08-03" }], courseTitle: "Course", sequenceLabel: "Lesson" });
    expect(unsafe).toMatchObject({ allowed: false });
    expect(unsafe.reason).toContain("Lesson 100");
  });

  it("selects next unscheduled IDs without passing lower later work", () => {
    const items = [eligible("a", 1, null, "completed"), eligible("b", 2), eligible("c", 3), eligible("d", 4, "2026-09-01"), eligible("e", 5)];
    expect(selectNextEligibleScopeItems({ items, limitByCurriculumUnit: { unit: 4 }, throughDate: "2026-08-10" }).map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("orders multiple courses deterministically while respecting per-course limits and gaps", () => {
    const items = [eligible("u2-2", 2, null, "planned", "unit-2"), eligible("u1-3", 3), eligible("u1-1", 1), eligible("u2-1", 1, null, "completed", "unit-2")];
    expect(selectNextEligibleScopeItems({ items, limitByCurriculumUnit: { unit: 2, "unit-2": 1 }, throughDate: "2026-08-10" }).map((item) => item.id)).toEqual(["u1-1", "u2-2", "u1-3"]);
  });

  it("separates descriptive fields from schedule-sensitive duration and protects history", () => {
    expect(classifyConfirmedMaterialChanges({ title: "Chapter 4 Test", kind: "assessment", path: ["Unit 2"], minutes: 35 })).toEqual({
      descriptive: { title: "Chapter 4 Test", curriculumItemKind: "assessment", curriculumPath: ["Unit 2"] },
      scheduleSensitive: { estimatedMinutes: 35 },
    });
    expect(assignmentAllowsDescriptiveRewrite("planned")).toBe(true);
    for (const status of ["doing", "submitted", "needs_review", "completed"]) expect(assignmentAllowsDescriptiveRewrite(status)).toBe(false);
  });
});

function assignment(sequenceNumber: number): ScopeAssignmentState {
  return { id: `assignment-${sequenceNumber}`, sequenceNumber, title: `Course · Lesson ${sequenceNumber}`, status: "planned", scheduledDate: null, curriculumItemState: "placeholder", materialCount: 0, submissionCount: 0, reviewCount: 0 };
}

function eligible(id: string, sequenceNumber: number, scheduledDate: string | null = null, status = "planned", curriculumUnitId = "unit"): EligibleScopeItem {
  return { id, curriculumUnitId, sequenceNumber, title: `Lesson ${sequenceNumber}`, subject: "Math", status, scheduledDate, estimatedMinutes: 30, curriculumItemKind: "lesson", curriculumPath: [], curriculumItemState: "placeholder" };
}
