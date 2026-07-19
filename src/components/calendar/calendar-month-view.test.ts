// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarMonthView } from "./calendar-month-view";
import type { AssignmentDTO, CalendarConflictDTO } from "@/lib/data/operations";
import type { StudentDTO } from "@/lib/data/workspace";

afterEach(cleanup);

const students = [
  { id: "student-a", displayName: "Maya", dailyCapacityMinutes: 180, schedulePreferences: { learningDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] } },
  { id: "student-b", displayName: "Theo", dailyCapacityMinutes: 120, schedulePreferences: { learningDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] } },
] as StudentDTO[];

const assignments = [
  { id: "lesson-a", studentId: "student-a", scheduledDate: "2026-07-21", status: "planned", estimatedMinutes: 40, title: "Fractions" },
  { id: "lesson-b", studentId: "student-a", scheduledDate: "2026-07-21", status: "planned", estimatedMinutes: 30, title: "Reading" },
  { id: "lesson-c", studentId: "student-b", scheduledDate: "2026-07-21", status: "planned", estimatedMinutes: 20, title: "Phonics" },
] as AssignmentDTO[];

const conflicts = [{
  id: "conflict-a", studentId: "student-a", conflictDate: "2026-07-21", allDay: true, startsAt: null, endsAt: null,
  title: "Co-op", note: null, createdAt: "2026-07-16T12:00:00Z", updatedAt: "2026-07-16T12:00:00Z",
}] as CalendarConflictDTO[];

function renderMonth(scopeStudentId = "all") {
  const onAddConflict = vi.fn();
  const onEditConflict = vi.fn();
  render(React.createElement(CalendarMonthView, {
    anchorDate: "2026-07-16", selectedDate: "2026-07-21", currentDate: "2026-07-16", scopeStudentId,
    familyLearningDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], students, assignments,
    conflicts, onSelectDate: vi.fn(), onViewWeek: vi.fn(), onAddConflict, onEditConflict,
  }));
  return { onAddConflict, onEditConflict };
}

describe("CalendarMonthView", () => {
  it("renders a Monday-first complete month grid with lesson and conflict summaries", () => {
    renderMonth();
    expect(screen.getAllByRole("button", { name: /Add conflict on/ })).toHaveLength(35);
    expect(screen.getByLabelText("Monday, June 29, 2026")).toBeTruthy();
    expect(screen.getByLabelText("Sunday, August 2, 2026")).toBeTruthy();
    expect(screen.getByLabelText("Tuesday, July 21, 2026").textContent).toContain("3 lessons · 90 min");
    expect(screen.getByRole("button", { name: "Co-op" })).toBeTruthy();
    expect(screen.getByText("Over available time")).toBeTruthy();
  });

  it("filters lesson totals to the selected learner and exposes every date add action", () => {
    const { onAddConflict, onEditConflict } = renderMonth("student-a");
    expect(screen.getByLabelText("Tuesday, July 21, 2026").textContent).toContain("2 lessons · 70 min");
    expect(screen.getByLabelText("Tuesday, July 21, 2026").textContent).not.toContain("3 lessons · 90 min");
    fireEvent.click(screen.getByRole("button", { name: "Add conflict on Tuesday, July 21, 2026" }));
    expect(onAddConflict).toHaveBeenCalledWith("2026-07-21", expect.any(HTMLElement));
    fireEvent.click(screen.getByRole("button", { name: "Co-op" }));
    expect(onEditConflict).toHaveBeenCalledWith(conflicts[0], expect.any(HTMLElement));
  });

  it("shows one compact warning when the day’s direct parent load cannot fit", () => {
    const timedStudents = students.map((student) => ({ ...student, schedulePreferences: { learningDays: ["Tue"], teachingWindows: { Tue: { start: "09:00", end: "10:00" } } } })) as StudentDTO[];
    const parentWork = assignments.slice(0, 2).map((assignment, index) => ({
      ...assignment,
      id: `parent-${index}`,
      studentId: timedStudents[index].id,
      attentionMode: "parent_led" as const,
      resolvedAttentionMode: "parent_led" as const,
      resolvedParentMinutes: assignment.estimatedMinutes ?? 0,
      attentionInherited: false,
      attentionSource: "assignment" as const,
    })) as AssignmentDTO[];
    render(React.createElement(CalendarMonthView, {
      anchorDate: "2026-07-16", selectedDate: "2026-07-21", currentDate: "2026-07-16", scopeStudentId: "all",
      familyLearningDays: ["Tue"], students: timedStudents, assignments: parentWork, conflicts: [],
      onSelectDate: vi.fn(), onViewWeek: vi.fn(), onAddConflict: vi.fn(), onEditConflict: vi.fn(),
    }));
    expect(screen.getByLabelText("Tuesday, July 21, 2026").textContent).toContain("Parent time does not fit");
  });
});
