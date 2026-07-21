import { addLocalDays } from "./weekly-schedule";
import { analyzeDayLoad, effectiveAvailability, type CalendarConflict } from "@/lib/schedule/availability";
import { calculateSharedParentAvailableMinutes, findParentAttentionConflicts, resolveAttentionRequirement, type AttentionMode, type ResolvedAttentionRequirement } from "@/lib/schedule/parent-attention";

export type BriefingEvidenceRef = { type: string; id: string; [key: string]: unknown };

export type WeeklyBriefingAction = {
  kind: "review_submissions" | "resolve_capacity" | "resolve_parent_attention" | "decide_unfinished" | "review_pacing" | "review_crowded_subject" | "schedule_work";
  label: string;
  explanation: string;
  priority: number;
  target: Record<string, unknown>;
  evidenceRefs: BriefingEvidenceRef[];
};

export type WeeklyFamilyBriefingSnapshot = {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  headline: string;
  summary: string;
  previousWeek: {
    completedCount: number;
    unfinishedCount: number;
    awaitingReviewCount: number;
    byLearner?: Array<{ studentId: string; completedCount: number; unfinishedCount: number; awaitingReviewCount: number }>;
  };
  parentAttention: {
    totalMinutes: number;
    byLearner: Array<{ studentId: string; displayName: string; minutes: number }>;
    days: Array<{
      date: string;
      studentIds?: string[];
      requiredMinutes: number;
      availableMinutes: number;
      overCapacity: boolean;
      fixedConflicts: Array<{ firstAssignmentId: string; secondAssignmentId: string; startsAt: string }>;
    }>;
  };
  learners: Array<{
    studentId: string;
    displayName: string;
    plannedCount: number;
    plannedMinutes: number;
    overCapacityDays: Array<{ date: string; plannedMinutes: number; capacityMinutes: number; assignmentIds: string[] }>;
    availabilityChanges: Array<{ date: string; availableMinutes: number; blockedMinutes: number; allDayBlocked: boolean; conflictIds: string[]; titles: string[]; affectedAssignmentIds: string[] }>;
  }>;
  unscheduledWork: Array<{ assignmentId: string; studentId: string; title: string; subject: string }>;
  pacing: Array<{
    studentId: string;
    kind: "pacing_concern" | "crowded_subject" | "approved_evidence_trend";
    title: string;
    explanation: string;
    evidenceRefs: BriefingEvidenceRef[];
  }>;
  actions: WeeklyBriefingAction[];
  onTrack: boolean;
  trust: string;
};

export type WeeklyBriefingBuilderInput = {
  familyId: string;
  weekStart: string;
  generatedAt: string;
  familyLearningDays?: unknown;
  students: Array<{ familyId: string; id: string; displayName: string; dailyCapacityMinutes: number; schedulePreferences?: unknown; active: boolean }>;
  assignments: Array<{
    familyId: string;
    id: string;
    studentId: string;
    curriculumUnitId?: string | null;
    title: string;
    subject: string;
    status: string;
    scheduledDate: string | null;
    scheduledTime?: string | null;
    estimatedMinutes: number | null;
    attentionMode?: AttentionMode | string | null;
    parentAttentionMinutes?: number | null;
    curriculumAttentionMode?: AttentionMode | string | null;
    curriculumParentAttentionMinutes?: number | null;
  }>;
  conflicts?: Array<CalendarConflict & { familyId: string }>;
  submissions: Array<{ familyId: string; id: string; assignmentId: string; studentId: string; submittedAt: string; awaitingParentReview: boolean }>;
  pacingCheckpoints: Array<{ familyId: string; id: string; studentId: string; goalId: string; goalTitle: string; state: string; feasible: boolean; actualValue: number; expectedValue: number }>;
  crowdedSubjects: Array<{ familyId: string; studentId: string; subject: string; scheduledWeeklyMinutes: number; expectedWeeklyMinutes: number; shortfallMinutes: number }>;
  reviewedEvidence: Array<{ familyId: string; id: string; studentId: string; subject: string; score: number; occurredAt: string; approved: boolean; final: boolean; writtenReviewRequired: boolean; writtenReviewCompleted: boolean }>;
};

const OPEN_STATUSES = new Set(["planned", "doing"]);

export function buildWeeklyFamilyBriefing(input: WeeklyBriefingBuilderInput): WeeklyFamilyBriefingSnapshot {
  const weekEnd = addLocalDays(input.weekStart, 6);
  const previousWeekStart = addLocalDays(input.weekStart, -7);
  const previousWeekEnd = addLocalDays(input.weekStart, -1);
  const students = input.students.filter((student) => student.familyId === input.familyId && student.active);
  const studentIds = new Set(students.map((student) => student.id));
  const assignments = input.assignments.filter((assignment) => assignment.familyId === input.familyId && studentIds.has(assignment.studentId));
  const conflicts = (input.conflicts ?? []).filter((conflict) => conflict.familyId === input.familyId && inRange(conflict.conflictDate, input.weekStart, weekEnd));
  const submissions = input.submissions.filter((submission) => submission.familyId === input.familyId && studentIds.has(submission.studentId));
  const priorAssignments = assignments.filter((assignment) => inRange(assignment.scheduledDate, previousWeekStart, previousWeekEnd));
  const currentAssignments = assignments.filter((assignment) => inRange(assignment.scheduledDate, input.weekStart, weekEnd) && assignment.status !== "skipped");
  const priorAssignmentIds = new Set(priorAssignments.map((assignment) => assignment.id));
  const awaitingReviews = submissions.filter((submission) => submission.awaitingParentReview && (priorAssignmentIds.has(submission.assignmentId) || inRange(datePart(submission.submittedAt), previousWeekStart, previousWeekEnd)));
  const previousWeek = {
    completedCount: priorAssignments.filter((assignment) => assignment.status === "completed").length,
    unfinishedCount: priorAssignments.filter((assignment) => OPEN_STATUSES.has(assignment.status)).length,
    awaitingReviewCount: new Set(awaitingReviews.map((submission) => submission.id)).size,
    byLearner: students.map((student) => ({
      studentId: student.id,
      completedCount: priorAssignments.filter((assignment) => assignment.studentId === student.id && assignment.status === "completed").length,
      unfinishedCount: priorAssignments.filter((assignment) => assignment.studentId === student.id && OPEN_STATUSES.has(assignment.status)).length,
      awaitingReviewCount: new Set(awaitingReviews.filter((submission) => submission.studentId === student.id).map((submission) => submission.id)).size,
    })),
  };
  const currentAttention = currentAssignments.map((assignment) => ({
    assignment,
    requirement: resolveAttentionRequirement({
      assignmentMode: assignment.attentionMode,
      assignmentParentMinutes: assignment.parentAttentionMinutes,
      curriculumMode: assignment.curriculumAttentionMode,
      curriculumParentMinutes: assignment.curriculumParentAttentionMinutes,
      lessonMinutes: assignment.estimatedMinutes,
    }),
  }));
  const parentAttentionDays = [...groupBy(currentAttention, (item) => item.assignment.scheduledDate!).entries()]
    .map(([date, items]) => {
      const requiredMinutes = items.reduce((total, item) => total + item.requirement.parentMinutes, 0);
      const fixedConflicts = findParentAttentionConflicts(items.map((item) => ({
        id: item.assignment.id,
        studentId: item.assignment.studentId,
        scheduledStart: item.assignment.scheduledTime ?? null,
        requirement: item.requirement,
      }))).map((conflict) => ({
        firstAssignmentId: conflict.firstId,
        secondAssignmentId: conflict.secondId,
        startsAt: formatMinutes(conflict.overlap.start),
      }));
      const availableMinutes = calculateParentAvailability({ date, items, students, conflicts, familyLearningDays: input.familyLearningDays });
      const studentIds = [...new Set(items.map((item) => item.assignment.studentId))].sort();
      return { date, studentIds, requiredMinutes, availableMinutes, overCapacity: requiredMinutes > availableMinutes, fixedConflicts };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const parentAttention = {
    totalMinutes: currentAttention.reduce((total, item) => total + item.requirement.parentMinutes, 0),
    byLearner: students.map((student) => ({
      studentId: student.id,
      displayName: student.displayName,
      minutes: currentAttention.filter((item) => item.assignment.studentId === student.id).reduce((total, item) => total + item.requirement.parentMinutes, 0),
    })),
    days: parentAttentionDays,
  };

  const learners = students.map((student) => {
    const planned = currentAssignments.filter((assignment) => assignment.studentId === student.id);
    const assignmentsByDay = groupBy(planned.filter((assignment) => assignment.scheduledDate), (assignment) => assignment.scheduledDate!);
    const overCapacityDays = [...assignmentsByDay.entries()].flatMap(([date, dayAssignments]) => {
      const plannedMinutes = dayAssignments.reduce((total, assignment) => total + (assignment.estimatedMinutes ?? 0), 0);
      const availability = analyzeDayLoad({ date, studentId: student.id, dailyCapacityMinutes: student.dailyCapacityMinutes, schedulePreferences: student.schedulePreferences, familyLearningDays: input.familyLearningDays, conflicts, assignments: dayAssignments.map((assignment) => ({ id: assignment.id, studentId: assignment.studentId, scheduledDate: assignment.scheduledDate, scheduledTime: null, estimatedMinutes: assignment.estimatedMinutes, status: assignment.status })) });
      return availability.overCapacity
        ? [{ date, plannedMinutes, capacityMinutes: availability.availableMinutes, assignmentIds: dayAssignments.map((assignment) => assignment.id).sort() }]
        : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
    const availabilityChanges = [...new Set(conflicts.filter((conflict) => conflict.studentId === null || conflict.studentId === student.id).map((conflict) => conflict.conflictDate))].flatMap((date) => {
      const dayAssignments = currentAssignments.filter((assignment) => assignment.studentId === student.id && assignment.scheduledDate === date);
      const availability = analyzeDayLoad({ date, studentId: student.id, dailyCapacityMinutes: student.dailyCapacityMinutes, schedulePreferences: student.schedulePreferences, familyLearningDays: input.familyLearningDays, conflicts, assignments: dayAssignments.map((assignment) => ({ id: assignment.id, studentId: assignment.studentId, scheduledDate: assignment.scheduledDate, scheduledTime: null, estimatedMinutes: assignment.estimatedMinutes, status: assignment.status })) });
      if (!availability.allDayBlocked && availability.blockedMinutes === 0) return [];
      return [{ date, availableMinutes: availability.availableMinutes, blockedMinutes: availability.blockedMinutes, allDayBlocked: availability.allDayBlocked, conflictIds: availability.conflicts.map((conflict) => conflict.id), titles: availability.conflicts.map((conflict) => conflict.title), affectedAssignmentIds: dayAssignments.map((assignment) => assignment.id) }];
    }).sort((a, b) => a.date.localeCompare(b.date));
    return {
      studentId: student.id,
      displayName: student.displayName,
      plannedCount: planned.length,
      plannedMinutes: planned.reduce((total, assignment) => total + (assignment.estimatedMinutes ?? 0), 0),
      overCapacityDays,
      availabilityChanges,
    };
  });

  const unscheduledWork = assignments.filter((assignment) => !assignment.curriculumUnitId && !assignment.scheduledDate && OPEN_STATUSES.has(assignment.status))
    .map((assignment) => ({ assignmentId: assignment.id, studentId: assignment.studentId, title: assignment.title, subject: assignment.subject }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId) || a.subject.localeCompare(b.subject) || a.title.localeCompare(b.title));

  const pacingConcerns = input.pacingCheckpoints.filter((checkpoint) => checkpoint.familyId === input.familyId && studentIds.has(checkpoint.studentId) && (["at_risk", "blocked"].includes(checkpoint.state) || !checkpoint.feasible))
    .map((checkpoint) => ({
      studentId: checkpoint.studentId,
      kind: "pacing_concern" as const,
      title: checkpoint.state === "blocked" || !checkpoint.feasible ? `${checkpoint.goalTitle} needs a pacing decision` : `${checkpoint.goalTitle} is behind pace`,
      explanation: `Approved progress is ${checkpoint.actualValue}; the current parent-defined pace expected ${checkpoint.expectedValue}. ${checkpoint.feasible ? "The remaining target still fits the current plan." : "The remaining target does not fit the current cadence or capacity."}`,
      evidenceRefs: [{ type: "pacing_checkpoint", id: checkpoint.id, goalId: checkpoint.goalId }],
    }));
  const crowded = input.crowdedSubjects.filter((item) => item.familyId === input.familyId && studentIds.has(item.studentId) && item.shortfallMinutes > 0)
    .map((item) => ({
      studentId: item.studentId,
      kind: "crowded_subject" as const,
      title: `${item.subject} is being crowded out`,
      explanation: `${item.scheduledWeeklyMinutes} of ${item.expectedWeeklyMinutes} parent-planned minutes are scheduled this week.`,
      evidenceRefs: [] as BriefingEvidenceRef[],
    }));
  const approvedTrends = approvedEvidenceTrends(input, studentIds);
  const pacing = [...pacingConcerns, ...crowded, ...approvedTrends].sort((a, b) => a.studentId.localeCompare(b.studentId) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));

  const actionCandidates: WeeklyBriefingAction[] = [];
  if (awaitingReviews.length) actionCandidates.push({
    kind: "review_submissions", label: "Review submitted work", priority: 100,
    explanation: `${awaitingReviews.length} ${awaitingReviews.length === 1 ? "submission is" : "submissions are"} waiting for parent review. No mastery conclusion is included until review is final.`,
    target: { type: "review_queue", href: "/app/review", submissionIds: awaitingReviews.map((submission) => submission.id).sort() },
    evidenceRefs: awaitingReviews.map((submission) => ({ type: "assignment_submission", id: submission.id })),
  });
  const capacityIssues = learners.flatMap((learner) => learner.overCapacityDays.map((day) => ({ learner, day })))
    .sort((a, b) => (b.day.plannedMinutes - b.day.capacityMinutes) - (a.day.plannedMinutes - a.day.capacityMinutes) || a.day.date.localeCompare(b.day.date));
  if (capacityIssues.length) {
    const primary = capacityIssues[0];
    actionCandidates.push({
      kind: "resolve_capacity", label: capacityIssues.length === 1 ? `Lighten ${primary.learner.displayName}’s full day` : "Rebalance the fullest days", priority: 90 + Math.min(8, Math.ceil((primary.day.plannedMinutes - primary.day.capacityMinutes) / 15)),
      explanation: capacityIssues.length === 1
        ? "Klio can prepare a lighter plan for that day without changing it automatically."
        : "Klio can prepare one balanced schedule proposal for the affected days.",
      target: { type: "week", href: `/app/week?date=${primary.day.date}&student=${primary.learner.studentId}`, studentId: primary.learner.studentId, studentIds: [...new Set(capacityIssues.map((issue) => issue.learner.studentId))], date: primary.day.date, dates: [...new Set(capacityIssues.map((issue) => issue.day.date))] },
      evidenceRefs: capacityIssues.flatMap(({ day }) => day.assignmentIds.map((id) => ({ type: "assignment", id }))),
    });
  }
  const parentTimeIssues = parentAttention.days.filter((item) => item.overCapacity || item.fixedConflicts.length);
  if (parentTimeIssues.length) {
    const primary = [...parentTimeIssues].sort((a, b) => Number(b.overCapacity) - Number(a.overCapacity) || b.fixedConflicts.length - a.fixedConflicts.length || a.date.localeCompare(b.date))[0];
    actionCandidates.push({
      kind: "resolve_parent_attention",
      label: parentTimeIssues.length === 1 ? "Make one teaching day easier" : "Rebalance your teaching time",
      priority: 94 + Math.min(4, primary.fixedConflicts.length),
      explanation: "Klio can prepare a schedule proposal around your available teaching time.",
      target: { type: "week", href: `/app/week?date=${primary.date}`, date: primary.date, dates: parentTimeIssues.map((day) => day.date), studentIds: [...new Set(parentTimeIssues.flatMap((day) => day.studentIds ?? []))] },
      evidenceRefs: [...new Set(parentTimeIssues.flatMap((day) => day.fixedConflicts.flatMap((conflict) => [conflict.firstAssignmentId, conflict.secondAssignmentId])))].map((id) => ({ type: "assignment", id })),
    });
  }
  if (previousWeek.unfinishedCount) {
    const unfinished = priorAssignments.filter((assignment) => OPEN_STATUSES.has(assignment.status));
    actionCandidates.push({
      kind: "decide_unfinished", label: "Decide what to do with unfinished work", priority: 88,
      explanation: `${unfinished.length} ${unfinished.length === 1 ? "assignment remains" : "assignments remain"} open from last week.`,
      target: { type: "week", href: `/app/week?date=${input.weekStart}`, weekStart: input.weekStart, assignmentIds: unfinished.map((assignment) => assignment.id).sort() },
      evidenceRefs: unfinished.map((assignment) => ({ type: "assignment", id: assignment.id })),
    });
  }
  if (pacingConcerns.length) {
    const primary = pacingConcerns[0];
    actionCandidates.push({
      kind: "review_pacing", label: "Prepare one pacing adjustment", priority: 84,
      explanation: pacingConcerns.length === 1
        ? "Klio can prepare a smaller pacing proposal for your review."
        : "Klio can combine the affected courses into one balanced proposal for your review.",
      target: { type: "goal", href: "/app/plans", studentId: primary.studentId, studentIds: [...new Set(pacingConcerns.map((concern) => concern.studentId))], goalId: primary.evidenceRefs[0]?.goalId, goalIds: pacingConcerns.map((concern) => concern.evidenceRefs[0]?.goalId).filter(Boolean) },
      evidenceRefs: pacingConcerns.flatMap((concern) => concern.evidenceRefs),
    });
  }
  if (crowded.length) {
    const primary = crowded[0];
    actionCandidates.push({
      kind: "review_crowded_subject", label: "Make room for a crowded-out subject", priority: 78,
      explanation: crowded.length === 1
        ? "Klio can prepare a small schedule adjustment for your review."
        : "Klio can prepare one schedule adjustment across the affected subjects.",
      target: { type: "week", href: `/app/week?date=${input.weekStart}&student=${primary.studentId}`, studentId: primary.studentId, studentIds: [...new Set(crowded.map((concern) => concern.studentId))], weekStart: input.weekStart },
      evidenceRefs: crowded.flatMap((concern) => concern.evidenceRefs),
    });
  }
  if (unscheduledWork.length) actionCandidates.push({
    kind: "schedule_work", label: "Place unscheduled work", priority: 74,
    explanation: `${unscheduledWork.length} open ${unscheduledWork.length === 1 ? "assignment has" : "assignments have"} no scheduled day.`,
    target: { type: "assignments", href: "/app/assignments", assignmentIds: unscheduledWork.map((assignment) => assignment.assignmentId) },
    evidenceRefs: unscheduledWork.map((assignment) => ({ type: "assignment", id: assignment.assignmentId })),
  });
  const actions = actionCandidates.sort((a, b) => b.priority - a.priority || actionIdentity(a).localeCompare(actionIdentity(b))).slice(0, 3);
  const onTrack = !previousWeek.unfinishedCount && !previousWeek.awaitingReviewCount && !learners.some((learner) => learner.overCapacityDays.length) && !parentAttention.days.some((day) => day.overCapacity || day.fixedConflicts.length) && !pacingConcerns.length && !crowded.length && !unscheduledWork.length;
  const summary = !students.length
    ? "Add a learner when you are ready to build the family week."
    : onTrack
      ? currentAssignments.length
        ? "The week is ready. Nothing needs your decision right now."
        : "There is no work on the schedule yet. Klio can help build the week."
      : actions.length === 1
        ? "The week is organized. Klio found one thing worth a quick look."
        : "The week is organized. Klio narrowed it down to a couple of things.";
  return {
    weekStart: input.weekStart,
    weekEnd,
    generatedAt: input.generatedAt,
    headline: "Your week at a glance",
    summary,
    previousWeek,
    parentAttention,
    learners,
    unscheduledWork,
    pacing,
    actions,
    onTrack,
    trust: "Uses current family records. Grades, curriculum changes, and major schedule changes still wait for you.",
  };
}

function calculateParentAvailability(input: {
  date: string;
  items: Array<{ assignment: WeeklyBriefingBuilderInput["assignments"][number]; requirement: ResolvedAttentionRequirement }>;
  students: WeeklyBriefingBuilderInput["students"];
  conflicts: Array<CalendarConflict & { familyId: string }>;
  familyLearningDays?: unknown;
}) {
  const involved = new Set(input.items.filter((item) => item.requirement.parentMinutes > 0).map((item) => item.assignment.studentId));
  const availability = input.students.filter((student) => involved.has(student.id)).map((student) => effectiveAvailability({
    date: input.date,
    studentId: student.id,
    dailyCapacityMinutes: student.dailyCapacityMinutes,
    schedulePreferences: student.schedulePreferences,
    familyLearningDays: input.familyLearningDays,
    conflicts: input.conflicts,
  }));
  return calculateSharedParentAvailableMinutes(availability);
}

function approvedEvidenceTrends(input: WeeklyBriefingBuilderInput, studentIds: Set<string>) {
  const approved = input.reviewedEvidence.filter((item) => item.familyId === input.familyId && studentIds.has(item.studentId) && item.approved && item.final && (!item.writtenReviewRequired || item.writtenReviewCompleted));
  const grouped = groupBy(approved, (item) => `${item.studentId}\u0000${item.subject}`);
  return [...grouped.values()].flatMap((items) => {
    if (items.length < 2) return [];
    const ordered = [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    const first = ordered[0]; const last = ordered.at(-1)!;
    return [{
      studentId: first.studentId,
      kind: "approved_evidence_trend" as const,
      title: `${first.subject} has ${ordered.length} approved results`,
      explanation: `Approved scores changed from ${first.score} to ${last.score} across ${ordered.length} reviewed records. This reports the evidence without inferring mastery.`,
      evidenceRefs: ordered.map((item) => ({ type: "assignment_review", id: item.id, score: item.score })),
    }];
  });
}

function inRange(date: string | null, start: string, end: string) { return Boolean(date && date >= start && date <= end); }
function datePart(value: string) { return value.slice(0, 10); }
function actionIdentity(action: WeeklyBriefingAction) { return `${action.kind}:${String(action.target.studentId ?? "")}:${String(action.target.date ?? "")}:${action.label}`; }
function formatMinutes(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function groupBy<T>(values: T[], key: (value: T) => string) { const grouped = new Map<string, T[]>(); for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]); return grouped; }
