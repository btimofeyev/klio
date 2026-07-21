// @vitest-environment jsdom

import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeeklyFamilyBriefing, weeklyBriefingShouldRender } from "./weekly-family-briefing";
import type { WeeklyBriefingDTO } from "@/lib/data/workspace";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.refresh.mockReset(); });

const briefing: WeeklyBriefingDTO = {
  id: "briefing-1",
  status: "active",
  weekStart: "2026-07-13",
  generatedAt: "2026-07-13T09:02:00.000Z",
  viewedAt: null,
  snapshot: {
    weekStart: "2026-07-13", weekEnd: "2026-07-19", generatedAt: "2026-07-13T09:02:00.000Z",
    headline: "Your week at a glance", summary: "5 assignments and 170 planned minutes are on the family schedule. 1 item needs parent attention.",
    previousWeek: { completedCount: 4, unfinishedCount: 1, awaitingReviewCount: 2, byLearner: [{ studentId: "maya", completedCount: 1, unfinishedCount: 0, awaitingReviewCount: 0 }] },
    parentAttention: { totalMinutes: 70, byLearner: [{ studentId: "maya", displayName: "Maya", minutes: 70 }], days: [] },
    learners: [{ studentId: "maya", displayName: "Maya", plannedCount: 5, plannedMinutes: 170, overCapacityDays: [], availabilityChanges: [] }],
    unscheduledWork: [], pacing: [], onTrack: false,
    actions: [{ kind: "review_submissions", label: "Review submitted work", explanation: "2 submissions are waiting for parent review.", priority: 100, target: { type: "review_queue", href: "/app/review" }, evidenceRefs: [{ type: "assignment_submission", id: "submission-1" }] }],
    trust: "Uses current family records. Grades, curriculum changes, and major schedule changes still wait for you.",
  },
};

const students = [{ id: "maya", displayName: "Maya", gradeBand: "6-8", learningPreferences: null }];
const familyId = "00000000-0000-4000-8000-000000000001";

function renderBriefing(input: { onDismissed?: () => void; selectedStudentId?: string; planningProposals?: React.ComponentProps<typeof WeeklyFamilyBriefing>["planningProposals"]; adjustments?: React.ComponentProps<typeof WeeklyFamilyBriefing>["adjustments"] } = {}) {
  return render(React.createElement(WeeklyFamilyBriefing, {
    briefing, state: "available", familyId, students, selectedStudentId: input.selectedStudentId ?? "all", familyTimezone: "America/New_York", planningProposals: input.planningProposals, adjustments: input.adjustments, onDismissed: input.onDismissed,
  }));
}

describe("weekly family briefing", () => {
  it("renders the weekly summary and current action as two side notes", () => {
    const view = renderBriefing();
    const summaryNote = view.container.querySelector('[data-briefing-side="left"]');
    expect(screen.getByRole("heading", { name: "Klio noticed" })).toBeInTheDocument();
    expect(summaryNote).not.toBeNull();
    expect(within(summaryNote as HTMLElement).getByText("The week is organized. Klio found one thing worth a quick look.")).toBeInTheDocument();
    expect(view.container.querySelector('[data-briefing-side="right"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What matters" })).toBeInTheDocument();
    expect(screen.queryByText(/5 assignments|170 planned minutes/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  it("shows only the essential exception and records the view without changing anything", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ briefing: { id: briefing.id, status: "active" } }) }));
    renderBriefing();
    expect(screen.getByRole("heading", { name: "What matters" })).toBeInTheDocument();
    expect(screen.getByText("Submitted work is ready for you")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute("href", "/app/review");
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(screen.queryByText("Learning and pacing")).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/weekly-briefings/briefing-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "view" }) })));
  });

  it("renders a quiet on-track state without fabricated actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const quiet = { ...briefing, snapshot: { ...briefing.snapshot, onTrack: true, actions: [], summary: "5 assignments and 170 planned minutes are on the family schedule. Current records show no capacity, review, or pacing concern." } };
    render(React.createElement(WeeklyFamilyBriefing, { briefing: quiet, state: "available", familyId, students, selectedStudentId: "all", familyTimezone: "America/New_York" }));
    expect(screen.getAllByText("The week is ready. Nothing needs your decision.")).toHaveLength(1);
    expect(screen.queryByText("Everyone fits within the current plan.")).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-briefing-side]')).toHaveLength(1);
  });

  it("starts a background handoff in place without opening the composer", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      return body.action === "handle"
        ? { ok: true, json: async () => ({ turn: { id: "turn-1", status: "queued" } }) }
        : { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderBriefing({ selectedStudentId: "maya" });
    await userEvent.click(screen.getByRole("button", { name: "Ask Klio to handle this" }));
    const handleCall = fetchMock.mock.calls.find(([, init]) => typeof init?.body === "string" && init.body.includes('"action":"handle"'));
    expect(handleCall?.[0]).toBe("/api/weekly-briefings/briefing-1");
    expect(JSON.parse(String(handleCall?.[1]?.body))).toMatchObject({ action: "handle", studentId: "maya" });
    expect(JSON.parse(String(handleCall?.[1]?.body)).request).toContain("Work in the background");
    expect(JSON.parse(String(handleCall?.[1]?.body)).request).toContain("explicitly authorizes ordinary safe, reversible assignment moves");
    expect(JSON.parse(String(handleCall?.[1]?.body)).request).toContain("Do not use draft_weekly_plan");
    expect(screen.getByRole("progressbar", { name: "Klio briefing progress" })).toHaveAttribute("aria-valuenow", "10");
    expect(screen.queryByText(/Take care of the remaining items/)).not.toBeInTheDocument();
  });

  it("keeps learner-scoped actions learner-specific", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const scoped = {
      ...briefing,
      snapshot: {
        ...briefing.snapshot,
        actions: [{ kind: "schedule_work" as const, label: "Place unscheduled work", explanation: "Noah has loose work.", priority: 90, target: { studentId: "noah", href: "/app/assignments" }, evidenceRefs: [] }],
      },
    };
    render(React.createElement(WeeklyFamilyBriefing, { briefing: scoped, state: "available", familyId, students, selectedStudentId: "maya", familyTimezone: "America/New_York" }));
    expect(screen.getAllByText("Maya’s week is ready. Nothing needs your decision.")).toHaveLength(1);
    expect(screen.queryByText("Some work still needs a place")).not.toBeInTheDocument();
  });

  it("condenses repeated pacing actions into one useful item", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pacingBriefing: WeeklyBriefingDTO = {
      ...briefing,
      snapshot: {
        ...briefing.snapshot,
        pacing: [
          { studentId: "maya", kind: "pacing_concern", title: "Maya pace", explanation: "Behind", evidenceRefs: [] },
          { studentId: "noah", kind: "pacing_concern", title: "Noah pace", explanation: "Behind", evidenceRefs: [] },
        ],
        actions: [
          {
            kind: "review_pacing",
            label: "Review a pacing concern",
            explanation: "Maya has a pacing concern to review.",
            priority: 80,
            target: { studentId: "maya", goalId: "goal-maya", href: "/app/plans" },
            evidenceRefs: [{ type: "pacing_checkpoint", id: "pacing-maya" }],
          },
          {
            kind: "review_pacing",
            label: "Review a pacing concern",
            explanation: "Noah has a pacing concern to review.",
            priority: 80,
            target: { studentId: "noah", goalId: "goal-noah", href: "/app/plans" },
            evidenceRefs: [{ type: "pacing_checkpoint", id: "pacing-noah" }],
          },
        ],
      },
    };

    render(React.createElement(WeeklyFamilyBriefing, { briefing: pacingBriefing, state: "available", familyId, students, selectedStudentId: "all", familyTimezone: "America/New_York" }));
    expect(screen.getAllByText("The pace could use a simpler plan")).toHaveLength(1);
    expect(screen.queryByText("Maya has a pacing concern to review.")).not.toBeInTheDocument();
    expect(screen.queryByText("Noah has a pacing concern to review.")).not.toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
  });

  it("shows no more than two parent-facing items", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const busyBriefing: WeeklyBriefingDTO = {
      ...briefing,
      snapshot: {
        ...briefing.snapshot,
        actions: [
          briefing.snapshot.actions[0],
          { kind: "decide_unfinished", label: "Unfinished", explanation: "One remains.", priority: 90, target: { href: "/app/week" }, evidenceRefs: [] },
          { kind: "schedule_work", label: "Unscheduled", explanation: "One needs a day.", priority: 80, target: { href: "/app/assignments" }, evidenceRefs: [] },
        ],
      },
    };
    render(React.createElement(WeeklyFamilyBriefing, { briefing: busyBriefing, state: "available", familyId, students, selectedStudentId: "all", familyTimezone: "America/New_York" }));
    expect(screen.getByText("Submitted work is ready for you")).toBeInTheDocument();
    expect(screen.getByText("One lesson is still open")).toBeInTheDocument();
    expect(screen.queryByText("Some work still needs a place")).not.toBeInTheDocument();
  });

  it("replaces an open item with the matching proposal ready for review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const proposalBriefing = briefingWithActions([
      { kind: "decide_unfinished", label: "Unfinished", explanation: "One remains.", priority: 90, target: { href: "/app/week", assignmentIds: ["assignment-old"] }, evidenceRefs: [{ type: "assignment", id: "assignment-old" }] },
    ]);
    render(React.createElement(WeeklyFamilyBriefing, {
      briefing: proposalBriefing,
      state: "available",
      familyId,
      students,
      selectedStudentId: "all",
      familyTimezone: "America/New_York",
      planningProposals: [planningProposal({ status: "proposed", assignmentId: "assignment-old", summary: "Move the open science lesson to Monday and leave the rest of the week unchanged." })],
    }));

    expect(screen.getAllByText("Klio prepared a change. It’s ready for your review.")).toHaveLength(2);
    expect(screen.getByText("A catch-up plan is ready")).toBeInTheDocument();
    expect(screen.getByText("Move the open science lesson to Monday and leave the rest of the week unchanged.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/app/adjustments?proposal=proposal-1");
    expect(screen.queryByText("One lesson is still open")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Klio/ })).not.toBeInTheDocument();
  });

  it("removes an item after its matching proposal is applied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const proposalBriefing = briefingWithActions([
      { kind: "decide_unfinished", label: "Unfinished", explanation: "One remains.", priority: 90, target: { href: "/app/week", assignmentIds: ["assignment-old"] }, evidenceRefs: [{ type: "assignment", id: "assignment-old" }] },
    ]);
    render(React.createElement(WeeklyFamilyBriefing, {
      briefing: proposalBriefing,
      state: "available",
      familyId,
      students,
      selectedStudentId: "all",
      familyTimezone: "America/New_York",
      planningProposals: [planningProposal({ status: "applied", assignmentId: "assignment-old" })],
    }));

    expect(screen.getAllByText("Klio handled the briefing. Nothing else needs your decision.")).toHaveLength(1);
    expect(screen.queryByText("One lesson is still open")).not.toBeInTheDocument();
    expect(screen.queryByText("Only parent-approved changes were applied.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Klio/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-briefing-side="right"]')).not.toBeInTheDocument();
  });

  it("removes an item after Klio applies an undoable schedule adjustment", async () => {
    const proposalBriefing = briefingWithActions([
      { kind: "decide_unfinished", label: "Unfinished", explanation: "One remains.", priority: 90, target: { href: "/app/week", assignmentIds: ["assignment-old"] }, evidenceRefs: [{ type: "assignment", id: "assignment-old" }] },
    ]);
    render(React.createElement(WeeklyFamilyBriefing, {
      briefing: proposalBriefing,
      state: "available",
      familyId,
      students,
      selectedStudentId: "all",
      familyTimezone: "America/New_York",
      adjustments: [{ id: "adjustment-1", status: "applied", summary: "Moved the unfinished lesson.", createdAt: "2026-07-13T10:00:00.000Z", actions: [{ assignmentId: "assignment-old" }] }],
    }));

    expect(screen.getAllByText("Klio handled the briefing. Nothing else needs your decision.")).toHaveLength(1);
    expect(screen.queryByText("One lesson is still open")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Klio/ })).not.toBeInTheDocument();
  });

  it("resolves a broad schedule-work alert after its bounded placement is applied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const proposalBriefing = briefingWithActions([
      { kind: "schedule_work", label: "Place unscheduled work", explanation: "Many curriculum placeholders have no day.", priority: 74, target: { href: "/app/assignments", assignmentIds: ["assignment-next", "assignment-later"] }, evidenceRefs: [{ type: "assignment", id: "assignment-next" }, { type: "assignment", id: "assignment-later" }] },
    ]);
    render(React.createElement(WeeklyFamilyBriefing, {
      briefing: proposalBriefing,
      state: "available",
      familyId,
      students,
      selectedStudentId: "all",
      familyTimezone: "America/New_York",
      planningProposals: [planningProposal({ status: "applied", assignmentId: "assignment-next" })],
    }));

    expect(screen.getAllByText("Klio handled the briefing. Nothing else needs your decision.")).toHaveLength(1);
    expect(screen.queryByText("Some work still needs a place")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Klio/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-briefing-side="right"]')).not.toBeInTheDocument();
  });

  it("hands off only work that has not already been prepared", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      return body.action === "handle"
        ? { ok: true, json: async () => ({ turn: { id: "turn-2", status: "queued" } }) }
        : { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const proposalBriefing = briefingWithActions([
      { kind: "decide_unfinished", label: "Unfinished", explanation: "One remains.", priority: 90, target: { href: "/app/week", assignmentIds: ["assignment-old"] }, evidenceRefs: [{ type: "assignment", id: "assignment-old" }] },
      { kind: "review_pacing", label: "Pacing", explanation: "Pace needs work.", priority: 80, target: { href: "/app/plans", goalId: "goal-math" }, evidenceRefs: [{ type: "pacing_checkpoint", id: "pace-1", goalId: "goal-math" }] },
    ]);
    render(React.createElement(WeeklyFamilyBriefing, {
      briefing: proposalBriefing,
      state: "available",
      familyId,
      students,
      selectedStudentId: "all",
      familyTimezone: "America/New_York",
      planningProposals: [planningProposal({ status: "proposed", assignmentId: "assignment-old" })],
    }));
    await userEvent.click(screen.getByRole("button", { name: "Ask Klio to handle the rest" }));
    const handleCall = fetchMock.mock.calls.find(([, init]) => typeof init?.body === "string" && init.body.includes('"action":"handle"'));
    const request = JSON.parse(String(handleCall?.[1]?.body)).request as string;
    expect(request).toContain("the pace could use a simpler plan");
    expect(request).not.toContain("catch-up plan");
  });

  it("ignores unrelated and older proposals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const proposalBriefing = briefingWithActions([
      { kind: "decide_unfinished", label: "Unfinished", explanation: "One remains.", priority: 90, target: { href: "/app/week", assignmentIds: ["assignment-old"] }, evidenceRefs: [{ type: "assignment", id: "assignment-old" }] },
    ]);
    render(React.createElement(WeeklyFamilyBriefing, {
      briefing: proposalBriefing,
      state: "available",
      familyId,
      students,
      selectedStudentId: "all",
      familyTimezone: "America/New_York",
      planningProposals: [
        planningProposal({ status: "proposed", assignmentId: "another-assignment" }),
        planningProposal({ status: "applied", assignmentId: "assignment-old", createdAt: "2026-07-13T08:00:00.000Z" }),
      ],
    }));
    expect(screen.getAllByText("The week is organized. Klio found one thing worth a quick look.")).toHaveLength(2);
    expect(screen.getByText("One lesson is still open")).toBeInTheDocument();
  });

  it("persists dismissal and removes the visible briefing without deleting it", async () => {
    const onDismissed = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ briefing: { id: briefing.id, status: "dismissed" } }) }));
    renderBriefing({ onDismissed });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss weekly briefing" }));
    expect(screen.queryByRole("heading", { name: "Your week at a glance" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/weekly-briefings/briefing-1", expect.objectContaining({ body: JSON.stringify({ action: "dismiss" }) }));
    expect(onDismissed).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("handles pending, failed, not-due, and dismissed states without network loading", () => {
    expect(weeklyBriefingShouldRender(null, "pending")).toBe(true);
    expect(weeklyBriefingShouldRender(null, "failed")).toBe(true);
    expect(weeklyBriefingShouldRender(null, "not_due")).toBe(false);
    expect(weeklyBriefingShouldRender({ ...briefing, status: "dismissed" }, "dismissed")).toBe(false);
    expect(weeklyBriefingShouldRender(briefing, "available")).toBe(true);
    const view = render(React.createElement(WeeklyFamilyBriefing, { briefing: null, state: "pending", familyId, students, selectedStudentId: "all", familyTimezone: "America/New_York" }));
    expect(screen.getByText("Preparing your week at a glance")).toBeInTheDocument();
    view.rerender(React.createElement(WeeklyFamilyBriefing, { briefing: null, state: "failed", familyId, students, selectedStudentId: "all", familyTimezone: "America/New_York" }));
    expect(screen.getByText("This week’s briefing is delayed")).toBeInTheDocument();
    view.rerender(React.createElement(WeeklyFamilyBriefing, { briefing: null, state: "not_due", familyId, students, selectedStudentId: "all", familyTimezone: "America/New_York" }));
    expect(screen.queryByText("Preparing your week at a glance")).not.toBeInTheDocument();
    view.unmount();
    render(React.createElement(WeeklyFamilyBriefing, { briefing: { ...briefing, status: "dismissed" }, state: "dismissed", familyId, students, selectedStudentId: "all", familyTimezone: "America/New_York" }));
    expect(screen.queryByRole("heading", { name: "Your week at a glance" })).not.toBeInTheDocument();
  });
});

function briefingWithActions(actions: WeeklyBriefingDTO["snapshot"]["actions"]): WeeklyBriefingDTO {
  return { ...briefing, snapshot: { ...briefing.snapshot, previousWeek: { ...briefing.snapshot.previousWeek, unfinishedCount: 1, awaitingReviewCount: 0 }, actions } };
}

function planningProposal(input: { status: string; assignmentId: string; summary?: string; createdAt?: string }): NonNullable<React.ComponentProps<typeof WeeklyFamilyBriefing>["planningProposals"]>[number] {
  return {
    id: "proposal-1",
    status: input.status,
    proposalKind: "weekly_plan",
    actionName: "prepare_week",
    summary: input.summary ?? "Move the unfinished lesson and leave the rest of the week unchanged.",
    changes: { assignmentIds: [input.assignmentId], changes: [{ assignmentId: input.assignmentId }] },
    targetAssignmentId: null,
    targetGoalId: null,
    targetCurriculumUnitId: null,
    createdAt: input.createdAt ?? "2026-07-13T10:00:00.000Z",
  };
}
