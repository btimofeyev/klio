export type AssignmentSubmissionOutcome = "comment" | "completed" | "needs_review";

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
  if (!hasUploadedWork && !reviewSignal.test(note) && !hasLetterGrade) return "comment";
  return "needs_review";
}

export function assignmentSubmissionDeclaresCompletion(note?: string | null) {
  return completionSignal.test(note?.trim() ?? "");
}

const openEndedFollowThroughSignal = /\b(?:practice|practise|struggl(?:e|ed|ing)?|difficult(?:y|ies)?|mistakes?|confus(?:ed|ing)|stuck|weak(?:ness)?|need(?:s|ed)? help|could use|extra support|reinforce|work on)\b/i;

export function assignmentHandoffNeedsAgent(note?: string | null) {
  return openEndedFollowThroughSignal.test(note?.trim() ?? "");
}
