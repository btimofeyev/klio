import type { ArtifactDTO, EvidenceDTO, ReminderDTO, StudentDTO } from "@/lib/data/workspace";

export type DailyBriefAction =
  | { kind: "agent"; label: string; intent: "organize" | "practice" | "weekly_plan" | "summary"; prompt: string; evidenceIds: string[] }
  | { kind: "artifact"; label: string; artifactId: string }
  | { kind: "none"; label: string };

export type DailyBrief = {
  title: string;
  detail: string;
  action: DailyBriefAction;
  counts: { needsFiling: number; waitingReview: number; overdue: number };
};

export function deriveDailyBrief(input: {
  students: StudentDTO[];
  evidence: EvidenceDTO[];
  artifacts: ArtifactDTO[];
  reminders: ReminderDTO[];
  pendingApprovals: number;
  studentId: string;
  now?: Date;
}): DailyBrief {
  const now = input.now ?? new Date();
  const student = input.students.find((item) => item.id === input.studentId);
  const learner = student?.displayName ?? "your learner";
  const evidence = input.evidence.filter((item) => !item.studentIds.length || item.studentIds.includes(input.studentId));
  const unfiled = evidence.filter((item) => item.status === "needs_review" || (item.status === "ready" && !item.categories.length));
  const overdue = input.reminders.filter((item) => item.status === "pending" && item.dueAt && new Date(item.dueAt) < now);
  const draft = input.artifacts.find((item) => item.studentId === input.studentId && item.status === "draft");
  const counts = { needsFiling: new Set(unfiled.map((item) => item.captureSubmissionId ?? item.id)).size, waitingReview: input.pendingApprovals, overdue: overdue.length };

  if (unfiled.length) {
    const submissionCount = counts.needsFiling;
    return {
      title: `${submissionCount} new ${submissionCount === 1 ? "capture needs" : "captures need"} organizing`,
      detail: `Klio can file the clear items for ${learner} and ask one question only where the subject or student is uncertain.`,
      action: {
        kind: "agent",
        label: "Organize now",
        intent: "organize",
        prompt: `Organize these new captures for ${learner}. File what is clear and ask me one concise question only if something is genuinely uncertain.`,
        evidenceIds: unfiled.slice(0, 20).map((item) => item.id),
      },
      counts,
    };
  }

  if (draft && input.pendingApprovals > 0) {
    return {
      title: `${draft.title} is ready for you`,
      detail: `Klio finished the draft. Review it once, then it can become part of ${learner}’s approved family record.`,
      action: { kind: "artifact", label: "Review the draft", artifactId: draft.id },
      counts,
    };
  }

  if (overdue.length) {
    return {
      title: `${overdue.length} ${overdue.length === 1 ? "reminder is" : "reminders are"} overdue`,
      detail: `The oldest is “${overdue[0].title}.” Complete or edit it so Klio’s view of the week stays current.`,
      action: { kind: "none", label: "Reminder shown below" },
      counts,
    };
  }

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recent = evidence.filter((item) => new Date(item.createdAt) >= weekAgo && item.categories.length > 0).slice(0, 8);
  const recentPractice = input.artifacts.some((item) => item.studentId === input.studentId && item.type === "practice" && new Date(item.createdAt) >= weekAgo);
  if (recent.length && !recentPractice) {
    const subjects = [...new Set(recent.flatMap((item) => item.categories.map((category) => category.name)))].slice(0, 2);
    return {
      title: `${learner} has recent work ready to build on`,
      detail: `Klio can turn the ${subjects.join(" and ") || "recent"} evidence into a short practice activity grounded in what was actually captured.`,
      action: { kind: "agent", label: "Make practice", intent: "practice", prompt: `Create a short, safe practice activity for ${learner} from this week’s filed learning evidence.`, evidenceIds: recent.map((item) => item.id) },
      counts,
    };
  }

  const hasCurrentPlan = input.artifacts.some((item) => item.studentId === input.studentId && item.type === "weekly_plan" && new Date(item.createdAt) >= weekAgo);
  if (!hasCurrentPlan) {
    return {
      title: `Next week is not planned yet`,
      detail: `Klio can draft a realistic plan for ${learner} from current records, reminders, and unfinished work.`,
      action: { kind: "agent", label: "Plan next week", intent: "weekly_plan", prompt: `Draft next week’s plan for ${learner} from current learning records, reminders, and unfinished work. Flag only decisions I genuinely need to make.`, evidenceIds: [] },
      counts,
    };
  }

  return {
    title: `Klio is caught up for now`,
    detail: `${learner}’s recent captures are organized and there is no urgent parent action in the current workspace.`,
    action: { kind: "agent", label: "Refresh the dashboard", intent: "summary", prompt: `Refresh ${learner}’s family learning dashboard from the current approved records and reminders.`, evidenceIds: [] },
    counts,
  };
}
