import { describe, expect, it } from "vitest";
import { moveWorkspaceTab, workspaceRailLayout, workspaceRailPositions, type SpatialWorkspaceItem } from "./spatial-workspace";

function item(id: string, x: number, y: number, persistPosition = true): SpatialWorkspaceItem {
  return { id, label: id, title: id, x, y, width: 400, persistPosition, children: null };
}

describe("schedule-centered workspace tabs", () => {
  const items = [
    item("schedule", 700, 400),
    item("review", 260, 520),
    item("attention", 1500, 490),
    item("progress", 240, 1450),
    item("records", 1500, 1450),
  ];

  it("derives a stable left and right tab order from the prepared desk", () => {
    expect(workspaceRailLayout(items)).toEqual({
      left: ["review", "progress"],
      right: ["attention", "records"],
    });
  });

  it("keeps a healthy workspace free of placeholder side tabs", () => {
    expect(workspaceRailLayout([item("schedule", 700, 400)])).toEqual({ left: [], right: [] });
  });

  it("restores a personalized side and order from the existing family layout", () => {
    expect(workspaceRailLayout(items, "schedule", {
      schedule: { x: 700, y: 400 },
      records: { x: 0, y: 100 },
      progress: { x: 0, y: 200 },
      attention: { x: 3200, y: 200 },
      review: { x: 3200, y: 100 },
    })).toEqual({ left: ["records", "progress"], right: ["review", "attention"] });
  });

  it("moves tabs between rails without duplicates", () => {
    const moved = moveWorkspaceTab({ left: ["review", "progress"], right: ["attention", "records"] }, "records", "left", 1);
    expect(moved).toEqual({ left: ["review", "records", "progress"], right: ["attention"] });
  });

  it("serializes tab preferences through the bounded legacy position contract", () => {
    expect(workspaceRailPositions(items, "schedule", { left: ["progress", "review"], right: ["records", "attention"] })).toEqual({
      schedule: { x: 700, y: 400 },
      progress: { x: 0, y: 100 },
      review: { x: 0, y: 200 },
      records: { x: 3200, y: 100 },
      attention: { x: 3200, y: 200 },
    });
  });
});
