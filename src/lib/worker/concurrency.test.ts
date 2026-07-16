import { describe, expect, it } from "vitest";
import { fairFamilyQueue, runBounded } from "./concurrency";

describe("worker concurrency", () => {
  it("round-robins families so one large queue cannot starve another", () => {
    const items = [
      ...Array.from({ length: 5 }, (_, index) => ({ family_id: "a", id: `a${index}` })),
      { family_id: "b", id: "b0" }, { family_id: "c", id: "c0" },
    ];
    expect(fairFamilyQueue(items, 5).map((item) => item.id)).toEqual(["a0", "b0", "c0", "a1", "a2"]);
  });

  it("overlaps unrelated work while respecting a deterministic concurrency ceiling", async () => {
    let active = 0;
    let maximum = 0;
    const releases = new Map<number, () => void>();
    const started: number[] = [];
    const running = runBounded([1, 2, 3, 4], 2, async (item) => {
      active += 1; maximum = Math.max(maximum, active); started.push(item);
      await new Promise<void>((resolve) => releases.set(item, resolve));
      active -= 1;
    });
    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    releases.get(1)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toContain(3);
    releases.get(2)?.();
    await Promise.resolve();
    await Promise.resolve();
    releases.get(3)?.();
    releases.get(4)?.();
    await running;
    expect(maximum).toBe(2);
  });
});
