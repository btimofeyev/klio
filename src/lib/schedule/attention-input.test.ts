import { describe, expect, it } from "vitest";
import { assignmentAttentionInputSchema, curriculumAttentionInputSchema, maximumFlexibleParentMinutes } from "./attention-input";

describe("attention update input", () => {
  it("accepts curriculum defaults and assignment inheritance", () => {
    expect(curriculumAttentionInputSchema.parse({ attentionMode: "parent_led", parentAttentionMinutes: null })).toEqual({ attentionMode: "parent_led", parentAttentionMinutes: null });
    expect(assignmentAttentionInputSchema.parse({ attentionMode: null, parentAttentionMinutes: null })).toEqual({ attentionMode: null, parentAttentionMinutes: null });
  });

  it("requires bounded minutes only for Start together", () => {
    expect(assignmentAttentionInputSchema.safeParse({ attentionMode: "flexible", parentAttentionMinutes: null }).success).toBe(false);
    expect(assignmentAttentionInputSchema.safeParse({ attentionMode: "independent", parentAttentionMinutes: 10 }).success).toBe(false);
    expect(curriculumAttentionInputSchema.safeParse({ attentionMode: "flexible", parentAttentionMinutes: 481 }).success).toBe(false);
  });

  it("rejects unknown fields and modes", () => {
    expect(assignmentAttentionInputSchema.safeParse({ attentionMode: "together", parentAttentionMinutes: null }).success).toBe(false);
    expect(assignmentAttentionInputSchema.safeParse({ attentionMode: null, parentAttentionMinutes: null, scheduledTime: "09:00" }).success).toBe(false);
  });

  it("uses the curriculum default for flexible-length lessons", () => {
    expect(maximumFlexibleParentMinutes(40, [null, 30, 45])).toBe(30);
    expect(maximumFlexibleParentMinutes(40, [null])).toBe(40);
    expect(maximumFlexibleParentMinutes(40, [])).toBe(40);
  });
});
