// @vitest-environment jsdom

import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderDTO } from "@/lib/data/workspace";
import { ActivityReminderList } from "./activity-reminder-list";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const reminders: ReminderDTO[] = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Bring the history map", notes: "Needed for the source activity.", dueAt: "2026-07-16T13:00:00.000Z", status: "pending", studentId: "jacob", sourceEvidenceId: null, createdAt: "2026-07-15T13:00:00.000Z" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Print the reading pages", notes: null, dueAt: "2026-07-17T13:00:00.000Z", status: "pending", studentId: null, sourceEvidenceId: null, createdAt: "2026-07-16T13:00:00.000Z" },
];

beforeEach(() => {
  vi.setSystemTime(new Date("2026-07-18T14:00:00.000Z"));
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderList(items: ReminderDTO[] = reminders, names: Record<string, string> = { jacob: "Jacob" }) {
  return render(React.createElement(ActivityReminderList, { initialReminders: items, studentNames: names }));
}

describe("ActivityReminderList", () => {
  it("shows the actual overdue reminders with learner and age", () => {
    renderList();
    expect(screen.getByText("Bring the history map")).toBeVisible();
    expect(screen.getByText("Jacob · 2 days overdue")).toBeVisible();
    expect(screen.getByText("Due yesterday")).toBeVisible();
    expect(screen.getByText("Needed for the source activity.")).toBeVisible();
  });

  it("completes a reminder and removes it from the actionable list", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "completed" }), { status: 200, headers: { "content-type": "application/json" } }));
    renderList();
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark Bring the history map done" }));
    await waitFor(() => expect(screen.queryByText("Bring the history map")).not.toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith("/api/reminders/11111111-1111-4111-8111-111111111111", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "completed" }) }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("moves a reminder to tomorrow without marking it complete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "pending" }), { status: 200, headers: { "content-type": "application/json" } }));
    renderList([reminders[1]], {});
    await userEvent.setup().click(screen.getByRole("button", { name: "Move Print the reading pages to tomorrow" }));
    await waitFor(() => expect(screen.getByText("No overdue reminders")).toBeVisible());
    const request = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { dueAt: string };
    expect(new Date(body.dueAt).getDate()).toBe(19);
    expect(body).not.toHaveProperty("status");
  });

  it("keeps the reminder visible and explains an update failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "That reminder could not be found." }), { status: 404, headers: { "content-type": "application/json" } }));
    renderList([reminders[0]]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss Bring the history map" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That reminder could not be found.");
    expect(screen.getByText("Bring the history map")).toBeVisible();
  });
});
