import type { DynamicActivity, DynamicPracticeSpec, PracticeAnswer } from "./spec";

export function scorePractice(
  questions: Array<{ correct_answer: string }>,
  answers: string[],
  masteryPercent: number,
) {
  if (!questions.length || answers.length !== questions.length) {
    return { score: 0, masteryMet: false, complete: false };
  }
  const correct = questions.reduce(
    (total, question, index) =>
      total +
      (answers[index]?.trim().toLocaleLowerCase() ===
      question.correct_answer.trim().toLocaleLowerCase()
        ? 1
        : 0),
    0,
  );
  const score = Math.round((correct / questions.length) * 100);
  return { score, masteryMet: score >= masteryPercent, complete: true };
}

export function evaluateActivityAnswer(activity: DynamicActivity, answer: PracticeAnswer): boolean | null {
  if (activity.id !== answer.activityId || activity.type !== answer.type) return false;
  if (activity.type === "multiple_choice" && answer.type === "multiple_choice") return normalizeText(answer.value) === normalizeText(activity.correct_answer);
  if (activity.type === "short_answer" && answer.type === "short_answer") return activity.accepted_answers.some((accepted) => normalizeExpression(answer.value) === normalizeExpression(accepted));
  if (activity.type === "graph_line" && answer.type === "graph_line") {
    const [first, second] = answer.points;
    if (Math.abs(second.x - first.x) < 0.001) return false;
    const slope = (second.y - first.y) / (second.x - first.x);
    const intercept = first.y - slope * first.x;
    return Math.abs(slope - activity.expected_slope) <= 0.08 && Math.abs(intercept - activity.expected_y_intercept) <= 0.15;
  }
  if (activity.type === "written_response" && answer.type === "written_response") return null;
  return false;
}

export function scoreDynamicPractice(spec: DynamicPracticeSpec, answers: PracticeAnswer[], writtenEvaluations: ReadonlyMap<string, boolean> = new Map()) {
  const byId = new Map(answers.map((answer) => [answer.activityId, answer]));
  const evaluations = spec.activities.map((activity) => {
    const answer = byId.get(activity.id);
    const evaluated = answer ? evaluateActivityAnswer(activity, answer) : false;
    return evaluated === null && writtenEvaluations.has(activity.id) ? writtenEvaluations.get(activity.id)! : evaluated;
  });
  const graded = evaluations.filter((result): result is boolean => result !== null);
  const correct = graded.filter(Boolean).length;
  const complete = answers.length === spec.activities.length;
  const score = graded.length ? Math.round((correct / graded.length) * 100) : 0;
  const reviewNeeded = evaluations.some((result) => result === null);
  return {
    score: complete ? score : 0,
    masteryMet: complete && !reviewNeeded && graded.length > 0 && score >= spec.mastery_percent,
    complete,
    gradedCount: graded.length,
    reviewNeeded,
    scoringState: reviewNeeded ? "provisional" as const : "final" as const,
  };
}

function normalizeText(value: string) { return value.trim().toLocaleLowerCase(); }
function normalizeExpression(value: string) {
  return value.toLocaleLowerCase().replace(/[−–—]/g, "-").replace(/\s+/g, "").replace(/\*/g, "");
}
