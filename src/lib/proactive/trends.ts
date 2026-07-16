export type TrendEvidence = {
  id: string;
  studentId: string;
  subject: string;
  skillKey: string;
  score: number;
  approved: boolean;
  occurredAt: string;
  kind: "curriculum" | "practice";
};

export type TrendResult = {
  kind: "downward" | "improving" | "stable" | "insufficient";
  evidence: TrendEvidence[];
  reason: string;
};

export function detectLearningTrend(values: TrendEvidence[], now = new Date()): TrendResult {
  const recentCutoff = now.getTime() - 120 * 24 * 60 * 60 * 1000;
  const approved = values
    .filter((item) => item.approved && Number.isFinite(item.score) && new Date(item.occurredAt).getTime() >= recentCutoff)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (approved.length < 3) return { kind: "insufficient", evidence: approved, reason: "At least three related approved results are required." };
  const identity = `${approved.at(-1)!.studentId}\u0000${normalized(approved.at(-1)!.subject)}\u0000${normalized(approved.at(-1)!.skillKey)}`;
  const related = approved.filter((item) => `${item.studentId}\u0000${normalized(item.subject)}\u0000${normalized(item.skillKey)}` === identity).slice(-4);
  if (related.length < 3) return { kind: "insufficient", evidence: related, reason: "The approved results do not measure the same subject and skill." };
  const lastThree = related.slice(-3);
  const scores = lastThree.map((item) => item.score);
  const curriculumCount = lastThree.filter((item) => item.kind === "curriculum").length;
  if (curriculumCount >= 2 && scores[0] > scores[1] && scores[1] > scores[2] && scores[0] - scores[2] >= 12 && scores[2] <= 75) {
    return { kind: "downward", evidence: lastThree, reason: `Three related approved results declined from ${scores[0]}% to ${scores[2]}%.` };
  }
  const weighted = lastThree.reduce((sum, item) => sum + item.score * (item.kind === "practice" ? 0.65 : 1), 0) /
    lastThree.reduce((sum, item) => sum + (item.kind === "practice" ? 0.65 : 1), 0);
  if (scores[0] <= scores[1] && scores[1] <= scores[2] && scores[2] - scores[0] >= 10 && weighted >= 82) {
    return { kind: "improving", evidence: lastThree, reason: "Three related approved results show sustained improvement." };
  }
  return { kind: "stable", evidence: lastThree, reason: "Recent related results do not cross Klio’s cautious trend threshold." };
}

function normalized(value: string) { return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " "); }
