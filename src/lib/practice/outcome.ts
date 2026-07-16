export type PracticeOutcome = {
  kind: "understood" | "needs_support" | "checking";
  title: string;
  summary: string;
  feedback: string;
  priority: number;
};

export function buildPracticeOutcome(input: {
  learnerName: string;
  subject: string;
  skillKey: string;
  score: number;
  masteryMet: boolean;
  reviewNeeded: boolean;
}): PracticeOutcome {
  const skill = stripSubject(readableSkill(input.skillKey), input.subject);
  if (input.reviewNeeded) {
    return {
      kind: "checking",
      title: `Klio is checking ${input.learnerName}’s explanation`,
      summary: `${input.subject} · ${skill}. The objective responses are saved; the written explanation still needs a grounded check.`,
      feedback: "Your work is saved. Klio is checking the explanation before deciding what comes next.",
      priority: 82,
    };
  }
  if (input.masteryMet) {
    return {
      kind: "understood",
      title: `${input.learnerName} showed good understanding`,
      summary: `${input.subject} · ${skill}. ${input.score}% on the focused practice. Regular lessons stay as planned.`,
      feedback: "You showed good understanding. You can return to your regular lesson plan.",
      priority: 94,
    };
  }
  return {
    kind: "needs_support",
    title: `${input.learnerName} still needs support with ${skill}`,
    summary: `${input.score}% on the focused ${input.subject} practice. Klio kept regular curriculum in place and has two short next steps ready.`,
    feedback: "Thanks for finishing. Klio found a few places that still need practice and will help choose the next step.",
    priority: 88,
  };
}

export function readableSkill(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripSubject(skill: string, subject: string) {
  const words = skill.split(" ");
  return words[0]?.toLocaleLowerCase("en-US") === subject.trim().toLocaleLowerCase("en-US") ? words.slice(1).join(" ") || skill : skill;
}
