// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssignmentDTO } from "@/lib/data/operations";
import { ParentSupportControl, ParentSupportLabel } from "./parent-support-control";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const assignment = { id: "lesson-a", artifactId: null, studentId: "student-a", curriculumUnitId: "unit-a", title: "Fractions 4", subject: "Math", instructions: null, sequenceNumber: 4, status: "planned", scheduledDate: "2026-07-20", dueAt: null, scheduledTime: "09:00", estimatedMinutes: 40, completedAt: null, submittedAt: null, sourceKind: "curriculum", attentionMode: null, parentAttentionMinutes: null, resolvedAttentionMode: "parent_led", resolvedParentMinutes: 40, attentionInherited: true, attentionSource: "curriculum" } satisfies AssignmentDTO;

describe("ParentSupportControl", () => {
  it("shows inherited state and support labels", () => {
    render(<><ParentSupportLabel assignment={assignment} /><ParentSupportControl assignment={assignment} onSaved={vi.fn()} onAskKlio={vi.fn()} /></>);
    expect(screen.getAllByText("With you")).toHaveLength(2);
    expect(screen.getByText(/Using subject default/)).toBeTruthy();
    expect(screen.getByText("Learner 9:00 AM–9:40 AM · 9:00 AM–9:40 AM with you")).toBeTruthy();
  });

  it("discloses minutes for Start together and saves the override", async () => {
    const onSaved = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ assignment: { attentionMode: "flexible", parentAttentionMinutes: 10, resolvedAttentionMode: "flexible", resolvedParentMinutes: 10, attentionInherited: false, attentionSource: "assignment" }, attentionConflicts: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ParentSupportControl assignment={assignment} onSaved={onSaved} onAskKlio={vi.fn()} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Lesson support"), "flexible");
    expect(screen.getByLabelText("Minutes together")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ resolvedAttentionMode: "flexible", resolvedParentMinutes: 10 }));
    expect(screen.getByText("Saved. Current lessons were not moved.")).toBeTruthy();
  });

  it("clears an override and prefills Ask Klio without submitting", async () => {
    const onAsk = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ assignment: { attentionMode: null, parentAttentionMinutes: null, resolvedAttentionMode: "parent_led", resolvedParentMinutes: 40, attentionInherited: true, attentionSource: "curriculum" }, attentionConflicts: [{ overlap: { start: 540, end: 570 } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ParentSupportControl assignment={{ ...assignment, attentionMode: "independent", resolvedAttentionMode: "independent", resolvedParentMinutes: 0, attentionInherited: false, attentionSource: "assignment" }} onSaved={vi.fn()} onAskKlio={onAsk} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Lesson support"), "inherit");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Two lessons need you at 9:00 AM.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ask Klio to reorganize" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
