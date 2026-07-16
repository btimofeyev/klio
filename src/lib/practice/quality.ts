import type { DynamicActivity, DynamicPracticeSpec } from "./spec";

export type PracticeQualityIssue = {
  code: "duplicate_prompt" | "answer_leak" | "recognition_heavy" | "repeated_answer";
  activityId?: string;
  message: string;
};

export function practiceQualityIssues(spec: DynamicPracticeSpec): PracticeQualityIssue[] {
  const issues: PracticeQualityIssue[] = [];
  const prompts = new Map<string, string>();
  const primaryAnswers = new Map<string, string[]>();

  for (const activity of spec.activities) {
    const prompt = normalize(activity.prompt);
    const duplicateOf = prompts.get(prompt);
    if (duplicateOf) {
      issues.push({ code: "duplicate_prompt", activityId: activity.id, message: `Activity ${activity.id} repeats ${duplicateOf}.` });
    } else {
      prompts.set(prompt, activity.id);
    }

    const answer = primaryAnswer(activity);
    if (answer) {
      const answerKey = normalize(answer);
      primaryAnswers.set(answerKey, [...(primaryAnswers.get(answerKey) ?? []), activity.id]);
      const learnerSetup = [spec.instructions, ...activity.hints];
      if (answerKey.length > 1 && learnerSetup.some((text) => containsAnswer(text, answer))) {
        issues.push({ code: "answer_leak", activityId: activity.id, message: `Activity ${activity.id} reveals its answer before the learner responds.` });
      }
    }
  }

  const multipleChoiceCount = spec.activities.filter((activity) => activity.type === "multiple_choice").length;
  if (multipleChoiceCount > Math.floor(spec.activities.length / 2)) {
    issues.push({ code: "recognition_heavy", message: "More than half of the practice relies on multiple-choice recognition." });
  }

  for (const [answer, activityIds] of primaryAnswers) {
    if (answer.length > 0 && activityIds.length > 2) {
      issues.push({ code: "repeated_answer", message: `The same answer is reused in ${activityIds.length} activities (${activityIds.join(", ")}).` });
    }
  }

  return issues;
}

export function assertPracticeQuality(spec: DynamicPracticeSpec) {
  const issues = practiceQualityIssues(spec);
  if (issues.length) throw new Error(`PRACTICE_QUALITY_REJECTED: ${issues.map((issue) => issue.message).join(" ")}`);
}

function primaryAnswer(activity: DynamicActivity) {
  if (activity.type === "multiple_choice") return activity.correct_answer;
  if (activity.type === "short_answer") return activity.accepted_answers[0];
  return null;
}

function containsAnswer(text: string, answer: string) {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedAnswer = normalize(answer);
  return normalizedText.includes(` ${normalizedAnswer} `);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
