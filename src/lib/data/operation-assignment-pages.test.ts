import { describe, expect, it } from "vitest";
import {
  decodeCurriculumAssignmentCursor,
  decodeScheduledAssignmentCursor,
  dedupeAssignmentsById,
  encodeCurriculumAssignmentCursor,
  encodeScheduledAssignmentCursor,
  operationsDateRange,
  pageWithLookahead,
} from "@/lib/data/operation-assignment-pages";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

describe("operationsDateRange", () => {
  it("uses one exact day for Today", () => {
    expect(operationsDateRange("today", "2026-07-18")).toEqual({ from: "2026-07-18", to: "2026-07-18" });
  });

  it.each([
    ["2026-07-13", { from: "2026-07-13", to: "2026-07-19" }],
    ["2026-07-19", { from: "2026-07-13", to: "2026-07-19" }],
    ["2026-01-01", { from: "2025-12-29", to: "2026-01-04" }],
    ["2026-08-01", { from: "2026-07-27", to: "2026-08-02" }],
  ])("uses the full Monday-Sunday week containing %s", (anchor, range) => {
    expect(operationsDateRange("week", anchor)).toEqual(range);
  });

  it.each([
    ["2026-02-14", { from: "2026-01-26", to: "2026-03-01" }],
    ["2024-02-29", { from: "2024-01-29", to: "2024-03-03" }],
    ["2026-08-15", { from: "2026-07-27", to: "2026-09-06" }],
  ])("uses every date visible in the month grid for %s", (anchor, range) => {
    expect(operationsDateRange("month", anchor)).toEqual(range);
  });

  it("rejects invalid calendar dates", () => {
    expect(() => operationsDateRange("today", "2026-02-30")).toThrow();
  });
});

describe("assignment cursors", () => {
  it.each(["09:15:00", null])("round trips a scheduled cursor with time %s", (time) => {
    const value = { v: 1 as const, date: "2026-07-18", time, id: firstId };
    expect(decodeScheduledAssignmentCursor(encodeScheduledAssignmentCursor(value))).toEqual(value);
  });

  it.each([42, null])("round trips a curriculum cursor with sequence %s", (sequence) => {
    const value = { v: 1 as const, sequence, id: secondId };
    expect(decodeCurriculumAssignmentCursor(encodeCurriculumAssignmentCursor(value))).toEqual(value);
  });

  it.each([
    "%%not-base64%%",
    Buffer.from("not json").toString("base64url"),
    Buffer.from(JSON.stringify({ v: 2, date: "2026-07-18", time: null, id: firstId })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, date: "2026-02-30", time: null, id: firstId })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, date: "2026-07-18", time: "25:00:00", id: firstId })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, date: "2026-07-18", time: null, id: "not-a-uuid" })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, date: "2026-07-18", time: null, id: firstId, extra: true })).toString("base64url"),
    "a".repeat(1025),
  ])("rejects a malformed scheduled cursor", (cursor) => {
    expect(() => decodeScheduledAssignmentCursor(cursor)).toThrow();
  });

  it.each([
    Buffer.from(JSON.stringify({ v: 0, sequence: 1, id: firstId })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, sequence: 1.5, id: firstId })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, sequence: 1, id: "not-a-uuid" })).toString("base64url"),
  ])("rejects a malformed curriculum cursor", (cursor) => {
    expect(() => decodeCurriculumAssignmentCursor(cursor)).toThrow();
  });
});

describe("page helpers", () => {
  it("uses one look-ahead row and places the cursor after the last returned row", () => {
    const rows = [{ id: "one" }, { id: "two" }, { id: "three" }];
    expect(pageWithLookahead(rows, 2, (row) => row.id)).toEqual({
      items: [{ id: "one" }, { id: "two" }],
      nextCursor: "two",
    });
    expect(pageWithLookahead(rows.slice(2), 2, (row) => row.id)).toEqual({
      items: [{ id: "three" }],
      nextCursor: null,
    });
  });

  it("deduplicates boundary rows while preserving stable order", () => {
    expect(dedupeAssignmentsById([{ id: "one" }, { id: "two" }, { id: "two" }, { id: "three" }]))
      .toEqual([{ id: "one" }, { id: "two" }, { id: "three" }]);
  });
});
