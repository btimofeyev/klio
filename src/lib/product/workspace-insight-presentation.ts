type InsightLike = {
  studentId: string | null;
  kind: string;
  evidenceRefs: unknown[];
  actionRef?: unknown;
  createdAt?: string;
};

type AssignmentLike = {
  id: string;
  studentId: string;
  title: string;
  subject: string;
  estimatedMinutes: number | null;
  scheduledDate?: string | null;
  status?: string;
};

type StudentLike = {
  id: string;
  displayName: string;
};

type AgentTurnLike = {
  status: string;
  request: string;
  studentId: string | null;
};

type PlanningProposalLike = {
  id: string;
  studentId: string | null;
  status: string;
  summary: string;
  changes: unknown;
  targetAssignmentId: string | null;
  createdAt?: string;
  actionName?: string;
};

export type ScheduleDecisionPresentation = {
  label: string;
  title: string;
  summary: string;
  assignments: AssignmentLike[];
  request: string;
  workingTitle: string;
  workingSummary: string;
  insightCreatedAt: string | null;
};

export type ScheduleDecisionTurnState = "working" | "needs_input" | null;
export type ScheduleDecisionProposalState = {
  id: string;
  status: "proposed" | "applied";
  summary: string;
} | null;

function evidenceAssignmentId(ref: unknown) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
  const value = ref as Record<string, unknown>;
  return value.type === "assignment" && typeof value.id === "string" ? value.id : null;
}

function possessive(name: string) {
  return `${name}${name.endsWith("s") ? "’" : "’s"}`;
}

export function buildScheduleDecisionPresentation(
  insight: InsightLike,
  assignments: AssignmentLike[],
  students: StudentLike[],
): ScheduleDecisionPresentation | null {
  if (insight.kind !== "needs_detail") return null;

  const referenced = scheduleDecisionAssignments(insight, assignments);
  const studentId = insight.studentId ?? referenced[0]?.studentId;
  const affected = referenced.filter((assignment) => assignment.studentId === studentId);
  const learner = students.find((student) => student.id === studentId);
  if (!learner || !affected.length) return null;

  const learnerName = learner.displayName;
  const learnerPossessive = possessive(learnerName);
  const singular = affected.length === 1;
  const title = singular
    ? `${learnerPossessive} ${affected[0].title} needs another day`
    : `${learnerName} has ${affected.length} lessons that need another day`;
  const summary = `Klio checked the rest of the week and could not move ${singular ? "it" : "them"} without exceeding ${learnerPossessive} daily limit.`;
  const lessonNames = affected.map((assignment) => assignment.title).join("; ");
  const request = `Make room for ${learnerPossessive} remaining work this week with the smallest safe schedule change. Keep curriculum order and stay within ${learnerPossessive} daily capacity. Prepare the change for my review and do not apply anything automatically. Affected ${singular ? "lesson" : "lessons"}: ${lessonNames}.`;

  return {
    label: "Schedule needs a decision",
    title,
    summary,
    assignments: affected,
    request,
    workingTitle: singular
      ? `Klio is making room for ${learnerPossessive} lesson`
      : `Klio is making room for ${learnerPossessive} ${affected.length} lessons`,
    workingSummary: "Checking the smallest safe change. Nothing will move until a proposal is ready for your review.",
    insightCreatedAt: insight.createdAt ?? null,
  };
}

export function scheduleDecisionInsightIsScheduleQuestion(insight: InsightLike) {
  if (insight.kind !== "needs_detail") return false;
  const action = asObject(insight.actionRef);
  return action?.type === "week"
    || insight.evidenceRefs.some((ref) => evidenceAssignmentId(ref) !== null);
}

export function scheduleDecisionAssignments(insight: InsightLike, assignments: AssignmentLike[]) {
  if (!scheduleDecisionInsightIsScheduleQuestion(insight)) return [];
  const ids = new Set(insight.evidenceRefs.map(evidenceAssignmentId).filter((id): id is string => Boolean(id)));
  const action = asObject(insight.actionRef);
  const sourceDate = action?.type === "week" && typeof action.date === "string" ? action.date : null;
  return assignments.filter((assignment) => {
    if (!ids.has(assignment.id)) return false;
    if (assignment.status && !["planned", "doing"].includes(assignment.status)) return false;
    if (sourceDate && assignment.scheduledDate !== sourceDate) return false;
    return true;
  });
}

export function scheduleDecisionIsRepresentedElsewhere(
  presentation: ScheduleDecisionPresentation,
  proposals: PlanningProposalLike[],
  turns: AgentTurnLike[],
) {
  return Boolean(
    scheduleDecisionProposalState(presentation, proposals)
    || turns.some((turn) => scheduleDecisionTurnState(presentation, turn)),
  );
}

export function scheduleDecisionTurnState(
  presentation: ScheduleDecisionPresentation,
  turn: AgentTurnLike | null,
): ScheduleDecisionTurnState {
  if (!turn || !["queued", "running", "awaiting_parent"].includes(turn.status)) return null;

  const sameLearner = !turn.studentId || turn.studentId === presentation.assignments[0]?.studentId;
  if (!sameLearner) return null;

  const normalizedRequest = turn.request.trim().toLocaleLowerCase("en-US");
  const expectedRequest = presentation.request.trim().toLocaleLowerCase("en-US");
  const mentionsAffectedLesson = presentation.assignments.some((assignment) =>
    normalizedRequest.includes(assignment.title.trim().toLocaleLowerCase("en-US")),
  );
  const isScheduleHandoff = normalizedRequest === expectedRequest
    || (normalizedRequest.includes("make room") && mentionsAffectedLesson);
  if (!isScheduleHandoff) return null;

  return turn.status === "awaiting_parent" ? "needs_input" : "working";
}

export function scheduleDecisionProposalState(
  presentation: ScheduleDecisionPresentation,
  proposals: PlanningProposalLike[],
): ScheduleDecisionProposalState {
  const affectedIds = presentation.assignments.map((assignment) => assignment.id);
  const studentId = presentation.assignments[0]?.studentId;
  const matches = proposals.filter((proposal) => {
    if (!["proposed", "applied"].includes(proposal.status)) return false;
    if (proposal.studentId && proposal.studentId !== studentId) return false;
    if (presentation.insightCreatedAt && proposal.createdAt && Date.parse(proposal.createdAt) < Date.parse(presentation.insightCreatedAt)) return false;
    if (proposal.status === "proposed" && !planningProposalNeedsDecision(proposal, presentation.assignments)) return false;
    const proposalIds = planningProposalAssignmentIds(proposal);
    return affectedIds.length > 0 && affectedIds.every((id) => proposalIds.has(id));
  });
  const match = matches.find((proposal) => proposal.status === "applied") ?? matches[0];
  if (!match || (match.status !== "proposed" && match.status !== "applied")) return null;
  return { id: match.id, status: match.status, summary: match.summary };
}

export function planningProposalAssignmentIds(proposal: PlanningProposalLike) {
  const ids = new Set<string>();
  if (proposal.targetAssignmentId) ids.add(proposal.targetAssignmentId);
  if (!proposal.changes || typeof proposal.changes !== "object" || Array.isArray(proposal.changes)) return ids;
  const changes = proposal.changes as Record<string, unknown>;
  if (Array.isArray(changes.assignmentIds)) {
    for (const id of changes.assignmentIds) if (typeof id === "string") ids.add(id);
  }
  if (Array.isArray(changes.changes)) {
    for (const change of changes.changes) {
      if (change && typeof change === "object" && !Array.isArray(change) && typeof (change as Record<string, unknown>).assignmentId === "string") {
        ids.add((change as Record<string, unknown>).assignmentId as string);
      }
    }
  }
  return ids;
}

export function planningProposalNeedsDecision(
  proposal: PlanningProposalLike,
  assignments: AssignmentLike[],
) {
  if (proposal.status !== "proposed") return false;
  const actionName = proposal.actionName;
  if (!actionName || !["prepare_week", "prepare_term", "resize_schedule_work"].includes(actionName)) return true;

  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  if (actionName === "resize_schedule_work") {
    const target = proposal.targetAssignmentId ? byId.get(proposal.targetAssignmentId) : null;
    const changes = asObject(proposal.changes);
    const after = typeof changes?.after === "number" ? changes.after : null;
    return Boolean(target && after !== null && target.estimatedMinutes !== after);
  }

  const payload = asObject(proposal.changes);
  const changes = Array.isArray(payload?.changes) ? payload.changes.map(asObject).filter((change): change is Record<string, unknown> => Boolean(change)) : [];
  // Some older weekly proposals only recorded the affected assignment IDs.
  // Without a structured desired state, we cannot safely infer that the
  // proposal has already been satisfied, so keep it available for review.
  if (!changes.length) return true;
  return changes.some((change) => {
    const assignment = typeof change.assignmentId === "string" ? byId.get(change.assignmentId) : null;
    if (!assignment) return false;
    if (typeof change.scheduledDate === "string" && assignment.scheduledDate !== change.scheduledDate) return true;
    if (typeof change.estimatedMinutes === "number" && assignment.estimatedMinutes !== change.estimatedMinutes) return true;
    return false;
  });
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
