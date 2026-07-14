import { z } from "zod";

const baseActivity = {
  id: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(1500),
  hints: z.array(z.string().trim().min(1).max(500)).max(4),
  explanation: z.string().trim().min(1).max(1200),
};

export const multipleChoiceActivitySchema = z.object({
  ...baseActivity,
  type: z.literal("multiple_choice"),
  choices: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
  correct_answer: z.string().trim().min(1).max(500),
}).refine((activity) => activity.choices.includes(activity.correct_answer), {
  message: "The correct answer must be one of the choices.",
  path: ["correct_answer"],
});

export const shortAnswerActivitySchema = z.object({
  ...baseActivity,
  type: z.literal("short_answer"),
  accepted_answers: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  placeholder: z.string().trim().max(160).optional(),
});

export const graphLineActivitySchema = z.object({
  ...baseActivity,
  type: z.literal("graph_line"),
  expected_slope: z.number().min(-20).max(20),
  expected_y_intercept: z.number().min(-20).max(20),
  x_min: z.number().int().min(-20).max(-1).default(-6),
  x_max: z.number().int().min(1).max(20).default(6),
  y_min: z.number().int().min(-20).max(-1).default(-6),
  y_max: z.number().int().min(1).max(20).default(6),
});

export const writtenResponseActivitySchema = z.object({
  ...baseActivity,
  type: z.literal("written_response"),
  success_criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
  placeholder: z.string().trim().max(240).optional(),
  max_length: z.number().int().min(50).max(4000).default(1200),
});

export const dynamicActivitySchema = z.union([
  multipleChoiceActivitySchema,
  shortAnswerActivitySchema,
  graphLineActivitySchema,
  writtenResponseActivitySchema,
]);

export const dynamicPracticeSpecSchema = z.object({
  version: z.literal(2),
  subject: z.string().trim().min(1).max(80),
  skill_key: z.string().trim().min(1).max(160),
  level_band: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(2000),
  mastery_percent: z.number().int().min(1).max(100),
  activities: z.array(dynamicActivitySchema).min(3).max(12),
}).strict().superRefine((spec, context) => {
  if (new Set(spec.activities.map((activity) => activity.id)).size !== spec.activities.length) {
    context.addIssue({ code: "custom", message: "Activity IDs must be unique.", path: ["activities"] });
  }
  if (new Set(spec.activities.map((activity) => activity.type)).size < 2) {
    context.addIssue({ code: "custom", message: "Use at least two activity types.", path: ["activities"] });
  }
});

const legacyQuestionSchema = z.object({
  prompt: z.string(), choices: z.array(z.string()).min(2), correct_answer: z.string(), hints: z.array(z.string()),
});

const legacyPracticeSpecSchema = z.object({
  skill_key: z.string(), level_band: z.string(), instructions: z.string(), mastery_percent: z.number().int().min(1).max(100),
  questions: z.array(legacyQuestionSchema).min(1),
});

export const practiceSpecSchema = z.union([dynamicPracticeSpecSchema, legacyPracticeSpecSchema]);
export type DynamicPracticeSpec = z.infer<typeof dynamicPracticeSpecSchema>;
export type DynamicActivity = z.infer<typeof dynamicActivitySchema>;

export const practiceAnswerSchema = z.discriminatedUnion("type", [
  z.object({ activityId: z.string(), type: z.literal("multiple_choice"), value: z.string() }),
  z.object({ activityId: z.string(), type: z.literal("short_answer"), value: z.string() }),
  z.object({ activityId: z.string(), type: z.literal("graph_line"), points: z.tuple([z.object({ x: z.number(), y: z.number() }), z.object({ x: z.number(), y: z.number() })]) }),
  z.object({ activityId: z.string(), type: z.literal("written_response"), value: z.string() }),
]);
export type PracticeAnswer = z.infer<typeof practiceAnswerSchema>;

export function parsePracticeSpec(value: unknown) {
  const parsed = practiceSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizePracticeSpec(value: unknown): DynamicPracticeSpec | null {
  const parsed = practiceSpecSchema.safeParse(value);
  if (!parsed.success) return null;
  if ("version" in parsed.data) return parsed.data;
  return {
    version: 2,
    subject: "Practice",
    skill_key: parsed.data.skill_key,
    level_band: parsed.data.level_band,
    instructions: parsed.data.instructions,
    mastery_percent: parsed.data.mastery_percent,
    activities: parsed.data.questions.map((question, index) => ({
      id: `question-${index + 1}`,
      type: "multiple_choice" as const,
      prompt: question.prompt,
      choices: question.choices,
      correct_answer: question.correct_answer,
      hints: question.hints,
      explanation: `The correct answer is ${question.correct_answer}.`,
    })),
  };
}
