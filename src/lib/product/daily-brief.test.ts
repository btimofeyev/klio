import { describe, expect, it } from "vitest";
import { deriveDailyBrief } from "./daily-brief";
import type { ArtifactDTO, EvidenceDTO, ReminderDTO, StudentDTO } from "@/lib/data/workspace";

const student: StudentDTO = { id: "student-1", displayName: "Jacob", gradeBand: "9-12", learningPreferences: null };
const evidence = (overrides: Partial<EvidenceDTO> = {}): EvidenceDTO => ({
  id: "evidence-1", captureSubmissionId: null, captureRoute: "learning", kind: "photo", title: "History worksheet", rawText: null,
  mimeType: "image/png", storagePath: null, sourceAt: "2026-07-11T12:00:00.000Z", status: "ready", createdAt: "2026-07-11T12:00:00.000Z",
  studentIds: [student.id], categories: [], ...overrides,
});

const base = { students: [student], artifacts: [] as ArtifactDTO[], reminders: [] as ReminderDTO[], pendingApprovals: 0, studentId: student.id, now: new Date("2026-07-11T16:00:00.000Z") };

describe("deriveDailyBrief", () => {
  it("prioritizes unfiled captures", () => {
    const brief = deriveDailyBrief({ ...base, evidence: [evidence()] });
    expect(brief.action).toMatchObject({ kind: "agent", intent: "organize", evidenceIds: ["evidence-1"] });
  });

  it("surfaces a finished draft before creating more work", () => {
    const draft: ArtifactDTO = { id: "artifact-1", type: "lesson", title: "Jacob’s next lesson", summary: null, content: {}, rationale: null, status: "draft", createdAt: "2026-07-11T13:00:00.000Z", studentId: student.id };
    const brief = deriveDailyBrief({ ...base, evidence: [], artifacts: [draft], pendingApprovals: 1 });
    expect(brief.action).toEqual({ kind: "artifact", label: "Review the draft", artifactId: "artifact-1" });
  });

  it("recommends grounded practice after filed work", () => {
    const filed = evidence({ categories: [{ id: "history", name: "History", slug: "history", documentType: "Worksheet", tags: [], confidence: 0.9 }] });
    const brief = deriveDailyBrief({ ...base, evidence: [filed] });
    expect(brief.action).toMatchObject({ kind: "agent", intent: "practice" });
    expect(brief.detail).toContain("History");
  });
});
