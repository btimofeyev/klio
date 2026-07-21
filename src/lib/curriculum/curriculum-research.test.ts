import { describe, expect, it } from "vitest";
import { prepareCurriculumResearch } from "./curriculum-pacing";
import { analyzeCurriculumResearch } from "./curriculum-research";

const identity = { publisher: "Apologia", productName: "Physical Science", subject: "Science", gradeLabel: "Grade 8", editionLabel: "4th edition", isbn: null };

describe("curriculum research structure analysis", () => {
  it("offers a complete module outline without calling it a daily lesson count", () => {
    const structure = analyzeCurriculumResearch({
      identity,
      targetLessonCount: 15,
      assumptions: ["The publisher confirms modules, not daily lessons."],
      items: Array.from({ length: 15 }, (_, index) => ({ sequenceNumber: index + 1, title: `Module ${index + 1}: Topic`, kind: "lesson" as const, path: [`Module ${index + 1}`], confidence: 0.91 })),
      confidence: 0.91,
    });
    expect(structure).toEqual({ sequenceLabel: "Module", detectedItemCount: 15, isCompleteDetectedOutline: true, containerLabel: null, containerCount: null, expandedFromContainers: false });
  });

  it("does not mistake a partial module list for a complete course", () => {
    const structure = analyzeCurriculumResearch({
      identity,
      targetLessonCount: 100,
      assumptions: ["Only three sample modules were visible."],
      items: Array.from({ length: 3 }, (_, index) => ({ sequenceNumber: index + 1, title: `Module ${index + 1}: Topic`, kind: "lesson" as const, path: [`Module ${index + 1}`], confidence: 0.72 })),
      confidence: 0.72,
    });
    expect(structure).toEqual({ sequenceLabel: "Module", detectedItemCount: null, isCompleteDetectedOutline: false, containerLabel: null, containerCount: null, expandedFromContainers: false });
  });

  it("does not mistake a partial list of lesson titles for the whole year", () => {
    const structure = analyzeCurriculumResearch({
      identity,
      targetLessonCount: 100,
      assumptions: ["Only a sample was available."],
      items: [{ sequenceNumber: 1, title: "Lesson 1: Measurements", kind: "lesson", path: [], confidence: 0.75 }],
      confidence: 0.75,
    });
    expect(structure).toEqual({ sequenceLabel: "Lesson", detectedItemCount: null, isCompleteDetectedOutline: false, containerLabel: null, containerCount: null, expandedFromContainers: false });
  });

  it("recognizes a complete daily lesson outline", () => {
    const structure = analyzeCurriculumResearch({
      identity,
      targetLessonCount: 2,
      assumptions: [],
      items: [{ sequenceNumber: 1, title: "Lesson 1: Matter", kind: "lesson", path: [], confidence: 0.95 }, { sequenceNumber: 2, title: "Lesson 2: Energy", kind: "lesson", path: [], confidence: 0.95 }],
      confidence: 0.95,
    });
    expect(structure).toEqual({ sequenceLabel: "Lesson", detectedItemCount: 2, isCompleteDetectedOutline: true, containerLabel: null, containerCount: null, expandedFromContainers: false });
  });

  it("turns a source-backed annual module pace into schedulable daily sessions", () => {
    const prepared = prepareCurriculumResearch({
      proposal: {
        identity,
        targetLessonCount: 136,
        assumptions: ["The publisher confirms 15 modules over 34 weeks at four days per week."],
        items: Array.from({ length: 15 }, (_, index) => ({ sequenceNumber: index + 1, title: `Module ${index + 1}: Topic`, kind: "lesson" as const, path: [`Module ${index + 1}`], confidence: 0.99 })),
        confidence: 0.99,
      },
      pacing: { sourceGranularity: "container", containerLabel: "Module", containerCount: 15, recommendedWeeklyFrequency: 4, recommendedWeekCount: 34, recommendedSessionCount: 136, minutesPerSession: 60, confidence: 0.99 },
    }, 100);
    expect(prepared.expandedFromContainers).toBe(true);
    expect(prepared.proposal.targetLessonCount).toBe(136);
    expect(prepared.proposal.items).toHaveLength(136);
    expect(prepared.proposal.items[0]).toMatchObject({ sequenceNumber: 1, title: "Module 1: Topic · Session 1", path: ["Module 1: Topic"], minutes: 60 });
    expect(prepared.proposal.items.at(-1)).toMatchObject({ sequenceNumber: 136, title: "Module 15: Topic · Session 9", path: ["Module 15: Topic"] });
    expect(analyzeCurriculumResearch(prepared.proposal, prepared)).toEqual({ sequenceLabel: "Lesson", detectedItemCount: 136, isCompleteDetectedOutline: true, containerLabel: "Module", containerCount: 15, expandedFromContainers: true });
  });

  it("does not schedule curriculum containers when reliable pacing is missing", () => {
    const prepared = prepareCurriculumResearch({
      proposal: { identity, targetLessonCount: 15, assumptions: ["Only the module outline is confirmed."], items: Array.from({ length: 15 }, (_, index) => ({ sequenceNumber: index + 1, title: `Module ${index + 1}: Topic`, kind: "lesson" as const, path: [], confidence: 0.9 })), confidence: 0.9 },
      pacing: { sourceGranularity: "container", containerLabel: "Module", containerCount: 15, recommendedWeeklyFrequency: null, recommendedWeekCount: null, recommendedSessionCount: null, minutesPerSession: null, confidence: 0.9 },
    }, 100);
    expect(prepared.expandedFromContainers).toBe(false);
    expect(prepared.proposal.targetLessonCount).toBe(100);
    expect(prepared.proposal.items).toEqual([]);
  });
});
