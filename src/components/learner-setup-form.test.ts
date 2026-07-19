// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/app/actions", () => ({
  updateStudentSetupAction: vi.fn(async () => ({ error: null, success: "Saved" })),
}));

import { LearnerSetupForm } from "./learner-setup-form";

afterEach(cleanup);

function renderForm(teachingWindows: Record<string, { start: string; end: string }> = {}) {
  render(React.createElement(LearnerSetupForm, {
    familyId: "family-a",
    learner: {
      id: "student-a", displayName: "Maya", gradeBand: "3-5", learningPreferences: null,
      dailyCapacityMinutes: 180, learningDays: ["Mon", "Tue"], teachingWindows,
      subjects: [{ id: "subject-a", name: "Math", courseName: "Fractions", weeklyFrequency: 3, attentionMode: "unspecified", parentAttentionMinutes: null }],
    },
  }));
}

function openSection(name: "Schedule" | "Subjects") {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(name) }));
}

describe("LearnerSetupForm teaching hours", () => {
  it("opens as a focused profile with schedule and subjects one selection away", () => {
    renderForm();
    expect(screen.getByRole("tab", { name: /Profile/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Schedule/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Subjects/ })).toBeTruthy();
  });

  it("shows one flexible teaching-hours row for each selected learning day", () => {
    renderForm();
    openSection("Schedule");
    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("Tuesday")).toBeTruthy();
    expect(screen.queryByText("Wednesday")).toBeNull();
    const flexible = screen.getAllByRole("checkbox", { name: "Flexible" }) as HTMLInputElement[];
    expect(flexible).toHaveLength(2);
    expect(flexible.every((input) => input.checked)).toBe(true);
  });

  it("adds editable defaults when Flexible is turned off and removes them when restored", async () => {
    const user = userEvent.setup();
    renderForm();
    openSection("Schedule");
    const flexible = screen.getAllByRole("checkbox", { name: "Flexible" })[0];
    await user.click(flexible);
    expect((screen.getByLabelText("Monday teaching start") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("Monday teaching end") as HTMLInputElement).value).toBe("12:00");
    await user.click(flexible);
    expect(screen.queryByLabelText("Monday teaching start")).toBeNull();
  });

  it("explains when the teaching window is shorter than the daily learning limit", () => {
    renderForm({ Mon: { start: "09:00", end: "10:30" } });
    openSection("Schedule");
    expect(screen.getByText("1 hr 30 min becomes this day’s effective limit.")).toBeTruthy();
    expect(screen.getByText(/Existing lessons stay where they are/)).toBeTruthy();
  });

  it("removes an unchecked learning day from the visible teaching-hours editor", async () => {
    const user = userEvent.setup();
    renderForm({ Tue: { start: "10:00", end: "13:00" } });
    openSection("Schedule");
    const dayInputs = screen.getAllByRole("checkbox").filter((input) => (input as HTMLInputElement).value === "Tue");
    await user.click(dayInputs[0]);
    expect(screen.queryByText("Tuesday")).toBeNull();
    expect(screen.queryByLabelText("Tuesday teaching start")).toBeNull();
  });

  it("edits a subject parent-support default with progressive Start together minutes", async () => {
    const user = userEvent.setup();
    renderForm();
    openSection("Subjects");
    const support = screen.getByLabelText("Math parent support");
    expect((support as HTMLSelectElement).value).toBe("unspecified");
    expect(screen.getByText("Klio will schedule this conservatively until you choose.")).toBeTruthy();
    expect(screen.queryByText("Minutes together")).toBeNull();
    await user.selectOptions(support, "flexible");
    expect((screen.getByLabelText("Minutes together") as HTMLInputElement).valueAsNumber).toBe(10);
    expect(screen.getByText("You help them begin, then they continue independently.")).toBeTruthy();
    const serialized = screen.getByDisplayValue(/"attentionMode":"flexible"/) as HTMLInputElement;
    expect(JSON.parse(serialized.value)[0]).toMatchObject({ name: "Math", attentionMode: "flexible", parentAttentionMinutes: 10 });
  });
});
