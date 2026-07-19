import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { interactionModeForRequest, isActionConfirmationRequest, toolsForWorkspaceGoal, toolsForWorkspaceRequest } from "./turns";
import { parentFacingTurnStatus, waitsForParent } from "./turn-status";
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
    expect(tools).not.toContain("create_calendar_conflict");
    expect(Object.keys(workspaceToolSchemas)).not.toContain("create_calendar_conflict");
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

  it("lets Klio choose among bounded capabilities for adaptive conversation", () => {
    const tools = toolsForWorkspaceRequest("general", "Please remind me tomorrow to review Maya's science work.", "act");
    expect(tools).toContain("create_reminder");
    expect(tools).toContain("record_explicit_parent_score");
    expect(tools).toContain("move_schedule_work");
    expect(tools).toContain("create_practice_activity");
    expect(tools).toEqual(expect.arrayContaining(Object.keys(workspaceToolSchemas)));
  });

  it("gives an explicit schedule optimization the scheduling tools it needs", () => {
    const request = "Can you optimize the schedule the rest of the week?";
    const tools = toolsForWorkspaceRequest("general", request, interactionModeForRequest({ goal: "general", request }));
    expect(tools).toContain("move_schedule_work");
    expect(tools).toContain("organize_day_schedule");
    expect(tools).toContain("record_explicit_parent_score");
  });

  it.each([
    "Hello",
    "What changed in Jacob's week?",
    "Explain why Maya is behind in history",
    "Please move Noah's unfinished lesson to Friday",
    "Remind me tomorrow to review this",
    "Can you optimize the schedule the rest of the week?",
    "get it done",
  ])("gives Klio the adaptive lane for %s", (request) => {
    expect(interactionModeForRequest({ goal: "general", request })).toBe("act");
  });

  it.each(["get it done", "Do it", "Yes, go ahead", "apply those changes"])("recognizes contextual action confirmation: %s", (request) => {
    expect(isActionConfirmationRequest(request)).toBe(true);
    expect(toolsForWorkspaceRequest("general", request, "act")).toContain("move_schedule_work");
  });

  it("lets Klio decide how to handle assignment teaching guidance", () => {
    expect(interactionModeForRequest({ goal: "general", request: "How should I teach this?", assignmentGuidance: true })).toBe("act");
  });

  it("accepts database-owned deterministic learner and assignment ids", () => {
    const studentId = "a4082b68-78e3-0e56-38b9-77d18b05c5d8";
    const assignmentId = "3291da37-a0c3-f574-8703-9493c14bc96e";
    expect(workspaceToolSchemas.read_family_context.safeParse({ studentId }).success).toBe(true);
    expect(workspaceToolSchemas.record_explicit_completion.safeParse({ assignmentId, idempotencyKey: "completion:test" }).success).toBe(true);
  });

  it("waits only when a durable parent question actually changed the turn state", () => {
    expect(waitsForParent("awaiting_parent", true)).toBe(true);
    expect(waitsForParent("awaiting_parent", false)).toBe(false);
    expect(waitsForParent("running", true)).toBe(false);
    expect(waitsForParent("completed", true)).toBe(false);
    expect(parentFacingTurnStatus("awaiting_parent", false)).toBe("completed");
    expect(parentFacingTurnStatus("awaiting_parent", true)).toBe("awaiting_parent");
  });
});
