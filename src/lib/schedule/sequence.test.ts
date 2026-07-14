import { describe, expect, it } from "vitest";
import { buildCurriculumSequence, inferNextCurriculumLessons } from "@/lib/schedule/sequence";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const source = { id: "lesson-4", studentId: "jacob", scheduledDate: "2026-07-20", title: "Algebra I · Lesson 4", subject: "Algebra I" };

describe("curriculum sequence proposals", () => {
  it("advances lesson labels across the family's next learning days", () => {
    expect(buildCurriculumSequence(source, weekdays, [source])).toEqual([
      { title: "Algebra I · Lesson 5", scheduledDate: "2026-07-21" },
      { title: "Algebra I · Lesson 6", scheduledDate: "2026-07-22" },
      { title: "Algebra I · Lesson 7", scheduledDate: "2026-07-23" },
      { title: "Algebra I · Lesson 8", scheduledDate: "2026-07-24" },
    ]);
  });

  it("skips a day that already contains the same subject", () => {
    const existing = [...[source], { ...source, id: "existing", scheduledDate: "2026-07-21", title: "Algebra I review" }];
    expect(buildCurriculumSequence(source, weekdays, existing)[0]).toEqual({ title: "Algebra I · Lesson 5", scheduledDate: "2026-07-22" });
  });

  it("does not guess a sequence from an unnumbered assignment", () => {
    expect(buildCurriculumSequence({ ...source, title: "Finish the lab conclusion" }, weekdays, [])).toEqual([]);
  });

  it("offers the authoritative next lesson on a later day", () => {
    const items = [
      { ...source, scheduledDate: "2026-07-13", title: "Algebra I · Lesson 6", scheduledTime: "09:00:00", estimatedMinutes: 45 },
      { ...source, id: "lesson-7", scheduledDate: "2026-07-14", title: "Algebra I · Lesson 7", scheduledTime: "09:00:00", estimatedMinutes: 45 },
      { ...source, id: "lesson-8", scheduledDate: "2026-07-15", title: "Algebra I · Lesson 8", scheduledTime: "09:00:00", estimatedMinutes: 45 },
    ];
    expect(inferNextCurriculumLessons(items, "2026-07-16")).toEqual([{
      sourceItemId: "lesson-8", subject: "Algebra I", title: "Algebra I · Lesson 9",
      scheduledDate: "2026-07-16", scheduledTime: "09:00:00", estimatedMinutes: 45,
    }]);
  });

  it("does not offer another lesson when that subject is already scheduled", () => {
    const items = [source, { ...source, id: "lesson-5", scheduledDate: "2026-07-21", title: "Algebra I · Lesson 5" }];
    expect(inferNextCurriculumLessons(items, "2026-07-21")).toEqual([]);
  });
});
