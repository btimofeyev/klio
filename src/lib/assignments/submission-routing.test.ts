import { describe, expect, it } from "vitest";
import { assignmentSubmissionOutcome } from "./submission-routing";

describe("assignmentSubmissionOutcome", () => {
  it.each([
    "Finished this in 30 min",
    "Completed the lesson",
    "We got the assignment done",
    "Done for today",
  ])("records completion-only notes without creating review work: %s", (note) => {
    expect(assignmentSubmissionOutcome({ note, evidence: [{ kind: "note", storagePath: null }] })).toBe("completed");
  });

  it.each([
    { note: "Finished with a score of 92%", evidence: [{ kind: "note", storagePath: null }] },
    { note: "Finished and got 9/10", evidence: [{ kind: "note", storagePath: null }] },
    { note: "Completed with a B+", evidence: [{ kind: "note", storagePath: null }] },
    { note: "Please review this work", evidence: [{ kind: "note", storagePath: null }] },
    { note: "Finished this worksheet", evidence: [{ kind: "photo", storagePath: "family/work.jpg" }] },
  ])("sends actual assessment material to review", (source) => {
    expect(assignmentSubmissionOutcome(source)).toBe("needs_review");
  });
});
