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
