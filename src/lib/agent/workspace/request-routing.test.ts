import { describe, expect, it } from "vitest";
import { assignmentGuidanceRequest, explicitlyMentionedStudentId, isAssignmentGuidanceRequest } from "./request-routing";

describe("assignment guidance routing", () => {
  it.each([
    "How should I teach this",
    "What should I emphasize?",
    "Can you explain how to introduce this lesson",
    "Help me teach this",
  ])("routes %s to Klio for an answer", (request) => {
    expect(isAssignmentGuidanceRequest(request)).toBe(true);
  });

  it.each([
    "Did great on this",
    "Finished this lesson",
    "We did not finish",
    "Could use some practice",
  ])("keeps %s as a learning update", (request) => {
    expect(isAssignmentGuidanceRequest(request)).toBe(false);
  });

  it("makes the expected response explicit", () => {
    expect(assignmentGuidanceRequest({ title: "Medieval World · Lesson 15", subject: "History", request: "How should I teach this" }))
      .toContain("Answer the question directly with a concrete teaching approach");
  });

  it.each(["Jacob", "Jacob's day", "jacobs assignments", "Let’s review JACOB’S work"])("moves focus for an explicit learner mention: %s", (request) => {
    expect(explicitlyMentionedStudentId(request, [
      { id: "jacob-id", displayName: "Jacob" },
      { id: "maya-id", displayName: "Maya" },
    ])).toBe("jacob-id");
  });

  it("does not guess when multiple learners are named", () => {
    expect(explicitlyMentionedStudentId("Compare Jacob and Maya", [
      { id: "jacob-id", displayName: "Jacob" },
      { id: "maya-id", displayName: "Maya" },
    ])).toBeNull();
  });
});
