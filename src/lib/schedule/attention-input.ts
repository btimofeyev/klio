import { z } from "zod";

export const curriculumAttentionInputSchema = z.object({
  attentionMode: z.enum(["unspecified", "parent_led", "independent", "flexible"]),
  parentAttentionMinutes: z.number().int().min(1).max(480).nullable(),
}).strict().superRefine(validateShape);

export const assignmentAttentionInputSchema = z.object({
  attentionMode: z.enum(["unspecified", "parent_led", "independent", "flexible"]).nullable(),
  parentAttentionMinutes: z.number().int().min(1).max(480).nullable(),
}).strict().superRefine(validateShape);

export function maximumFlexibleParentMinutes(defaultMinutes: number, lessonMinutes: readonly (number | null)[]) {
  return Math.min(defaultMinutes, ...lessonMinutes.map((minutes) => minutes ?? defaultMinutes));
}

function validateShape(value: { attentionMode: "unspecified" | "parent_led" | "independent" | "flexible" | null; parentAttentionMinutes: number | null }, context: z.RefinementCtx) {
  if (value.attentionMode === "flexible" && value.parentAttentionMinutes === null) {
    context.addIssue({ code: "custom", path: ["parentAttentionMinutes"], message: "Add the minutes you will spend together." });
  }
  if (value.attentionMode !== "flexible" && value.parentAttentionMinutes !== null) {
    context.addIssue({ code: "custom", path: ["parentAttentionMinutes"], message: "Minutes together are only used for Start together." });
  }
}
