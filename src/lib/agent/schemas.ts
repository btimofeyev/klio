import { z } from "zod";

const observation = z.object({
  subject: z.string(),
  skill_key: z.string(),
  skill_label: z.string(),
  status: z.enum(["emerging", "developing", "secure", "needs-review"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  uncertainty_flags: z.array(z.string()),
});

const planItem = z.object({
  title: z.string(),
  description: z.string(),
  day_offset: z.number().int().min(0).max(13).nullable(),
  estimated_minutes: z.number().int().min(1).max(480).nullable(),
  subject: z.string().nullable(),
  skill_key: z.string().nullable(),
});

const practiceQuestion = z.object({
  prompt: z.string(),
  choices: z.array(z.string()),
  correct_answer: z.string(),
  hints: z.array(z.string()),
});

export const agentArtifactSchema = z.object({
  artifact_type: z.enum(["analysis", "next_step", "weekly_plan", "lesson", "summary", "practice", "portfolio"]),
  title: z.string(),
  summary: z.string(),
  rationale: z.string(),
  uncertainty_flags: z.array(z.string()),
  observations: z.array(observation),
  content: z.object({
    overview: z.string(),
    sections: z.array(z.object({ heading: z.string(), body: z.string(), items: z.array(z.string()) })),
    suggested_actions: z.array(z.string()),
    plan_items: z.array(planItem),
    practice: z.object({
      skill_key: z.string(),
      level_band: z.string(),
      instructions: z.string(),
      mastery_percent: z.number().int().min(1).max(100),
      questions: z.array(practiceQuestion),
    }).nullable(),
  }),
});

export type AgentArtifact = z.infer<typeof agentArtifactSchema>;
