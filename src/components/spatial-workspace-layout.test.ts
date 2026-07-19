// @vitest-environment jsdom

import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpatialWorkspace, type SpatialWorkspaceItem } from "./spatial-workspace";

afterEach(cleanup);

const schedule: SpatialWorkspaceItem = {
  id: "schedule",
  label: "Schedule",
  title: "Friday, July 17",
  x: 730,
  y: 470,
  width: 720,
  children: React.createElement("div", null, "Your day"),
};

function renderWorkspace(items: SpatialWorkspaceItem[], briefing: React.ReactNode) {
  return render(React.createElement(SpatialWorkspace, {
    ariaLabel: "Daily homeschool teaching board",
    persistenceKey: "day:all",
    items,
    initialView: { x: 0, y: 0, zoom: 1 },
    overviewView: { x: 0, y: 0, zoom: 1 },
    toolbar: React.createElement("div", null, "Toolbar"),
    briefing,
    assistant: React.createElement("div", null, "Assistant"),
  }));
}

describe("spatial workspace briefing layout", () => {
  it("uses the expanded quiet schedule when no briefing or rail content exists", () => {
    renderWorkspace([schedule], null);

    expect(screen.getByText("Your day")).toBeInTheDocument();
    expect(document.querySelector("[data-spatial-board]")).toHaveAttribute("data-has-briefing", "false");
    expect(document.querySelector("[data-spatial-board]")).toHaveAttribute("data-layout", "quiet");
    expect(screen.queryByRole("navigation", { name: /workspace tabs/i })).not.toBeInTheDocument();
  });

  it("keeps both workspace rails mounted beside a visible briefing", () => {
    const practice: SpatialWorkspaceItem = { ...schedule, id: "practice", label: "Practice", title: "Focused review", x: 1500, y: 800 };
    const insight: SpatialWorkspaceItem = { ...schedule, id: "insight", label: "Klio noticed", title: "A useful pattern", x: 260, y: 520 };
    renderWorkspace([schedule, practice, insight], React.createElement("section", { "data-briefing-side": "right" }, "Preparing your week"));

    expect(screen.getByText("Preparing your week")).toBeInTheDocument();
    expect(document.querySelector("[data-spatial-board]")).toHaveAttribute("data-has-briefing", "true");
    expect(screen.getByRole("navigation", { name: "Left workspace tabs" })).toHaveTextContent("Klio noticed");
    expect(screen.getByRole("navigation", { name: "Right workspace tabs" })).toHaveTextContent("Practice");
  });
});
