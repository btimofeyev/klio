export type AssignmentSubmissionOutcome = "completed" | "needs_review";

type SubmissionSource = {
  note?: string | null;
  evidence: Array<{ kind: string; storagePath?: string | null }>;
};

const completionSignal = /\b(?:done|finished|completed|complete|wrapped up|got (?:it|this|the (?:lesson|assignment|work)) done)\b/i;
const reviewSignal = /(?:\b(?:score|grade|graded|points?|percent|percentage|quiz|test|rubric|feedback|review|check my|correct my|passed|failed)\b|\d+(?:\.\d+)?\s*%|\b\d+\s*\/\s*\d+\b)/i;

export function assignmentSubmissionOutcome(source: SubmissionSource): AssignmentSubmissionOutcome {
  const note = source.note?.trim() ?? "";
  const hasUploadedWork = source.evidence.some((item) => Boolean(item.storagePath) || item.kind !== "note");
  const hasLetterGrade = /(?:^|\s)[A-F][+-]?(?=\s|[.,;!?]|$)/.test(note);
  if (!hasUploadedWork && completionSignal.test(note) && !reviewSignal.test(note) && !hasLetterGrade) return "completed";
  return "needs_review";
}
