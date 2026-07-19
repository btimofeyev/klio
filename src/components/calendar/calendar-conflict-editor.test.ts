// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarConflictEditor } from "./calendar-conflict-editor";

const affectedWork = { directOverlapCount: 1, overCapacity: true, affectedLearnerNames: ["Maya"], affectedLessonNames: ["Fractions"], learners: [] };
const returnedConflict = { id: "00000000-0000-4000-8000-000000000001", studentId: "student-a", conflictDate: "2026-07-21", allDay: false, startsAt: "10:00", endsAt: "11:30", title: "Dentist", note: null, createdAt: "2026-07-16T12:00:00Z", updatedAt: "2026-07-16T12:00:00Z" };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderEditor(scopeStudentId: string | null = "student-a") {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(React.createElement(CalendarConflictEditor, {
    familyId: "00000000-0000-4000-8000-000000000010", conflict: null, date: "2026-07-21", scopeStudentId,
    students: [{ id: "student-a", displayName: "Maya" }, { id: "student-b", displayName: "Theo" }],
    returnFocus: null, onClose, onSaved, onDeleted: vi.fn(),
  }));
  return { onSaved, onClose };
}

function renderExistingFamilyConflict(scopeStudentId = "student-b") {
  render(React.createElement(CalendarConflictEditor, {
    familyId: "00000000-0000-4000-8000-000000000010",
    conflict: { ...returnedConflict, studentId: null, allDay: true, startsAt: null, endsAt: null },
    date: "2026-07-21", scopeStudentId,
    students: [{ id: "student-a", displayName: "Maya" }, { id: "student-b", displayName: "Theo" }],
    returnFocus: null, onClose: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn(),
  }));
}

describe("CalendarConflictEditor", () => {
  it("prefills the launch date and selected learner while defaulting to all day", () => {
    renderEditor();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-07-21");
    expect((screen.getByLabelText("Applies to") as HTMLSelectElement).value).toBe("student-a");
    expect((screen.getByLabelText("All day") as HTMLInputElement).checked).toBe(true);
  });

  it("preserves Everyone when editing a family conflict from a learner view", () => {
    renderExistingFamilyConflict();
    expect((screen.getByLabelText("Applies to") as HTMLSelectElement).value).toBe("everyone");
  });

  it("keeps a stable validation error in the open editor", async () => {
    const user = userEvent.setup();
    renderEditor(null);
    await user.click(screen.getByRole("button", { name: "Add conflict" }));
    expect(screen.getByRole("alert").textContent).toContain("short label");
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
  });

  it("submits an editable timed conflict and reports affected work without moving lessons", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ conflict: returnedConflict, affectedWork }), { status: 201, headers: { "content-type": "application/json" } }));
    const { onSaved } = renderEditor();
    await user.type(screen.getByLabelText("Title"), "Dentist");
    await user.click(screen.getByLabelText("Custom"));
    await user.clear(screen.getByLabelText("Start")); await user.type(screen.getByLabelText("Start"), "10:00");
    await user.clear(screen.getByLabelText("End")); await user.type(screen.getByLabelText("End"), "11:30");
    await user.click(screen.getByRole("button", { name: "Add conflict" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(returnedConflict, affectedWork, "created"));
    const request = vi.mocked(fetch).mock.calls[0];
    expect(request[0]).toBe("/api/calendar-conflicts?family=00000000-0000-4000-8000-000000000010");
    expect(JSON.parse(String((request[1] as RequestInit).body))).toMatchObject({ title: "Dentist", studentId: "student-a", allDay: false, startsAt: "10:00", endsAt: "11:30" });
  });
});
