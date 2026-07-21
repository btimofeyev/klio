// @vitest-environment jsdom

import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsightNote, isPracticeReadyInsightRepresented } from "./operations-workspace";
import type { AdjustmentDTO, AssignmentDTO, PlanningProposalDTO } from "@/lib/data/operations";
import type { AgentTurnDTO, KlioInsightDTO, StudentDTO } from "@/lib/data/workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/app/actions", () => ({ reviewEntityAction: vi.fn() }));

afterEach(cleanup);

const students = [{ id: "noah", displayName: "Noah", gradeBand: "2", learningPreferences: null }] as StudentDTO[];
const assignments = [
  { id: "math-25", studentId: "noah", title: "Grade 2 Mathematics · Lesson 25", subject: "Math", estimatedMinutes: 25 },
  { id: "reading-24", studentId: "noah", title: "Grade 2 Reading · Lesson 24", subject: "Reading", estimatedMinutes: 25 },
] as AssignmentDTO[];
const insight = {
  id: "insight-1",
  studentId: "noah",
  kind: "needs_detail",
  title: "The remaining work does not fit this week",
  summary: "There is no open learning day.",
  reason: null,
  priority: 100,
  evidenceRefs: assignments.map((assignment) => ({ type: "assignment", id: assignment.id })),
  actionRef: { type: "week", studentId: "noah", assignmentIds: assignments.map((assignment) => assignment.id) },
  createdAt: "2026-07-17T14:00:00.000Z",
} satisfies KlioInsightDTO;

const activeTurn = {
  id: "turn-1",
  status: "running",
  goal: "general",
  request: "Make room for Noah’s remaining work this week with the smallest safe schedule change. Keep curriculum order and stay within Noah’s daily capacity. Prepare the change for my review and do not apply anything automatically. Affected lessons: Grade 2 Mathematics · Lesson 25; Grade 2 Reading · Lesson 24.",
  result: null,
  clarification: null,
  events: [],
  tools: [],
  taskName: "Handling a family handoff",
  studentId: null,
  subject: null,
  sourceCount: 0,
  normalizedStep: "planning",
  expectedOutput: null,
  createdAt: "2026-07-17T14:01:00.000Z",
  startedAt: "2026-07-17T14:01:01.000Z",
  lastHeartbeatAt: "2026-07-17T14:01:02.000Z",
  lastProgressAt: "2026-07-17T14:01:02.000Z",
  conversationId: "conversation-1",
  interactionMode: "act",
  streamedMessage: null,
} satisfies AgentTurnDTO;

function renderInsight(turn: AgentTurnDTO | null, planningProposals: PlanningProposalDTO[] = []) {
  return render(React.createElement(InsightNote, {
    insight,
    assignments,
    students,
    proposals: [] as AdjustmentDTO[],
    planningProposals,
    activeAgentTurn: turn,
    busy: null,
    onDecide: vi.fn(),
    onAcknowledge: vi.fn().mockResolvedValue(true),
    onDismiss: vi.fn().mockResolvedValue(true),
    onStartPractice: vi.fn(),
    onPracticeFollowUp: vi.fn(),
    onAskKlio: vi.fn(),
  }));
}

describe("schedule decision insight", () => {
  it("replaces the unresolved action with a linked working state", () => {
    renderInsight(activeTurn);

    expect(screen.getByText("Klio is working")).toBeInTheDocument();
    expect(screen.getByText("Klio is making room for Noah’s 2 lessons")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Working on this");
    expect(screen.queryByRole("button", { name: "Ask Klio to make room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("restores the action when no matching handoff is active", () => {
    renderInsight(null);

    expect(screen.getByRole("button", { name: "Ask Klio to make room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.queryByText("Working on this")).not.toBeInTheDocument();
  });

  it("replaces the unresolved action when a matching proposal is ready", () => {
    renderInsight(null, [{
      id: "proposal-1",
      studentId: "noah",
      proposalKind: "weekly_plan",
      actionName: "prepare_week",
      risk: "moderate",
      title: "Make room for Noah’s work",
      summary: "Shorten Reading and Phonics so all three lessons fit Friday.",
      reason: "Keep the curriculum sequence intact.",
      changes: { assignmentIds: ["math-25", "reading-24"] },
      status: "proposed",
      snapshotVersion: 2,
      targetAssignmentId: null,
      targetGoalId: null,
      targetCurriculumUnitId: null,
      createdAt: "2026-07-17T14:03:00.000Z",
    }]);

    expect(screen.getByText("Schedule ready")).toBeInTheDocument();
    expect(screen.getByText("Klio prepared a change")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review or edit" })).toHaveAttribute("href", "/app/adjustments?proposal=proposal-1");
    expect(screen.queryByRole("button", { name: "Ask Klio to make room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
});

describe("practice-ready insight presentation", () => {
  const practiceInsight = {
    ...insight,
    kind: "practice_ready",
    title: "Comprehensive historical thinking review",
    actionRef: { type: "practice", artifactId: "practice-1", practiceSessionId: "session-1" },
  } satisfies KlioInsightDTO;

  it("does not repeat a practice-ready insight when its practice card is visible", () => {
    expect(isPracticeReadyInsightRepresented(practiceInsight, [{ id: "practice-1" }])).toBe(true);
  });

  it("keeps the insight as a fallback when its practice card is unavailable", () => {
    expect(isPracticeReadyInsightRepresented(practiceInsight, [{ id: "practice-2" }])).toBe(false);
    expect(isPracticeReadyInsightRepresented({ ...practiceInsight, actionRef: {} }, [{ id: "practice-1" }])).toBe(false);
  });
});
