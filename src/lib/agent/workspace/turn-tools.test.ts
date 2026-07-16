import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { interactionModeForRequest, toolsForWorkspaceGoal, toolsForWorkspaceRequest } from "./turns";
import { workspaceToolSchemas } from "./contracts";

describe("workspace turn tool scoping", () => {
  it("does not grant grading or curriculum mutation to a capture filing turn", () => {
    const tools = toolsForWorkspaceGoal("capture");
    expect(tools).toContain("file_capture");
    expect(tools).not.toContain("record_explicit_parent_score");
    expect(tools).not.toContain("propose_curriculum_change");
  });

  it("grants weekly planning operations without grading tools", () => {
    const tools = toolsForWorkspaceGoal("weekly_plan");
    expect(tools).toContain("prepare_planning_changes");
    expect(tools).toContain("move_schedule_work");
    expect(tools).toContain("organize_day_schedule");
    expect(tools).not.toContain("draft_assignment_review");
  });

  it("narrows get-organized requests to the deterministic day operation", () => {
    const tools = toolsForWorkspaceRequest("weekly_plan", "Get organized and fix the overlapping times.");
    expect(tools).toContain("organize_day_schedule");
    expect(tools).not.toContain("draft_weekly_plan");
    expect(tools).not.toContain("move_schedule_work");
  });

  it("keeps questions strictly read-only even when thread history may contain prior actions", () => {
    const tools = toolsForWorkspaceRequest("general", "Why did Maya's lesson move?", "answer");
    expect(tools).toContain("read_family_context");
    expect(tools).toContain("read_relevant_history");
    expect(tools).not.toContain("move_schedule_work");
    expect(tools).not.toContain("create_reminder");
    expect(tools).not.toContain("ask_parent");
  });

  it("grants only the relevant mutation family for an explicit general action", () => {
    const tools = toolsForWorkspaceRequest("general", "Please remind me tomorrow to review Maya's science work.", "act");
    expect(tools).toContain("create_reminder");
    expect(tools).not.toContain("record_explicit_parent_score");
    expect(tools).not.toContain("move_schedule_work");
    expect(tools).not.toContain("create_practice_activity");
  });

  it.each([
    ["What changed in Jacob's week?", "answer"],
    ["Explain why Maya is behind in history", "answer"],
    ["Please move Noah's unfinished lesson to Friday", "act"],
    ["Remind me tomorrow to review this", "act"],
  ] as const)("routes %s to %s authority", (request, expected) => {
    expect(interactionModeForRequest({ goal: "general", request })).toBe(expected);
  });

  it("forces assignment teaching guidance into the answer lane", () => {
    expect(interactionModeForRequest({ goal: "general", request: "How should I teach this?", assignmentGuidance: true })).toBe("answer");
  });

  it("accepts database-owned deterministic learner and assignment ids", () => {
    const studentId = "a4082b68-78e3-0e56-38b9-77d18b05c5d8";
    const assignmentId = "3291da37-a0c3-f574-8703-9493c14bc96e";
    expect(workspaceToolSchemas.read_family_context.safeParse({ studentId }).success).toBe(true);
    expect(workspaceToolSchemas.record_explicit_completion.safeParse({ assignmentId, idempotencyKey: "completion:test" }).success).toBe(true);
  });
});
