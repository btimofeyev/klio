import { describe, expect, it } from "vitest";
import { assignmentHandoffNeedsAgent, assignmentSubmissionDeclaresCompletion, assignmentSubmissionOutcome } from "./submission-routing";

describe("assignmentSubmissionOutcome", () => {
  it.each([
    "Did great on this",
    "Needed a little help with the last question",
    "Read this aloud with confidence",
  ])("files an assignment-linked observation without manufacturing review work: %s", (note) => {
    expect(assignmentSubmissionOutcome({ note, evidence: [{ kind: "note", storagePath: null }] })).toBe("comment");
  });

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

  it("retains explicit completion when submitted work also needs review", () => {
    const source = { note: "Finished this worksheet", evidence: [{ kind: "photo", storagePath: "family/work.jpg" }] };
    expect(assignmentSubmissionOutcome(source)).toBe("needs_review");
    expect(assignmentSubmissionDeclaresCompletion(source.note)).toBe(true);
  });

  it("routes open-ended learning follow-through to the durable workspace agent", () => {
    expect(assignmentHandoffNeedsAgent("Finished this but struggled on some questions. Could use some practice")).toBe(true);
    expect(assignmentHandoffNeedsAgent("Finished in thirty minutes")).toBe(false);
    expect(assignmentHandoffNeedsAgent("Did great on this today")).toBe(false);
  });
});
