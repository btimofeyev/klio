import { describe, expect, it } from "vitest";
import { detectLearningTrend, type TrendEvidence } from "./trends";

const base = { studentId: "jacob", subject: "Biology", skillKey: "osmosis-explanations", approved: true, kind: "curriculum" as const };
const results = (scores: number[]): TrendEvidence[] => scores.map((score, index) => ({ ...base, id: `r${index}`, score, occurredAt: `2026-07-${10 + index}T12:00:00.000Z` }));

describe("cautious learning trends", () => {
  it("detects a related approved downward trend", () => expect(detectLearningTrend(results([86, 78, 69]), new Date("2026-07-14T12:00:00Z"))).toMatchObject({ kind: "downward", evidence: [{ id: "r0" }, { id: "r1" }, { id: "r2" }] }));
  it("does not overreact to one low score", () => expect(detectLearningTrend(results([62]), new Date("2026-07-14T12:00:00Z")).kind).toBe("insufficient"));
  it("does not combine unrelated skills or draft evidence", () => {
    const mixed = results([86, 78, 69]); mixed[1].skillKey = "cell-division"; mixed[2].approved = false;
    expect(detectLearningTrend(mixed, new Date("2026-07-14T12:00:00Z")).kind).toBe("insufficient");
  });
  it("recognizes sustained improvement cautiously", () => expect(detectLearningTrend(results([70, 84, 92]), new Date("2026-07-14T12:00:00Z")).kind).toBe("improving"));
});
