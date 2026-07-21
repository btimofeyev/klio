"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, ClipboardCheck, Clock3, Ellipsis, FileCheck2, FileUp, GripVertical, LoaderCircle, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { InboxWorkspace } from "@/components/inbox-workspace";
import { SpatialWorkspace, type SpatialCameraState, type SpatialWorkspaceItem } from "@/components/spatial-workspace";
import { isBriefingTurn, WeeklyFamilyBriefing, weeklyBriefingShouldRender } from "@/components/weekly-family-briefing";
import type { AdjustmentDTO, AssignmentDTO, AssignmentReviewDTO, CalendarConflictDTO, CurriculumUnitDTO, PlanningProposalDTO, PracticeSessionDTO, SubmissionDTO } from "@/lib/data/operations";
import type { AgentConversationDTO, AgentTurnDTO, ArtifactDTO, CategoryDTO, EvidenceDTO, KlioInsightDTO, ReminderDTO, StudentDTO, WeeklyBriefingDTO, WeeklyBriefingState, WorkspaceLayoutDTO } from "@/lib/data/workspace";
import { reorderDayIds } from "@/lib/schedule/day-order";
import { normalizePracticeSpec } from "@/lib/practice/spec";
import { estimatedPracticeMinutes } from "@/lib/practice/presentation";
import { practicePreviewStyles } from "@/components/practice-preview";
import { reviewEntityAction } from "@/app/app/actions";
import { PracticePlayer, type PracticePlayerResult } from "@/components/practice-player";
import { learnerWeekdays, learningWeekDates } from "@/lib/assignments/dates";
import { CalendarConflictEditor, type ConflictAffectedWork } from "@/components/calendar/calendar-conflict-editor";
import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import { effectiveAvailability } from "@/lib/schedule/availability";
import { monthLabel, shiftMonth } from "@/lib/calendar/month";
import { ParentSupportControl, ParentSupportLabel } from "@/components/parent-support-control";
import { findParentAttentionConflicts } from "@/lib/schedule/parent-attention";
import { buildScheduleDecisionPresentation, planningProposalNeedsDecision, scheduleDecisionProposalState, scheduleDecisionTurnState } from "@/lib/product/workspace-insight-presentation";
import { dedupeAssignmentsById } from "@/lib/data/operation-assignment-pages";
import type { CurriculumResearchResult } from "@/lib/curriculum/curriculum-research";

type Surface = "today" | "week" | "assignments" | "review" | "adjustments";
type PracticeDismissalReason = "learned_in_curriculum" | "already_understands" | "not_right_fit";
type Workspace = {
  family: { id: string; name: string; timezone: string; available_days: unknown };
  students: StudentDTO[];
  evidence: EvidenceDTO[];
  categories: CategoryDTO[];
  reminders: ReminderDTO[];
  artifacts: ArtifactDTO[];
  latestAgentTurn: AgentTurnDTO | null;
  latestAgentConversation: AgentConversationDTO | null;
  pendingApprovals: number;
  currentDate: string;
  curriculumUnits: CurriculumUnitDTO[];
  assignments: AssignmentDTO[];
  submissions: SubmissionDTO[];
  assignmentReviews: AssignmentReviewDTO[];
  adjustments: AdjustmentDTO[];
  planningProposals: PlanningProposalDTO[];
  insights: KlioInsightDTO[];
  workspaceLayouts: WorkspaceLayoutDTO[];
  practiceSessions: PracticeSessionDTO[];
  weeklyBriefing: WeeklyBriefingDTO | null;
  weeklyBriefingState: WeeklyBriefingState;
  calendarConflicts: CalendarConflictDTO[];
  selectedDate: string;
  selectedStudentId: string | null;
  selectedCurriculumUnitId: string | null;
  calendarMode: "week" | "month" | null;
  assignmentPage: { curriculumUnitId: string | null; nextCursor: string | null } | null;
};

export function OperationsWorkspace({ surface, workspace, initialSelectedDate, initialStudentId, initialArtifactId, initialPracticeSessionId, initialCalendarMode = "week" }: { surface: Surface; workspace: Workspace; initialSelectedDate?: string; initialStudentId?: string; initialArtifactId?: string; initialPracticeSessionId?: string; initialCalendarMode?: "week" | "month" }) {
  const router = useRouter();
  const defaultsToFamily = workspace.students.length > 1;
  const [studentId, setStudentId] = useState(defaultsToFamily ? (initialStudentId ?? "all") : (initialStudentId ?? workspace.students[0]?.id ?? ""));
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate ?? initialDate(workspace.assignments, studentId, workspace.currentDate));
  const [navigationPending, startNavigation] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const calendarMode = workspace.calendarMode ?? initialCalendarMode;
  const [conflictOverrides, setConflictOverrides] = useState<CalendarConflictDTO[]>([]);
  const [deletedConflictIds, setDeletedConflictIds] = useState<string[]>([]);
  const [conflictEditor, setConflictEditor] = useState<{ date: string; conflict: CalendarConflictDTO | null; trigger: HTMLElement | null } | null>(null);
  const [conflictAffected, setConflictAffected] = useState<{ conflict: CalendarConflictDTO; work: ConflictAffectedWork } | null>(null);
  const [showCurriculum, setShowCurriculum] = useState(false);
  const [submissionAssignment, setSubmissionAssignment] = useState<AssignmentDTO | null>(null);
  const [captureAssignment, setCaptureAssignment] = useState<AssignmentDTO | null>(null);
  const [optimisticInsights, setOptimisticInsights] = useState<KlioInsightDTO[]>([]);
  const [dismissedInsightKeys, setDismissedInsightKeys] = useState<string[]>([]);
  const [resolvedProposalIds, setResolvedProposalIds] = useState<string[]>([]);
  const [acknowledgedProposalIds, setAcknowledgedProposalIds] = useState<string[]>([]);
  const [practiceSessionOverrides, setPracticeSessionOverrides] = useState<PracticeSessionDTO[]>([]);
  const [completedPracticeSessionIds, setCompletedPracticeSessionIds] = useState<string[]>([]);
  const [dismissedPracticeSessionIds, setDismissedPracticeSessionIds] = useState<string[]>([]);
  const [assistantPrefill, setAssistantPrefill] = useState<{ key: number; request: string } | null>(null);
  const [liveAgentTurn, setLiveAgentTurn] = useState<AgentTurnDTO | null>(workspace.latestAgentTurn);
  const [assignmentAttentionOverrides, setAssignmentAttentionOverrides] = useState<Record<string, Partial<AssignmentDTO>>>({});
  const [locallyDismissedBriefingId, setLocallyDismissedBriefingId] = useState<string | null>(null);
  const [activePracticeSessionId, setActivePracticeSessionId] = useState<string | null>(() => initialPracticeSessionId ?? (initialArtifactId
    ? workspace.practiceSessions.find((session) => session.artifactId === initialArtifactId && ["ready", "in_progress"].includes(session.status))?.id ?? null
    : null));
  const autoOpeningArtifactRef = useRef<string | null>(activePracticeSessionId && initialArtifactId ? initialArtifactId : null);
  const practiceSessions = useMemo(() => [...practiceSessionOverrides, ...workspace.practiceSessions.filter((item) => !practiceSessionOverrides.some((override) => override.id === item.id))]
    .map((item) => completedPracticeSessionIds.includes(item.id) ? { ...item, status: "completed" } : dismissedPracticeSessionIds.includes(item.id) ? { ...item, status: "dismissed" } : item), [completedPracticeSessionIds, dismissedPracticeSessionIds, practiceSessionOverrides, workspace.practiceSessions]);
  const activePracticeSession = practiceSessions.find((item) => item.id === activePracticeSessionId) ?? null;
  const calendarConflicts = [...conflictOverrides, ...workspace.calendarConflicts.filter((item) => !conflictOverrides.some((override) => override.id === item.id))].filter((item) => !deletedConflictIds.includes(item.id));
  const liveInsights = [...optimisticInsights, ...workspace.insights.filter((item) => !optimisticInsights.some((optimistic) => optimistic.id === item.id))]
    .filter((insight, index, all) => all.findIndex((candidate) => insightGroupKey(candidate) === insightGroupKey(insight)) === index)
    .filter((insight) => !dismissedInsightKeys.includes(insightGroupKey(insight)))
    .filter((insight) => typeof insight.actionRef.proposalId !== "string" || (!resolvedProposalIds.includes(insight.actionRef.proposalId) && !acknowledgedProposalIds.includes(insight.actionRef.proposalId)));
  const selectedLearner = workspace.students.find((student) => student.id === studentId);
  const learner = selectedLearner ?? workspace.students[0];
  const liveAssignments = workspace.assignments.map((item) => ({ ...item, ...(assignmentAttentionOverrides[item.id] ?? {}) }));
  const visiblePlanningProposals = workspace.planningProposals.filter((proposal) => proposal.status !== "proposed" || planningProposalNeedsDecision(proposal, liveAssignments));
  const assignments = studentId === "all" ? liveAssignments : liveAssignments.filter((item) => item.studentId === studentId);
  const enabledWeekdays = useMemo(() => {
    if (selectedLearner) return learnerWeekdays(selectedLearner.schedulePreferences, workspace.family.available_days);
    return [...new Set(workspace.students.flatMap((student) => learnerWeekdays(student.schedulePreferences, workspace.family.available_days)))].sort();
  }, [selectedLearner, workspace.family.available_days, workspace.students]);
  const days = useMemo(() => learningWeekDates(selectedDate, enabledWeekdays), [enabledWeekdays, selectedDate]);
  const pendingReviews = workspace.assignmentReviews.filter((review) => review.status === "draft" && assignments.some((item) => item.id === review.assignmentId));
  const proposals = workspace.adjustments.filter((proposal) => studentId === "all" || proposal.studentId === studentId);
  // Completed conversations belong in the explicit conversation picker. Restoring
  // one as modal state here makes every workspace remount (day, learner, or lesson
  // changes) look like the user asked to reopen chat.
  const deskTurn = liveAgentTurn && !isBriefingTurn(liveAgentTurn) && ["queued", "running", "awaiting_parent", "failed"].includes(liveAgentTurn.status)
    ? liveAgentTurn
    : null;
  useEffect(() => {
    if (!activePracticeSessionId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setActivePracticeSessionId(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [activePracticeSessionId]);

  const openPractice = useCallback(async (input: { sessionId?: string; artifactId?: string }) => {
    const existing = input.sessionId ? practiceSessions.find((item) => item.id === input.sessionId && ["ready", "in_progress"].includes(item.status)) : null;
    if (existing) return setActivePracticeSessionId(existing.id);
    if (!input.artifactId) return setNotice("This practice is no longer available.");
    setBusy(input.artifactId); setNotice(null);
    const response = await fetch("/api/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactId: input.artifactId }) });
    const data = await response.json() as { session?: PracticeSessionDTO; error?: string };
    setBusy(null);
    if (!response.ok || !data.session) return setNotice(data.error ?? "Klio could not open this practice.");
    setPracticeSessionOverrides((current) => [data.session!, ...current.filter((item) => item.id !== data.session!.id)]);
    setActivePracticeSessionId(data.session.id);
  }, [practiceSessions]);

  const captureWorkspace = <InboxWorkspace key={`capture-${studentId}`} familyId={workspace.family.id} students={workspace.students} categories={workspace.categories} initialEvidence={workspace.evidence} initialReminders={workspace.reminders} initialArtifacts={workspace.artifacts} pendingApprovals={workspace.pendingApprovals} initialAgentTurn={deskTurn} initialAgentConversation={workspace.latestAgentConversation} initialStudentId={selectedLearner?.id ?? ""} workspaceDate={selectedDate} assignmentContext={captureAssignment ? { id: captureAssignment.id, studentId: captureAssignment.studentId, title: captureAssignment.title, subject: captureAssignment.subject } : null} onAssignmentDrop={(assignmentId) => setCaptureAssignment(workspace.assignments.find((item) => item.id === assignmentId) ?? null)} onAssignmentContextClear={() => setCaptureAssignment(null)} onPracticeOpen={(artifactId) => void openPractice({ artifactId })} onAgentTurnChange={setLiveAgentTurn} assistantPrefill={assistantPrefill} compact dashboard />;
  const briefingIsVisible = weeklyBriefingShouldRender(workspace.weeklyBriefing, workspace.weeklyBriefingState)
    && workspace.weeklyBriefing?.id !== locallyDismissedBriefingId;
  const briefingSurface = briefingIsVisible ? <WeeklyFamilyBriefing briefing={workspace.weeklyBriefing} state={workspace.weeklyBriefingState} familyId={workspace.family.id} students={workspace.students} selectedStudentId={studentId} familyTimezone={workspace.family.timezone} planningProposals={visiblePlanningProposals} activeAgentTurn={isBriefingTurn(liveAgentTurn) ? liveAgentTurn : null} onDismissed={() => setLocallyDismissedBriefingId(workspace.weeklyBriefing?.id ?? null)} /> : null;

  function savedConflict(conflict: CalendarConflictDTO, work: ConflictAffectedWork, mode: "created" | "updated") {
    setConflictOverrides((current) => [conflict, ...current.filter((item) => item.id !== conflict.id)]);
    setConflictAffected({ conflict, work });
    setConflictEditor(null);
    setNotice(`${conflict.title} ${mode === "created" ? "was added" : "was updated"}. Existing lessons stayed where they were.`);
  }

  function deletedConflict(id: string) {
    setDeletedConflictIds((current) => current.includes(id) ? current : [...current, id]);
    setConflictOverrides((current) => current.filter((item) => item.id !== id));
    setConflictEditor(null); setConflictAffected(null); setNotice("The conflict was deleted.");
  }

  function askKlioToReorganize() {
    if (!conflictAffected) return;
    const { conflict, work } = conflictAffected;
    const learnerNames = work.affectedLearnerNames.length ? formatNames(work.affectedLearnerNames) : conflict.studentId ? workspace.students.find((student) => student.id === conflict.studentId)?.displayName ?? "this learner" : "the family";
    const time = conflict.allDay ? "all day" : `from ${formatTime(conflict.startsAt!)}–${formatTime(conflict.endsAt!)}`;
    const lessonDetail = work.directOverlapCount ? `${work.directOverlapCount} timed ${work.directOverlapCount === 1 ? "lesson is" : "lessons are"} affected${work.affectedLessonNames.length ? `: ${work.affectedLessonNames.join(", ")}` : ""}.` : work.overCapacity ? "The day is over its available teaching time." : "No timed lesson directly overlaps.";
    setAssistantPrefill((current) => ({ key: (current?.key ?? 0) + 1, request: `Reorganize ${learnerNames}’s schedule around ${conflict.title} on ${longDate(conflict.conflictDate)} ${time}. ${lessonDetail} Preserve curriculum order and keep each day within available teaching time.` }));
  }

  useEffect(() => {
    if (!initialArtifactId) { autoOpeningArtifactRef.current = null; return; }
    if (activePracticeSessionId || autoOpeningArtifactRef.current === initialArtifactId) return;
    const artifact = workspace.artifacts.find((item) => item.id === initialArtifactId && item.type === "practice" && item.status === "approved");
    if (!artifact) return;
    autoOpeningArtifactRef.current = initialArtifactId;
    const launch = window.setTimeout(() => void openPractice({ artifactId: initialArtifactId }), 0);
    return () => window.clearTimeout(launch);
  }, [activePracticeSessionId, initialArtifactId, openPractice, workspace.artifacts]);

  function practiceCompleted(sessionId: string, result: PracticePlayerResult) {
    setCompletedPracticeSessionIds((current) => current.includes(sessionId) ? current : [...current, sessionId]);
    const artifactId = practiceSessions.find((session) => session.id === sessionId)?.artifactId;
    const replacedKeys = [...optimisticInsights, ...workspace.insights].filter((insight) => insight.actionRef.practiceSessionId === sessionId || (artifactId && insight.actionRef.artifactId === artifactId)).map(insightGroupKey);
    setDismissedInsightKeys((current) => [...new Set([...current, ...replacedKeys])]);
    const parentUpdate = result.parentUpdate;
    if (isKlioInsight(parentUpdate)) setOptimisticInsights((current) => [parentUpdate, ...current.filter((item) => item.id !== parentUpdate.id)]);
    router.refresh();
  }

  async function dismissPractice(session: PracticeSessionDTO, reason: PracticeDismissalReason) {
    setBusy(session.id); setNotice(null);
    try {
      const response = await fetch(`/api/practice/${session.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dismiss", reason }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) return setNotice(result.error ?? "Klio could not remove this practice. It is still available.");
      setDismissedPracticeSessionIds((current) => current.includes(session.id) ? current : [...current, session.id]);
      const replacedKeys = [...optimisticInsights, ...workspace.insights]
        .filter((insight) => insight.actionRef.practiceSessionId === session.id || (session.artifactId && insight.actionRef.artifactId === session.artifactId))
        .map(insightGroupKey);
      setDismissedInsightKeys((current) => [...new Set([...current, ...replacedKeys])]);
      setNotice(reason === "learned_in_curriculum"
        ? "Removed. Klio will treat the curriculum work as the better signal and adjust future practice."
        : reason === "already_understands"
          ? "Removed. Klio will remember that this support was no longer needed."
          : "Removed. Klio will avoid repeating this kind of practice without stronger evidence.");
      router.refresh();
    } catch {
      setNotice("Klio lost the connection before the practice was removed. It is still available.");
    } finally {
      setBusy(null);
    }
  }

  async function practiceFollowUp(insight: KlioInsightDTO, action: "extend_time" | "create_more_practice") {
    const practiceSessionId = typeof insight.actionRef.practiceSessionId === "string" ? insight.actionRef.practiceSessionId : null;
    if (!practiceSessionId) return;
    setBusy(insight.id); setNotice(null);
    try {
      const response = await fetch(`/api/practice/${practiceSessionId}/follow-up`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, idempotencyKey: `${action}:${practiceSessionId}` }) });
      const data = await response.json().catch(() => ({})) as { session?: PracticeSessionDTO; dueDate?: string; error?: string };
      if (!response.ok) return setNotice(data.error ?? "Klio could not prepare that next step. Your practice result is safe—try again.");
      setDismissedInsightKeys((current) => current.includes(insightGroupKey(insight)) ? current : [...current, insightGroupKey(insight)]);
      if (action === "create_more_practice" && data.session) {
        setPracticeSessionOverrides((current) => [data.session!, ...current.filter((item) => item.id !== data.session!.id)]);
        setActivePracticeSessionId(data.session.id);
      } else {
        setNotice(`Klio kept 10 extra minutes open on ${data.dueDate ? longDate(data.dueDate) : "the next learning day"}.`);
      }
      router.refresh();
    } catch {
      setNotice("Klio lost the connection before the follow-up was saved. Your practice result is safe—try again.");
    } finally {
      setBusy(null);
    }
  }

  async function updateAssignment(assignment: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") {
    setBusy(assignment.id); setNotice(null);
    const response = await fetch(`/api/assignments/${assignment.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) { setNotice(result.error ?? "Klio could not update that assignment."); return false; }
    setNotice(status === "completed" ? `${assignment.title} is done. Klio recorded it and is checking the follow-through.` : `${assignment.title} updated.`);
    router.refresh();
    return true;
  }

  function attentionSaved(assignmentId: string, value: Partial<AssignmentDTO>) {
    setAssignmentAttentionOverrides((current) => ({ ...current, [assignmentId]: { ...(current[assignmentId] ?? {}), ...value } }));
  }

  async function moveAssignment(assignmentId: string, scheduledDate: string) {
    const assignment = workspace.assignments.find((item) => item.id === assignmentId);
    if (!assignment || assignment.scheduledDate === scheduledDate) return;
    setBusy(assignmentId); setNotice(null);
    const response = await fetch(`/api/assignments/${assignmentId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledDate }) });
    const result = await response.json(); setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not move that lesson.");
    setNotice(`${assignment.title} moved to ${longDate(scheduledDate)}.`); router.refresh();
  }

  async function reorderAssignments(orderedIds: string[], movedId: string) {
    const assignment = workspace.assignments.find((item) => item.id === movedId);
    if (!assignment?.scheduledDate) return;
    setBusy(movedId); setNotice(null);
    const response = await fetch("/api/assignments/reorder", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyId: workspace.family.id, scheduledDate: assignment.scheduledDate, scopeStudentId: studentId === "all" ? null : studentId, movedId, orderedIds }),
    });
    const result = await response.json(); setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not reorder today’s lessons.");
    setNotice("Today’s lesson order was updated.");
    router.refresh();
  }

  async function proposeAdjustments(items: AssignmentDTO[]) {
    const [first] = items;
    if (!first) return;
    setBusy(first.id); setNotice(null);
    const response = await fetch("/api/adjustments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId: workspace.family.id, studentId: first.studentId, idempotencyKey: `unfinished:${crypto.randomUUID()}`, ...(items.length === 1 ? { assignmentId: first.id } : { assignmentIds: items.map((item) => item.id) }) }) });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not adjust the week.");
    setNotice(result.applied
      ? `Klio moved ${items.length === 1 ? first.title : `${items.length} unfinished lessons`} and kept curriculum order. You can undo the change from Klio’s note.`
      : "Klio prepared the safest schedule change and left it ready for your approval.");
    router.refresh();
    if (result.insight) window.setTimeout(() => setOptimisticInsights((current) => [result.insight as KlioInsightDTO, ...current.filter((item) => item.id !== result.insight.id)]), 0);
  }

  async function decideAdjustment(proposal: AdjustmentDTO, decision: "approve" | "reject" | "undo") {
    setBusy(proposal.id); setNotice(null);
    const response = await fetch(`/api/adjustments/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not apply that change.");
    if (decision === "undo" || decision === "reject") {
      setOptimisticInsights((current) => current.filter((insight) => insight.actionRef.proposalId !== proposal.id));
      setResolvedProposalIds((current) => current.includes(proposal.id) ? current : [...current, proposal.id]);
    }
    setNotice(decision === "approve" ? "The week has been updated." : decision === "undo" ? "The earlier change was undone safely." : "The proposed change was declined.");
    router.refresh();
  }

  async function acknowledgeAdjustment(proposal: AdjustmentDTO) {
    const optimisticIds = workspace.adjustments
      .filter((item) => item.status === "applied" && !item.acknowledgedAt && item.createdAt <= proposal.createdAt)
      .map((item) => item.id);
    setAcknowledgedProposalIds((current) => [...new Set([...current, ...optimisticIds])]);
    const response = await fetch(`/api/adjustments/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "acknowledge" }) });
    const result = await response.json() as { acknowledgedCount?: number; error?: string };
    if (!response.ok) {
      setAcknowledgedProposalIds((current) => current.filter((id) => !optimisticIds.includes(id)));
      setNotice(result.error ?? "Klio could not clear that update.");
      return false;
    }
    setOptimisticInsights((current) => current.filter((insight) => {
      const proposalId = typeof insight.actionRef.proposalId === "string" ? insight.actionRef.proposalId : null;
      return !proposalId || !optimisticIds.includes(proposalId);
    }));
    setNotice((result.acknowledgedCount ?? 0) > 1 ? "Acknowledged. Older completed schedule updates were cleared too." : "Acknowledged.");
    router.refresh();
    return true;
  }

  async function approveReview(review: AssignmentReviewDTO) {
    setBusy(review.id); setNotice(null);
    const response = await fetch(`/api/assignment-reviews/${review.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", score: review.draftScore, scoreLabel: review.scoreLabel, feedback: review.draftFeedback ?? "", rubric: reviewRubric(review.rubric), masterySignals: reviewMasterySignals(review.masterySignals) }) });
    const result = await response.json(); setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not save that review.");
    setNotice("Klio’s review was approved and added to the learning record."); router.refresh();
  }

  async function dismissInsight(insight: KlioInsightDTO) {
    const key = insightGroupKey(insight);
    setDismissedInsightKeys((current) => current.includes(key) ? current : [...current, key]);
    const response = await fetch(`/api/insights/${insight.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setDismissedInsightKeys((current) => current.filter((item) => item !== key));
      setNotice(result?.error ?? "Klio could not dismiss that update.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function buildWeek(anchorDate = selectedDate) {
    setBusy("build-week"); setNotice(null);
    const response = await fetch("/api/week-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyId: workspace.family.id, anchorDate }),
    });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) {
      return setNotice(result.error ?? "Klio could not build the week.");
    }
    setSelectedDate(result.weekStart);
    const names = formatNames(result.learners.map((item: { displayName: string }) => item.displayName));
    const adjusted = result.learners.some((item: { adjustedMinutes: number | null }) => item.adjustedMinutes !== null && item.adjustedMinutes < 40);
    const setupNames = formatNames(result.needsSetup.map((item: { displayName: string }) => item.displayName));
    const subjectLabel = `${result.subjectCount} ${result.subjectCount === 1 ? "subject" : "subjects"}`;
    const planned = result.assignmentCount > 0
      ? workspace.students.length > 1
        ? `Klio planned the family week for ${names}: ${subjectLabel} across ${result.totalAssignmentCount} lessons.`
        : `Klio planned ${names}’s week: ${subjectLabel} across ${result.totalAssignmentCount} lessons.`
      : `The week is already planned for ${names}.`;
    setNotice(`${planned}${adjusted ? " Lesson lengths were adjusted to fit each learner’s available time." : ""}${setupNames ? ` ${setupNames} still need subjects set up.` : ""}`);
    navigate(scheduleViewHref("week", result.weekStart, studentId));
  }

  function chooseLearner(id: string) {
    setStudentId(id);
    if (id !== "all") document.cookie = `klio-learner=${encodeURIComponent(id)}; Path=/app; Max-Age=31536000; SameSite=Lax`;
    if (surface === "today") return navigate(scheduleViewHref("today", selectedDate, id));
    if (surface === "week") return navigate(scheduleViewHref(calendarMode, selectedDate, id));
    if (surface === "assignments") {
      const currentUnit = workspace.curriculumUnits.find((unit) => unit.id === workspace.selectedCurriculumUnitId);
      const unitId = id === "all" || currentUnit?.studentId === id ? currentUnit?.id ?? null : null;
      return navigate(assignmentsViewHref(id, unitId));
    }
    setSelectedDate(initialDate(workspace.assignments, id, workspace.currentDate));
  }

  function navigate(href: string) {
    startNavigation(() => router.push(href));
  }

  return <div className="ops-workspace">
    {surface !== "today" && surface !== "week" ? <header className="ops-header">
      <div><span>{surfaceLabel(surface)}</span><h1>{surfaceTitle(surface, learner?.displayName ?? "Your learner")}</h1><p>{surfaceDescription(surface)}</p></div>
      <label><span>View</span><select value={studentId} onChange={(event) => chooseLearner(event.target.value)}>{workspace.students.length > 1 ? <option value="all">Family</option> : null}{workspace.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
    </header> : null}
    {notice ? <p className="ops-notice" role="status"><Sparkles size={14} />{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={13} /></button></p> : null}
    {conflictAffected && (conflictAffected.work.directOverlapCount > 0 || conflictAffected.work.overCapacity) ? <div className="conflict-affected-notice" role="status"><div><strong>{conflictAffected.work.directOverlapCount ? `${conflictAffected.work.directOverlapCount} timed ${conflictAffected.work.directOverlapCount === 1 ? "lesson overlaps" : "lessons overlap"}` : "The day is over available time"}</strong><span>{conflictAffected.work.affectedLearnerNames.length ? formatNames(conflictAffected.work.affectedLearnerNames) : "Teaching availability changed"}{conflictAffected.work.overCapacity ? " · over capacity" : ""}</span></div><button type="button" onClick={askKlioToReorganize}>Ask Klio to reorganize</button><button type="button" onClick={() => setConflictAffected(null)} aria-label="Dismiss affected work notice"><X size={13} /></button></div> : null}

    {surface === "today" ? <DaySurface key={`${studentId}-${selectedDate}`}
      assignments={assignments}
      scopeId={studentId}
      currentDate={workspace.currentDate}
      selectedDate={selectedDate}
      setSelectedDate={setSelectedDate}
      navigateDate={(date) => navigate(scheduleViewHref("today", date, studentId))}
      navigationPending={navigationPending}
      learner={learner}
      students={workspace.students}
      chooseLearner={chooseLearner}
      reminders={workspace.reminders.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
      reviews={pendingReviews}
      approvedReviews={workspace.assignmentReviews.filter((review) => review.status === "approved")}
      submissions={workspace.submissions}
      evidence={workspace.evidence}
      proposals={proposals}
      planningProposals={visiblePlanningProposals}
      acknowledgedProposalIds={acknowledgedProposalIds}
      artifacts={workspace.artifacts.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
      practiceSessions={practiceSessions.filter((item) => studentId === "all" || item.studentId === studentId)}
      insights={liveInsights.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
      activeAgentTurn={liveAgentTurn}
      busy={busy}
      onUpdate={updateAssignment}
      onReorder={(orderedIds, movedId) => void reorderAssignments(orderedIds, movedId)}
      onSubmit={setCaptureAssignment}
      onAdjust={(item) => void proposeAdjustments([item])}
      onAdjustAll={(items) => void proposeAdjustments(items)}
      onDecide={(proposal, decision) => void decideAdjustment(proposal, decision)}
      onAcknowledge={acknowledgeAdjustment}
      onDismissInsight={dismissInsight}
      onStartPractice={(input) => void openPractice(input)}
      onDismissPractice={(session, reason) => void dismissPractice(session, reason)}
      onPracticeFollowUp={(insight, action) => void practiceFollowUp(insight, action)}
      onApproveReview={(review) => void approveReview(review)}
      onAttentionSaved={attentionSaved}
      onAskKlio={(request) => setAssistantPrefill((current) => ({ key: (current?.key ?? 0) + 1, request }))}
      familyId={workspace.family.id}
      initialArtifactId={initialArtifactId}
      workspaceLayouts={workspace.workspaceLayouts}
      briefing={briefingSurface}
      capture={captureWorkspace}
    /> : null}
    {surface === "week" ? <WeekSurface
      familyId={workspace.family.id} familyLearningDays={workspace.family.available_days} workspaceLayouts={workspace.workspaceLayouts}
      scopeId={studentId} mode={calendarMode} assignments={assignments}
      conflicts={calendarConflicts.filter((conflict) => studentId === "all" || conflict.studentId === null || conflict.studentId === studentId)}
      curricula={workspace.curriculumUnits.filter((unit) => (studentId === "all" || unit.studentId === studentId) && unit.status === "active")}
      learner={selectedLearner} students={workspace.students} chooseLearner={chooseLearner} days={days} currentDate={workspace.currentDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate}
      navigateRange={(mode, date) => { setSelectedDate(date); navigate(scheduleViewHref(mode, date, studentId)); }} navigationPending={navigationPending}
      capacity={learner?.dailyCapacityMinutes ?? 180} pendingReviews={pendingReviews} approvedReviews={workspace.assignmentReviews.filter((review) => review.status === "approved")}
      submissions={workspace.submissions} evidence={workspace.evidence} proposals={proposals} planningProposals={visiblePlanningProposals} acknowledgedProposalIds={acknowledgedProposalIds}
      reminders={workspace.reminders.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)} artifacts={workspace.artifacts.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
      practiceSessions={practiceSessions.filter((item) => studentId === "all" || item.studentId === studentId)} insights={liveInsights.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)} busy={busy}
      activeAgentTurn={liveAgentTurn}
      onBuildWeek={() => buildWeek()} onBuildNextWeek={() => buildWeek(addDays(days[0], 7))}
      onAddConflict={(date, trigger) => setConflictEditor({ date, conflict: null, trigger })} onEditConflict={(conflict, trigger) => setConflictEditor({ date: conflict.conflictDate, conflict, trigger })}
      onUpdate={updateAssignment} onMove={(assignmentId, date) => void moveAssignment(assignmentId, date)} onSubmit={setCaptureAssignment} onAdjust={(item) => void proposeAdjustments([item])}
      onDecide={(proposal, decision) => void decideAdjustment(proposal, decision)} onAcknowledge={acknowledgeAdjustment} onDismissInsight={dismissInsight} onStartPractice={(input) => void openPractice(input)}
      onDismissPractice={(session, reason) => void dismissPractice(session, reason)} onPracticeFollowUp={(insight, action) => void practiceFollowUp(insight, action)} onApproveReview={(review) => void approveReview(review)} briefing={briefingSurface} capture={captureWorkspace}
      onAttentionSaved={attentionSaved} onAskKlio={(request) => setAssistantPrefill((current) => ({ key: (current?.key ?? 0) + 1, request }))}
    /> : null}
    {surface === "assignments" ? <AssignmentsSurface key={`${workspace.selectedCurriculumUnitId ?? "no-unit"}:${workspace.curriculumUnits.find((unit) => unit.id === workspace.selectedCurriculumUnitId)?.assignmentCount ?? 0}`} familyId={workspace.family.id} studentId={studentId} selectedUnitId={workspace.selectedCurriculumUnitId} nextCursor={workspace.assignmentPage?.nextCursor ?? null} navigationPending={navigationPending} navigate={navigate} students={workspace.students} enabledWeekdays={enabledWeekdays} units={workspace.curriculumUnits.filter((unit) => studentId === "all" || unit.studentId === studentId)} assignments={assignments} busy={busy} setBusy={setBusy} setNotice={setNotice} showCurriculum={showCurriculum} setShowCurriculum={setShowCurriculum} onSubmit={setSubmissionAssignment} onUpdate={updateAssignment} /> : null}
    {surface === "review" ? <ReviewSurface assignments={assignments} students={workspace.students} reviews={pendingReviews} submissions={workspace.submissions} legacyCount={workspace.pendingApprovals} busy={busy} setBusy={setBusy} setNotice={setNotice} /> : null}
    {surface === "adjustments" ? <AdjustmentsSurface assignments={assignments} students={workspace.students} proposals={workspace.adjustments.filter((proposal) => studentId === "all" || proposal.studentId === studentId)} planningProposals={visiblePlanningProposals.filter((proposal) => studentId === "all" || proposal.studentId === studentId)} busy={busy} setBusy={setBusy} setNotice={setNotice} onUndo={(proposal) => void decideAdjustment(proposal, "undo")} onAcknowledge={acknowledgeAdjustment} /> : null}

    <AnimatePresence>{submissionAssignment ? <SubmissionPanel assignment={submissionAssignment} familyEvidence={workspace.evidence.filter((item) => item.studentIds.includes(submissionAssignment.studentId)).slice(0, 12)} busy={busy} setBusy={setBusy} setNotice={setNotice} close={() => setSubmissionAssignment(null)} /> : null}</AnimatePresence>
    <AnimatePresence>{activePracticeSession ? <PracticeOverlay session={activePracticeSession} title={workspace.artifacts.find((artifact) => artifact.id === activePracticeSession.artifactId)?.title} learnerName={workspace.students.find((student) => student.id === activePracticeSession.studentId)?.displayName ?? "Learner"} onClose={() => setActivePracticeSessionId(null)} onCompleted={(result) => practiceCompleted(activePracticeSession.id, result)} /> : null}</AnimatePresence>
    {conflictEditor ? <CalendarConflictEditor familyId={workspace.family.id} conflict={conflictEditor.conflict} date={conflictEditor.date} scopeStudentId={studentId === "all" ? null : studentId} students={workspace.students} returnFocus={conflictEditor.trigger} onClose={() => setConflictEditor(null)} onSaved={savedConflict} onDeleted={deletedConflict} /> : null}
  </div>;
}

function DaySurface(props: {
  familyId: string;
  initialArtifactId?: string;
  workspaceLayouts: WorkspaceLayoutDTO[];
  briefing: React.ReactNode;
  assignments: AssignmentDTO[];
  scopeId: string;
  currentDate: string;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  navigateDate: (date: string) => void;
  navigationPending: boolean;
  learner: StudentDTO | undefined;
  students: StudentDTO[];
  chooseLearner: (id: string) => void;
  reminders: ReminderDTO[];
  reviews: AssignmentReviewDTO[];
  approvedReviews: AssignmentReviewDTO[];
  submissions: SubmissionDTO[];
  evidence: EvidenceDTO[];
  proposals: AdjustmentDTO[];
  planningProposals: PlanningProposalDTO[];
  acknowledgedProposalIds: string[];
  artifacts: ArtifactDTO[];
  practiceSessions: PracticeSessionDTO[];
  insights: KlioInsightDTO[];
  activeAgentTurn: AgentTurnDTO | null;
  busy: string | null;
  onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void;
  onReorder: (orderedIds: string[], movedId: string) => void;
  onSubmit: (item: AssignmentDTO) => void;
  onAdjust: (item: AssignmentDTO) => void;
  onAdjustAll: (items: AssignmentDTO[]) => void;
  onDecide: (proposal: AdjustmentDTO, decision: "approve" | "reject" | "undo") => void;
  onAcknowledge: (proposal: AdjustmentDTO) => Promise<boolean>;
  onDismissInsight: (insight: KlioInsightDTO) => Promise<boolean>;
  onStartPractice: (input: { sessionId?: string; artifactId?: string }) => void;
  onDismissPractice: (session: PracticeSessionDTO, reason: PracticeDismissalReason) => void;
  onPracticeFollowUp: (insight: KlioInsightDTO, action: "extend_time" | "create_more_practice") => void;
  onApproveReview: (review: AssignmentReviewDTO) => void;
  onAttentionSaved: (assignmentId: string, value: Partial<AssignmentDTO>) => void;
  onAskKlio: (request: string) => void;
  capture: React.ReactNode;
}) {
  const dayAssignments = props.assignments.filter((item) => item.scheduledDate === props.selectedDate && item.status !== "skipped");
  const [selectedId, setSelectedId] = useState<string | null>(() => dayAssignments.find((item) => item.status !== "completed")?.id ?? dayAssignments[0]?.id ?? null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const parentConflicts = attentionConflicts(dayAssignments);
  const primaryParentConflict = parentConflicts[0];
  const primaryConflictItems = primaryParentConflict ? [primaryParentConflict.firstId, primaryParentConflict.secondId].map((id) => dayAssignments.find((item) => item.id === id)).filter((item): item is AssignmentDTO => Boolean(item)) : [];
  const attentionConflictByAssignment = new Map<string, { start: number; end: number }>();
  for (const conflict of parentConflicts) {
    if (!attentionConflictByAssignment.has(conflict.firstId)) attentionConflictByAssignment.set(conflict.firstId, conflict.overlap);
    if (!attentionConflictByAssignment.has(conflict.secondId)) attentionConflictByAssignment.set(conflict.secondId, conflict.overlap);
  }
  const completed = dayAssignments.filter((item) => item.status === "completed").length;
  const activeReminders = props.reminders.filter((item) => item.status === "pending" && isParentFacingReminder(item)).slice(0, 1);
  const practices = props.artifacts.filter((item) => item.type === "practice" && practiceArtifactIsAvailable(item, props.practiceSessions)).slice(0, 3);
  const visibleInsights = rankWorkspaceInsights(props.insights)
    .filter((item) => item.kind !== "on_track" && isParentFacingWorkspaceInsight(item) && !isResolvedAdjustmentInsight(item, props.proposals))
    .filter((item) => !isResolvedPlanningInsight(item, props.assignments, props.students, props.planningProposals))
    .slice(0, 2);
  const visibleProposal = props.proposals.find((proposal) => proposal.status === "proposed" && !visibleInsights.some((insight) => insight.actionRef.proposalId === proposal.id));
  const recentApplied = props.proposals.find((proposal) => proposal.status === "applied" && proposal.undoStatus === "available" && !proposal.acknowledgedAt && !props.acknowledgedProposalIds.includes(proposal.id) && !visibleInsights.some((insight) => insight.actionRef.proposalId === proposal.id));
  const isFamilyView = props.scopeId === "all";
  function reorderByDrop(movedId: string, targetId: string, placeAfter: boolean) {
    const current = dayAssignments.map((item) => item.id);
    const next = reorderDayIds(current, movedId, targetId, placeAfter);
    if (next !== current) props.onReorder(next, movedId);
  }
  const schedule = <main className={`teacher-day-sheet ${isFamilyView ? "family-view" : ""}`}>
        <header><div><span>{isFamilyView ? "Your day" : `${props.learner?.displayName ?? "Learner"}’s day`}</span><strong>{completed} / {dayAssignments.length} complete</strong></div><i aria-hidden="true"><b style={{ width: `${dayAssignments.length ? completed / dayAssignments.length * 100 : 0}%` }} /></i><p className="day-order-hint"><GripVertical size={12} />Drag lessons to reorder or hand one to Klio</p></header>
        <div className="teacher-day-list">
          {primaryParentConflict && primaryConflictItems.length === 2 ? <aside className="parent-attention-collision" role="alert"><Clock3 size={14} aria-hidden="true" /><span>Both need you · {formatTimeFromMinutes(primaryParentConflict.overlap.start)}–{formatTimeFromMinutes(primaryParentConflict.overlap.end)}</span><strong>{dayConflictLabel(primaryConflictItems[0], props.students, isFamilyView)}</strong><small>overlaps {dayConflictLabel(primaryConflictItems[1], props.students, isFamilyView)}</small></aside> : null}
          {dayAssignments.length ? dayAssignments.map((item, index) => <DayAssignmentRow item={item} learnerName={isFamilyView ? props.students.find((student) => student.id === item.studentId)?.displayName : props.learner?.displayName} attentionConflict={attentionConflictByAssignment.get(item.id)} selected={selectedId === item.id} focused={focusedId === item.id} busy={props.busy === item.id || props.busy === props.reviews.find((review) => review.assignmentId === item.id)?.id} review={props.reviews.find((review) => review.assignmentId === item.id)} submission={props.submissions.find((submission) => submission.assignmentId === item.id)} evidence={props.evidence} onSelect={() => setSelectedId(item.id)} onToggleDetail={() => { setSelectedId(item.id); setFocusedId((current) => current === item.id ? null : item.id); }} onCollapse={() => setFocusedId((current) => current === item.id ? null : current)} onUpdate={props.onUpdate} onSubmit={props.onSubmit} onAdjust={props.onAdjust} onStartPractice={props.onStartPractice} onApproveReview={props.onApproveReview} onAttentionSaved={props.onAttentionSaved} onAskKlio={props.onAskKlio} onReorder={reorderByDrop} index={index} key={item.id} />) : <div className="day-empty"><CalendarDays size={25} /><strong>The page is open today.</strong><span>Leave it clear or ask Klio to plan from your curriculum.</span><Link href="/app/week">Plan this week <ArrowRight size={12} /></Link></div>}
        </div>
      </main>;
  const items: SpatialWorkspaceItem[] = [
    { id: "schedule", label: "Schedule", title: longDate(props.selectedDate), x: 730, y: 470, width: 720, focusZoom: .92, minFocusZoom: .78, className: "spatial-day-schedule", children: schedule },
    ...(props.reviews.length ? [{ id: "review", label: "Review ready", title: `${props.reviews.length} ${props.reviews.length === 1 ? "assignment" : "assignments"}`, x: 260, y: 520, width: 350, focusZoom: 1, className: "spatial-note-object", children: <Link className="teacher-note note-lilac" href="/app/review"><span><ClipboardCheck size={15} />Klio checked the work</span><strong>{props.reviews.length} {props.reviews.length === 1 ? "review is" : "reviews are"} ready</strong><small>Approve the grounded feedback when you are ready.</small><ArrowRight size={15} /></Link> }] : []),
    ...(recentApplied ? [{ id: `adjusted:${recentApplied.id}`, label: "Klio adjusted", title: recentApplied.summary, x: 1500, y: 480, width: 390, focusZoom: 1, className: "spatial-note-object", children: <AdjustmentNote proposal={recentApplied} busy={props.busy === recentApplied.id} onUndo={() => props.onDecide(recentApplied, "undo")} onAcknowledge={() => props.onAcknowledge(recentApplied)} /> }] : []),
    ...visibleInsights.map((insight, index) => {
      const presentation = buildScheduleDecisionPresentation(insight, props.assignments, props.students);
      const planningState = presentation ? scheduleDecisionProposalState(presentation, props.planningProposals) : null;
      const turnState = presentation && !planningState ? scheduleDecisionTurnState(presentation, props.activeAgentTurn) : null;
      return { id: `insight:${insight.id}`, label: planningState?.status === "proposed" ? "Schedule ready" : turnState === "working" ? "Klio is working" : turnState === "needs_input" ? "Klio needs one detail" : insightLabel(insight.kind), title: planningState?.status === "proposed" ? "A schedule change is ready" : turnState ? presentation?.workingTitle ?? insight.title : presentation?.title ?? insight.title, x: index === 0 ? 1500 : 260, y: 500 + index * 260, width: 390, focusZoom: 1, className: "spatial-note-object", children: <InsightNote insight={insight} assignments={props.assignments} students={props.students} proposals={props.proposals} planningProposals={props.planningProposals} activeAgentTurn={props.activeAgentTurn} busy={props.busy} onDecide={props.onDecide} onAcknowledge={props.onAcknowledge} onDismiss={props.onDismissInsight} onStartPractice={props.onStartPractice} onPracticeFollowUp={props.onPracticeFollowUp} onAskKlio={props.onAskKlio} /> };
    }),
    ...(visibleProposal ? [{ id: `adjustment:${visibleProposal.id}`, label: "Schedule ready", title: visibleProposal.summary, x: 1500, y: 760, width: 390, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note teacher-note-decision note-yellow"><span><RotateCcw size={15} />Needs your approval</span><strong>{visibleProposal.summary}</strong><small>This family policy asks before applying the change.</small><div className="teacher-note-actions"><button type="button" onClick={() => props.onDecide(visibleProposal, "approve")} disabled={props.busy === visibleProposal.id}><Check size={12} />{props.busy === visibleProposal.id ? "Applying…" : "Accept changes"}</button><Link href="/app/adjustments">Review <ArrowRight size={12} /></Link></div></div> }] : []),
    ...practices.map((practice, index) => {
      const practiceSession = props.practiceSessions.find((item) => item.artifactId === practice.id && ["ready", "in_progress"].includes(item.status));
      const practiceLearnerName = practice.studentId ? props.students.find((student) => student.id === practice.studentId)?.displayName : undefined;
      return { id: `practice:${practice.id}`, label: "Practice", title: `${practiceLearnerName ? `${practiceLearnerName} · ` : ""}${practice.title}`, x: 1540, y: 820 + index * 320, width: 420, focusZoom: 1.02, className: "spatial-practice-object", children: <CanvasPractice familyId={props.familyId} artifact={practice} learnerName={practiceLearnerName} session={practiceSession} busy={props.busy === practice.id || props.busy === practiceSession?.id} onStart={props.onStartPractice} onDismiss={props.onDismissPractice} /> };
    }),
    ...(activeReminders[0] ? [{ id: `reminder:${activeReminders[0].id}`, label: "Reminder", title: activeReminders[0].title, x: 260, y: 1020, width: 350, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note note-cream"><span><Clock3 size={15} />Reminder</span><strong>{activeReminders[0].title}</strong><small>{activeReminders[0].dueAt ? dueLabel(activeReminders[0].dueAt) : "No due date"}</small></div> }] : []),
  ];
  const toolbar = <div className="spatial-canvas-toolbar spatial-day-toolbar spatial-calendar-toolbar">
    <div className="teacher-canvas-nav"><button type="button" onClick={() => props.navigateDate(addDays(props.selectedDate, -1))} aria-label="Previous day" disabled={props.navigationPending}><ArrowLeft size={16} /></button><h1>{longDate(props.selectedDate)}</h1><button type="button" onClick={() => props.navigateDate(addDays(props.selectedDate, 1))} aria-label="Next day" disabled={props.navigationPending}><ArrowRight size={16} /></button></div>
    <div className="teacher-toolbar-actions teacher-week-actions"><div className="calendar-view-toggle" role="group" aria-label="Schedule view"><button type="button" aria-pressed="true" onClick={() => props.navigateDate(props.currentDate)} disabled={props.navigationPending}>Today</button><Link href={scheduleViewHref("week", props.selectedDate, props.scopeId)}>Week</Link><Link href={scheduleViewHref("month", props.selectedDate, props.scopeId)}>Month</Link></div><button type="button" className="teacher-plan-next calendar-action-placeholder" aria-hidden="true" tabIndex={-1} disabled>Plan next week</button><label><span>View</span><select aria-label="View day plan for" value={props.scopeId} onChange={(event) => props.chooseLearner(event.target.value)} disabled={props.navigationPending}>{props.students.length > 1 ? <option value="all">Family</option> : null}{props.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div>
  </div>;

  const layout = props.workspaceLayouts.find((item) => item.surface === "day" && item.scopeKey === props.scopeId);
  const focusedPractice = practices.find((practice) => practice.id === props.initialArtifactId);
  return <SpatialWorkspace ariaLabel="Daily homeschool teaching board" persistenceKey={`day:${props.scopeId}`} items={items} initialView={{ x: -385, y: -270, zoom: .86 }} overviewView={{ x: 20, y: -90, zoom: .52 }} homeItemId="schedule" focusRequest={focusedPractice ? { id: `practice:${focusedPractice.id}`, key: 1 } : null} layoutPersistence={{ familyId: props.familyId, surface: "day", scopeKey: props.scopeId, layoutVersion: 2, positions: layout?.layoutVersion === 2 ? layout.positions : undefined }} onCameraChange={(camera) => { if (camera.level !== "nested") setFocusedId(null); }} toolbar={toolbar} briefing={props.briefing} assistant={<div className="spatial-assistant-surface">{props.capture}</div>} />;
}

function DayAssignmentRow(props: { item: AssignmentDTO; learnerName?: string; attentionConflict?: { start: number; end: number }; selected: boolean; focused: boolean; busy: boolean; review?: AssignmentReviewDTO; submission?: SubmissionDTO; evidence: EvidenceDTO[]; index: number; onSelect: () => void; onToggleDetail: () => void; onCollapse: () => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust: (item: AssignmentDTO) => void; onStartPractice: (input: { artifactId?: string }) => void; onApproveReview: (review: AssignmentReviewDTO) => void; onAttentionSaved: (assignmentId: string, value: Partial<AssignmentDTO>) => void; onAskKlio: (request: string) => void; onReorder: (movedId: string, targetId: string, placeAfter: boolean) => void }) {
  const complete = props.item.status === "completed";
  const runnablePractice = props.item.sourceKind === "practice" && Boolean(props.item.artifactId);
  return <article className={`day-assignment ${props.selected ? "selected" : ""} ${props.focused ? "focused" : ""} ${complete ? "completed" : ""} ${props.attentionConflict ? "attention-conflict" : ""}`} data-spatial-focus-target data-spatial-focus-id={props.item.id} data-spatial-focus-label={props.item.title} data-spatial-focus-zoom="1.14" draggable title={complete ? "Completed. Select to view details or drag to Klio." : "Drag to reorder or hand this lesson to Klio"} onDragStart={(event) => startAssignmentDrag(event, props.item)} onDragEnd={() => document.querySelectorAll(".day-drop-before,.day-drop-after").forEach((element) => element.classList.remove("day-drop-before", "day-drop-after"))} onDragOver={(event) => { if (!event.dataTransfer.types.includes("application/x-klio-assignment")) return; event.preventDefault(); const after = event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2; event.currentTarget.classList.toggle("day-drop-before", !after); event.currentTarget.classList.toggle("day-drop-after", after); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.classList.remove("day-drop-before", "day-drop-after"); }} onDrop={(event) => { event.preventDefault(); const movedId = event.dataTransfer.getData("application/x-klio-assignment"); const after = event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2; event.currentTarget.classList.remove("day-drop-before", "day-drop-after"); if (movedId) props.onReorder(movedId, props.item.id, after); }} onClick={props.onSelect}>
    <span className="day-drag-grip" aria-hidden="true"><GripVertical size={14} /></span>
    <time>{props.item.scheduledTime ? formatTime(props.item.scheduledTime) : props.index === 0 ? "Start here" : "Next"}</time>
    <span className="day-subject-mark">{props.item.subject.slice(0, 1).toUpperCase()}</span>
    <div><small>{props.learnerName ? `${props.learnerName} · ${props.item.subject}` : props.item.subject}</small><strong>{props.item.title}</strong>{props.item.instructions ? <p>{props.item.instructions}</p> : null}{props.attentionConflict ? <span className="day-attention-conflict">Needs you {formatTimeFromMinutes(props.attentionConflict.start)}–{formatTimeFromMinutes(props.attentionConflict.end)}</span> : null}</div>
    <span className="day-duration">{props.item.estimatedMinutes ? `${props.item.estimatedMinutes} min` : "Flexible"}<ParentSupportLabel assignment={props.item} /></span>
    {complete ? <span className="day-state"><Check size={14} />Done</span> : props.item.status !== "planned" ? <span className="day-state">{statusLabel(props.item.status)}</span> : null}
    {!complete && !runnablePractice ? <button type="button" className="day-complete-action" aria-label={`Mark ${props.item.title} done`} title="Mark done" onClick={(event) => { event.stopPropagation(); props.onUpdate(props.item, "completed"); props.onCollapse(); }} disabled={props.busy}><Check size={13} aria-hidden="true" /><span>Done</span></button> : null}
    <details className="day-row-menu" onClick={(event) => event.stopPropagation()} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key !== "Escape") return; event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }}>
      <summary aria-label={`Actions for ${props.item.title}`} aria-haspopup="menu"><Ellipsis size={17} /></summary>
      <div role="menu">
        <button type="button" role="menuitem" aria-label={`${props.focused ? "Hide" : "View"} details for ${props.item.title}`} aria-expanded={props.focused} onClick={props.onToggleDetail}>{props.focused ? "Hide details" : "View details"}</button>
        {runnablePractice ? <button type="button" role="menuitem" onClick={() => props.onStartPractice({ artifactId: props.item.artifactId! })} disabled={props.busy}>Start practice</button> : !complete ? <button type="button" role="menuitem" onClick={() => props.onSubmit(props.item)}>Hand to Klio</button> : null}
        <button type="button" role="menuitem" onClick={() => props.onAdjust(props.item)} disabled={props.busy}>Not finished</button>
      </div>
    </details>
    {props.focused ? <LessonDetail assignment={props.item} learnerName={props.learnerName} review={props.review} submission={props.submission} evidence={props.evidence} busy={props.busy} onUpdate={props.onUpdate} onSubmit={props.onSubmit} onAdjust={props.onAdjust} onStartPractice={props.onStartPractice} onApproveReview={props.onApproveReview} onAttentionSaved={props.onAttentionSaved} onAskKlio={props.onAskKlio} hideActions={!complete} /> : null}
  </article>;
}

function LessonDetail(props: { assignment: AssignmentDTO; learnerName?: string; review?: AssignmentReviewDTO; submission?: SubmissionDTO; evidence: EvidenceDTO[]; busy: boolean; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust: (item: AssignmentDTO) => void; onStartPractice?: (input: { artifactId?: string }) => void; onApproveReview: (review: AssignmentReviewDTO) => void; onAttentionSaved: (assignmentId: string, value: Partial<AssignmentDTO>) => void; onAskKlio: (request: string) => void; hideActions?: boolean }) {
  const sources = props.submission ? props.evidence.filter((item) => props.submission?.evidenceIds.includes(item.id)) : [];
  return <div className="lesson-focus-detail" onClick={(event) => event.stopPropagation()}>
    <header><div><span>{props.learnerName ? `${props.learnerName} · ` : ""}{props.assignment.subject}</span><h2>{props.assignment.title}</h2></div><span className={`lesson-focus-status ${props.assignment.status}`}>{statusLabel(props.assignment.status)}</span></header>
    <div className="lesson-focus-meta"><span>{props.assignment.scheduledDate ? longDate(props.assignment.scheduledDate) : "Not scheduled"}</span><span>{props.assignment.estimatedMinutes ? `${props.assignment.estimatedMinutes} minutes` : "Flexible length"}</span><span>{props.assignment.sourceKind === "practice" ? "Supplemental practice" : "Curriculum work"}</span></div>
    {props.assignment.instructions ? <p>{props.assignment.instructions}</p> : <p className="lesson-focus-empty">No additional lesson directions were added.</p>}
    <ParentSupportControl assignment={props.assignment} onSaved={(value) => props.onAttentionSaved(props.assignment.id, value)} onAskKlio={props.onAskKlio} />
    {sources.length ? <div className="lesson-focus-sources"><span>Submitted work</span>{sources.map((source) => <a href={source.mimeType ? `/api/evidence/${source.id}/download` : `/app/records?q=${encodeURIComponent(source.title ?? source.rawText?.slice(0, 50) ?? "")}`} key={source.id}>{source.title ?? source.kind}<ArrowRight size={11} /></a>)}</div> : null}
    {props.review ? <CanvasReview review={props.review} assignment={props.assignment} submission={props.submission} evidence={props.evidence} learnerName={props.learnerName} busy={props.busy} onApprove={props.onApproveReview} compact /> : props.assignment.sourceKind === "practice" && props.assignment.artifactId && props.onStartPractice ? <div className="lesson-focus-actions"><button type="button" onClick={() => props.onStartPractice?.({ artifactId: props.assignment.artifactId! })} disabled={props.busy}><ArrowRight size={13} />Start practice</button>{props.assignment.status !== "completed" ? <button type="button" onClick={() => props.onAdjust(props.assignment)} disabled={props.busy}><RotateCcw size={13} />Not finished</button> : null}</div> : props.hideActions ? null : <div className="lesson-focus-actions"><button type="button" onClick={() => props.onUpdate(props.assignment, props.assignment.status === "completed" ? "planned" : "completed")} disabled={props.busy}><Check size={13} />{props.assignment.status === "completed" ? "Reopen lesson" : "Mark done"}</button><button type="button" onClick={() => props.onSubmit(props.assignment)}><FileCheck2 size={13} />Hand to Klio</button>{props.assignment.status !== "completed" ? <button type="button" onClick={() => props.onAdjust(props.assignment)} disabled={props.busy}><RotateCcw size={13} />Not finished</button> : null}</div>}
  </div>;
}

function CanvasReview({ review, assignment, submission, evidence, learnerName, busy, onApprove, compact = false }: { review: AssignmentReviewDTO; assignment?: AssignmentDTO; submission?: SubmissionDTO; evidence: EvidenceDTO[]; learnerName?: string; busy: boolean; onApprove: (review: AssignmentReviewDTO) => void; compact?: boolean }) {
  const sources = submission ? evidence.filter((item) => submission.evidenceIds.includes(item.id)) : [];
  const uncertainty = Array.isArray(review.uncertaintyFlags) ? review.uncertaintyFlags.filter((item): item is string => typeof item === "string") : [];
  return <section className={`canvas-review ${compact ? "compact" : ""}`}>
    {!compact ? <header><span><ClipboardCheck size={14} />Ready for your review</span><strong>{assignment?.title ?? "Submitted work"}</strong><small>{learnerName ? `${learnerName} · ` : ""}{assignment?.subject ?? "Learning record"}</small></header> : null}
    <div className="canvas-review-score"><span>Klio suggests</span><strong>{review.draftScore === null ? "No numeric score" : `${review.draftScore}%`}</strong>{review.scoreLabel ? <small>{review.scoreLabel}</small> : null}</div>
    <p>{review.draftFeedback || "Klio could not support a numeric score from this source. Check the work before recording a result."}</p>
    {uncertainty.length ? <aside><b>Parent check</b>{uncertainty[0]}</aside> : null}
    {sources.length ? <div className="canvas-review-sources">{sources.slice(0, 3).map((source) => <a href={source.mimeType ? `/api/evidence/${source.id}/download` : "/app/records"} key={source.id}>Open {source.title ?? "source"}<ArrowRight size={11} /></a>)}</div> : null}
    <footer><Link href="/app/review">Edit review</Link><button type="button" onClick={() => onApprove(review)} disabled={busy}><Check size={13} />{busy ? "Saving…" : "Looks right — approve"}</button></footer>
  </section>;
}

function CanvasPractice({ familyId, artifact, learnerName, session, busy, onStart, onDismiss }: { familyId: string; artifact: ArtifactDTO; learnerName?: string; session?: PracticeSessionDTO; busy: boolean; onStart: (input: { sessionId?: string; artifactId?: string }) => void; onDismiss: (session: PracticeSessionDTO, reason: PracticeDismissalReason) => void }) {
  const [showDismissReasons, setShowDismissReasons] = useState(false);
  const content = artifact.content && typeof artifact.content === "object" && !Array.isArray(artifact.content) ? artifact.content as Record<string, unknown> : {};
  const practice = normalizePracticeSpec(content.practice);
  const ready = Boolean(practice);
  return <section className={practicePreviewStyles.panel}>
    <header>
      <div><span>{artifact.status === "approved" ? "Ready to use" : "Ready for your review"}</span><strong>{artifact.title}</strong><small>{learnerName ? `${learnerName} · ` : ""}Supplemental practice</small></div>
      <b className={artifact.status === "draft" ? practicePreviewStyles.draft : undefined}>{artifact.status === "approved" ? "Ready" : "Draft"}</b>
    </header>
    {artifact.summary ? <p className={practicePreviewStyles.summary}>{artifact.summary}</p> : null}
    {practice ? <div className="canvas-practice-brief"><span>{practice.activities.length} activities</span><span>About {estimatedPracticeMinutes(practice.activities)} minutes</span><span>{practice.mastery_percent}% goal</span><p>{practice.instructions}</p></div> : null}
    {artifact.rationale ? <p className="canvas-practice-reason">{artifact.rationale}</p> : null}
    <footer>
      {artifact.status === "approved" && ready ? <button type="button" onClick={() => onStart(session ? { sessionId: session.id, artifactId: artifact.id } : { artifactId: artifact.id })} disabled={busy}><ArrowRight size={13} />{busy ? "Opening…" : "Start practice"}</button> : null}
      {artifact.status === "approved" && session ? <button type="button" className={practicePreviewStyles.secondary} onClick={() => setShowDismissReasons((current) => !current)} disabled={busy} aria-expanded={showDismissReasons}>{showDismissReasons ? "Keep practice" : "No longer needed"}</button> : null}
      {artifact.status === "draft" ? <>
        <form action={reviewEntityAction}><input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="entityId" value={artifact.id} /><input type="hidden" name="entityType" value="artifact" /><input type="hidden" name="decision" value="rejected" /><button type="submit" className={practicePreviewStyles.secondary}>Remove draft</button></form>
        <form action={reviewEntityAction}><input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="entityId" value={artifact.id} /><input type="hidden" name="entityType" value="artifact" /><input type="hidden" name="decision" value="approved" /><button type="submit"><Check size={13} />Approve practice</button></form>
      </> : null}
    </footer>
    {showDismissReasons && session ? <div className={practicePreviewStyles.retire}>
      <div><strong>Why is this no longer needed?</strong><p>Klio uses this correction when deciding what support to make next.</p></div>
      <div>
        <button type="button" onClick={() => onDismiss(session, "learned_in_curriculum")} disabled={busy}><Check size={13} />Learned it in curriculum</button>
        <button type="button" onClick={() => onDismiss(session, "already_understands")} disabled={busy}>Already understands it</button>
        <button type="button" onClick={() => onDismiss(session, "not_right_fit")} disabled={busy}>Not the right practice</button>
      </div>
    </div> : null}
  </section>;
}

function PracticeOverlay({ session, learnerName, title, onClose, onCompleted }: { session: PracticeSessionDTO; learnerName: string; title?: string; onClose: () => void; onCompleted: (result: PracticePlayerResult) => void }) {
  return <div className="practice-overlay" role="dialog" aria-modal="true" aria-label={`${learnerName} practice`}>
    <div className="practice-overlay-sheet">
      <PracticePlayer sessionId={session.id} learnerName={learnerName} title={title} spec={session.spec} completed={session.status === "completed"} embedded onClose={onClose} onCompleted={onCompleted} />
    </div>
  </div>;
}

function practiceArtifactIsAvailable(artifact: ArtifactDTO, sessions: PracticeSessionDTO[]) {
  if (artifact.status === "draft") return true;
  if (artifact.status !== "approved") return false;
  const related = sessions.filter((session) => session.artifactId === artifact.id);
  return !related.length || related.some((session) => ["ready", "in_progress"].includes(session.status));
}

function isKlioInsight(value: unknown): value is KlioInsightDTO {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const insight = value as Record<string, unknown>;
  return typeof insight.id === "string" && typeof insight.title === "string" && typeof insight.summary === "string" && typeof insight.kind === "string" && typeof insight.priority === "number" && Array.isArray(insight.evidenceRefs) && Boolean(insight.actionRef && typeof insight.actionRef === "object");
}

function insightLabel(kind: string) {
  if (kind === "adjusted") return "Klio adjusted";
  if (kind === "practice_ready") return "Practice ready";
  if (kind === "review_ready") return "Review ready";
  if (kind === "needs_detail") return "Schedule decision";
  return "Klio noticed";
}

function rankWorkspaceInsights(insights: KlioInsightDTO[]) {
  const actionBoost: Record<string, number> = { adjusted: 40, needs_detail: 32, review_ready: 26, practice_ready: 22, noticed: 8 };
  return [...insights].sort((a, b) => {
    const score = (item: KlioInsightDTO) => item.priority + (actionBoost[item.kind] ?? 0);
    return score(b) - score(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

function insightGroupKey(insight: Pick<KlioInsightDTO, "kind" | "title">) {
  return `${insight.kind}:${insight.title.trim().toLocaleLowerCase("en-US")}`;
}

export function isParentFacingWorkspaceInsight(insight: KlioInsightDTO) {
  return !["Today’s plan needs a quick look", "A few items need evening follow-through"].includes(insight.title);
}

export function isParentFacingReminder(reminder: Pick<ReminderDTO, "title">) {
  return !/^Reschedule .+ · Lesson \d+$/i.test(reminder.title.trim());
}

function isResolvedAdjustmentInsight(insight: KlioInsightDTO, proposals: AdjustmentDTO[]) {
  const proposalId = typeof insight.actionRef.proposalId === "string" ? insight.actionRef.proposalId : null;
  return proposalId ? proposals.some((proposal) => proposal.id === proposalId && ["undone", "rejected", "stale"].includes(proposal.status)) : false;
}

function isResolvedPlanningInsight(insight: KlioInsightDTO, assignments: AssignmentDTO[], students: StudentDTO[], proposals: PlanningProposalDTO[]) {
  const presentation = buildScheduleDecisionPresentation(insight, assignments, students);
  return presentation ? scheduleDecisionProposalState(presentation, proposals)?.status === "applied" : false;
}

export function InsightNote({ insight, assignments, students, proposals, planningProposals, activeAgentTurn, busy, onDecide, onAcknowledge, onDismiss, onStartPractice, onPracticeFollowUp, onAskKlio }: { insight: KlioInsightDTO; assignments: AssignmentDTO[]; students: StudentDTO[]; proposals: AdjustmentDTO[]; planningProposals: PlanningProposalDTO[]; activeAgentTurn: AgentTurnDTO | null; busy: string | null; onDecide: (proposal: AdjustmentDTO, decision: "approve" | "reject" | "undo") => void; onAcknowledge: (proposal: AdjustmentDTO) => Promise<boolean>; onDismiss: (insight: KlioInsightDTO) => Promise<boolean>; onStartPractice: (input: { sessionId?: string; artifactId?: string }) => void; onPracticeFollowUp: (insight: KlioInsightDTO, action: "extend_time" | "create_more_practice") => void; onAskKlio: (request: string) => void }) {
  const router = useRouter();
  const [undoing, setUndoing] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const scheduleDecision = buildScheduleDecisionPresentation(insight, assignments, students);
  const scheduleProposal = scheduleDecision ? scheduleDecisionProposalState(scheduleDecision, planningProposals) : null;
  const scheduleTurnState = scheduleDecision && !scheduleProposal ? scheduleDecisionTurnState(scheduleDecision, activeAgentTurn) : null;
  const proposalId = typeof insight.actionRef.proposalId === "string" ? insight.actionRef.proposalId : null;
  const artifactId = typeof insight.actionRef.artifactId === "string" ? insight.actionRef.artifactId : null;
  const practiceSessionId = typeof insight.actionRef.practiceSessionId === "string" ? insight.actionRef.practiceSessionId : null;
  const practiceOutcome = insight.actionRef.type === "practice_outcome" ? insight.actionRef.outcome : null;
  const proposal = proposalId ? proposals.find((item) => item.id === proposalId) : null;
  const undoAvailable = insight.actionRef.undoAvailable === true && proposal?.undoStatus === "available";
  async function undo() {
    if (!proposalId || undoing) return;
    if (proposal) return onDecide(proposal, "undo");
    setUndoing(true);
    const response = await fetch(`/api/adjustments/${proposalId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "undo" }) });
    setUndoing(false);
    if (response.ok) router.refresh();
  }
  const acknowledgesAdjustment = insight.kind === "adjusted" && proposal?.status === "applied";
  async function dismiss() { setDismissing(true); if (acknowledgesAdjustment && proposal) await onAcknowledge(proposal); else await onDismiss(insight); setDismissing(false); }
  const scheduleReady = scheduleProposal?.status === "proposed";
  const tone = scheduleTurnState === "working" || scheduleReady ? "note-green" : insight.kind === "adjusted" ? "note-green" : insight.kind === "practice_ready" ? "note-blue" : insight.kind === "needs_detail" ? "note-yellow" : "note-lilac";
  return <div className={`teacher-note teacher-note-insight ${tone} note-tilt-right ${scheduleDecision ? "teacher-note-schedule-decision" : ""}`}>
    <span>{scheduleTurnState === "working" ? <LoaderCircle className="spin" size={15} /> : scheduleReady ? <Check size={15} /> : scheduleDecision ? <CalendarDays size={15} /> : <Sparkles size={15} />}{scheduleReady ? "Schedule ready" : scheduleTurnState === "working" ? "Klio is working" : scheduleTurnState === "needs_input" ? "Klio needs one detail" : scheduleDecision?.label ?? insightLabel(insight.kind)}</span>
    <strong>{scheduleReady ? "Klio prepared a change" : scheduleTurnState ? scheduleDecision?.workingTitle : scheduleDecision?.title ?? insight.title}</strong><small>{scheduleReady ? scheduleProposal.summary : scheduleTurnState === "needs_input" ? "Klio paused before changing anything. Open the conversation to answer one detail." : scheduleTurnState === "working" ? scheduleDecision?.workingSummary : scheduleDecision?.summary ?? insight.summary}</small>
    {scheduleDecision && scheduleDecision.assignments.length > 1 ? <ul className="insight-affected-work" aria-label="Affected lessons">{scheduleDecision.assignments.slice(0, 3).map((assignment) => <li key={assignment.id}><span>{assignment.title}</span>{assignment.estimatedMinutes ? <small>{assignment.estimatedMinutes} min</small> : null}</li>)}{scheduleDecision.assignments.length > 3 ? <li><span>And {scheduleDecision.assignments.length - 3} more</span></li> : null}</ul> : null}
    <div className="teacher-note-actions">
      {scheduleReady ? <Link className="note-action-primary" href={`/app/adjustments?proposal=${encodeURIComponent(scheduleProposal.id)}`}>Review or edit <ArrowRight size={12} /></Link> : scheduleDecision && scheduleTurnState ? <div className={`note-working-status ${scheduleTurnState}`} role="status" aria-live="polite">{scheduleTurnState === "working" ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}{scheduleTurnState === "working" ? "Working on this" : "Waiting for your answer"}</div> : scheduleDecision ? <button className="note-action-primary" type="button" onClick={() => onAskKlio(scheduleDecision.request)} disabled={Boolean(busy)}>Ask Klio to make room <ArrowRight size={12} /></button> : null}
      {practiceSessionId && practiceOutcome !== "needs_support" && practiceOutcome !== "understood" && practiceOutcome !== "checking" ? <button className="note-action-primary" type="button" onClick={() => onStartPractice({ sessionId: practiceSessionId, artifactId: artifactId ?? undefined })}>Start practice <ArrowRight size={12} /></button> : artifactId && !practiceOutcome ? <button className="note-action-primary" type="button" onClick={() => onStartPractice({ artifactId })}>Start practice <ArrowRight size={12} /></button> : null}
      {practiceOutcome === "needs_support" ? <>
        <button className="note-action-primary" type="button" onClick={() => onPracticeFollowUp(insight, "extend_time")} disabled={busy === insight.id}><Clock3 size={12} />Add 10 minutes</button>
        <button className="note-action-secondary" type="button" onClick={() => onPracticeFollowUp(insight, "create_more_practice")} disabled={busy === insight.id}><Plus size={12} />Make follow-up</button>
      </> : null}
      {undoAvailable && proposalId ? <button className="note-action-secondary" type="button" aria-label="Undo" onClick={() => void undo()} disabled={undoing || busy === proposalId}><RotateCcw size={12} />{undoing || busy === proposalId ? "Undoing…" : "Undo change"}</button> : null}
      {!scheduleReady && insight.evidenceRefs.length ? <Link className="note-action-quiet" href="/app/activity">Show evidence</Link> : null}
      {!scheduleReady && !scheduleTurnState ? <button className="note-action-dismiss" type="button" onClick={() => void dismiss()} disabled={dismissing}>{acknowledgesAdjustment ? <Check size={12} /> : <X size={12} />}{dismissing ? (acknowledgesAdjustment ? "Acknowledging…" : "Dismissing…") : (acknowledgesAdjustment ? "Acknowledge" : "Dismiss")}</button> : null}
    </div>
  </div>;
}

function AdjustmentNote({ proposal, busy, onUndo, onAcknowledge }: { proposal: AdjustmentDTO; busy: boolean; onUndo: () => void; onAcknowledge: () => Promise<boolean> }) {
  const [acknowledging, setAcknowledging] = useState(false);
  async function acknowledge() { setAcknowledging(true); await onAcknowledge(); setAcknowledging(false); }
  return <div className="teacher-note teacher-note-decision note-green">
    <span><Check size={15} />Klio adjusted the week</span>
    <strong>{proposal.summary}</strong>
    <small>{proposal.reason}</small>
    <div className="teacher-note-actions">
      <button className="note-action-secondary" type="button" aria-label="Undo" onClick={onUndo} disabled={busy}><RotateCcw size={12} />{busy ? "Undoing…" : "Undo change"}</button>
      <Link className="note-action-quiet" href="/app/activity">Show evidence</Link>
      <button className="note-action-dismiss" type="button" onClick={() => void acknowledge()} disabled={acknowledging}><Check size={12} />{acknowledging ? "Acknowledging…" : "Acknowledge"}</button>
    </div>
  </div>;
}

function WeekSurface(props: {
  familyId: string;
  familyLearningDays: unknown;
  workspaceLayouts: WorkspaceLayoutDTO[];
  scopeId: string;
  mode: "week" | "month";
  assignments: AssignmentDTO[];
  conflicts: CalendarConflictDTO[];
  curricula: CurriculumUnitDTO[];
  learner: StudentDTO | undefined;
  students: StudentDTO[];
  chooseLearner: (id: string) => void;
  days: string[];
  currentDate: string;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  navigateRange: (mode: "week" | "month", date: string) => void;
  navigationPending: boolean;
  capacity: number;
  pendingReviews: AssignmentReviewDTO[];
  approvedReviews: AssignmentReviewDTO[];
  submissions: SubmissionDTO[];
  evidence: EvidenceDTO[];
  proposals: AdjustmentDTO[];
  planningProposals: PlanningProposalDTO[];
  acknowledgedProposalIds: string[];
  reminders: ReminderDTO[];
  artifacts: ArtifactDTO[];
  practiceSessions: PracticeSessionDTO[];
  insights: KlioInsightDTO[];
  activeAgentTurn: AgentTurnDTO | null;
  busy: string | null;
  onBuildWeek: () => void;
  onBuildNextWeek: () => void;
  onAddConflict: (date: string, trigger: HTMLElement) => void;
  onEditConflict: (conflict: CalendarConflictDTO, trigger: HTMLElement) => void;
  onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void;
  onMove: (assignmentId: string, date: string) => void;
  onSubmit: (item: AssignmentDTO) => void;
  onAdjust: (item: AssignmentDTO) => void;
  onDecide: (proposal: AdjustmentDTO, decision: "approve" | "reject" | "undo") => void;
  onAcknowledge: (proposal: AdjustmentDTO) => Promise<boolean>;
  onDismissInsight: (insight: KlioInsightDTO) => Promise<boolean>;
  onStartPractice: (input: { sessionId?: string; artifactId?: string }) => void;
  onDismissPractice: (session: PracticeSessionDTO, reason: PracticeDismissalReason) => void;
  onPracticeFollowUp: (insight: KlioInsightDTO, action: "extend_time" | "create_more_practice") => void;
  onApproveReview: (review: AssignmentReviewDTO) => void;
  onAttentionSaved: (assignmentId: string, value: Partial<AssignmentDTO>) => void;
  onAskKlio: (request: string) => void;
  briefing: React.ReactNode;
  capture: React.ReactNode;
}) {
  const isFamilyView = props.scopeId === "all";
  const [focusedLesson, setFocusedLesson] = useState<AssignmentDTO | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const weekAssignments = props.assignments.filter((item) => item.scheduledDate && props.days.includes(item.scheduledDate) && item.status !== "skipped");
  const activeReminder = props.reminders.find((item) => item.status === "pending" && isParentFacingReminder(item));
  const practices = props.artifacts.filter((item) => item.type === "practice" && practiceArtifactIsAvailable(item, props.practiceSessions)).slice(0, 3);
  const visibleInsights = rankWorkspaceInsights(props.insights)
    .filter((item) => item.kind !== "on_track" && isParentFacingWorkspaceInsight(item) && !isResolvedAdjustmentInsight(item, props.proposals))
    .filter((item) => !isResolvedPlanningInsight(item, props.assignments, props.students, props.planningProposals))
    .slice(0, 2);
  const visibleProposal = props.proposals.find((proposal) => proposal.status === "proposed" && !visibleInsights.some((insight) => insight.actionRef.proposalId === proposal.id));
  const recentApplied = props.proposals.find((proposal) => proposal.status === "applied" && proposal.undoStatus === "available" && !proposal.acknowledgedAt && !props.acknowledgedProposalIds.includes(proposal.id) && !visibleInsights.some((insight) => insight.actionRef.proposalId === proposal.id));
  const weekConflicts = props.conflicts.filter((conflict) => props.days.includes(conflict.conflictDate));
  const weekSchedule = weekAssignments.length || weekConflicts.length ? <main className={`teacher-week-sheet ${isFamilyView ? "family-view" : ""}`} aria-label="Weekly schedule">
        {props.days.map((date) => {
          const items = weekAssignments.filter((item) => item.scheduledDate === date);
          const conflicts = weekConflicts.filter((conflict) => conflict.conflictDate === date);
          const done = items.filter((item) => item.status === "completed").length;
          const visibleStudents = isFamilyView ? props.students : props.learner ? [props.learner] : [];
          const analyses = visibleStudents.map((student) => {
            const availability = effectiveAvailability({ date, studentId: student.id, dailyCapacityMinutes: student.dailyCapacityMinutes ?? 180, schedulePreferences: student.schedulePreferences, familyLearningDays: props.familyLearningDays, conflicts: props.conflicts });
            const plannedMinutes = items.filter((item) => item.studentId === student.id).reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
            return { student, availability, plannedMinutes, overCapacity: plannedMinutes > availability.availableMinutes };
          });
          const overCapacity = analyses.some((analysis) => analysis.overCapacity);
          const dailyParentMinutes = items.reduce((sum, item) => sum + item.resolvedParentMinutes, 0);
          const dailyParentConflicts = attentionConflicts(items);
          const allDayBlocked = isFamilyView ? conflicts.some((conflict) => conflict.allDay && conflict.studentId === null) : analyses.some((analysis) => analysis.availability.allDayBlocked);
          return <section className={`${date === props.selectedDate ? "selected" : ""} ${allDayBlocked ? "has-all-day-conflict" : ""} ${overCapacity ? "is-over-capacity" : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-klio-assignment")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); const assignmentId = event.dataTransfer.getData("application/x-klio-assignment"); if (assignmentId) props.onMove(assignmentId, date); }} key={date}>
            <header className="teacher-week-day-header"><button type="button" className="teacher-week-day-head" onClick={() => props.setSelectedDate(date)}><span>{weekday(date)}</span><strong>{dayNumber(date)}</strong><small>{done}/{items.length}</small></button><button type="button" className="teacher-week-add-conflict" onClick={(event) => props.onAddConflict(date, event.currentTarget)} aria-label={`Add conflict on ${shortDate(date)}`}><Plus size={13} />Conflict</button></header>
            {conflicts.length ? <div className="teacher-week-conflicts" aria-label={`Conflicts on ${shortDate(date)}`}>{conflicts.map((conflict) => <button type="button" className={conflict.allDay ? "all-day" : "timed"} onClick={(event) => props.onEditConflict(conflict, event.currentTarget)} key={conflict.id}><span>{conflict.title}</span><small>{conflict.allDay ? "All day" : `${formatTime(conflict.startsAt!)}–${formatTime(conflict.endsAt!)}`}{isFamilyView && conflict.studentId ? ` · ${props.students.find((student) => student.id === conflict.studentId)?.displayName ?? "Learner"}` : isFamilyView ? " · Everyone" : ""}</small></button>)}</div> : null}
            {allDayBlocked || overCapacity || analyses.some((analysis) => analysis.availability.blockedMinutes > 0) ? <p className={`teacher-week-capacity ${overCapacity ? "over" : ""}`}>{allDayBlocked ? "Teaching unavailable" : overCapacity ? "Over available teaching time" : isFamilyView ? "Teaching time reduced" : `${analyses[0]?.availability.availableMinutes ?? 0} min available`}</p> : null}
            <p className={`teacher-week-parent-total ${dailyParentConflicts.length ? "collision" : ""}`}>{dailyParentMinutes} min with you{dailyParentConflicts.length ? ` · overlap at ${formatTimeFromMinutes(dailyParentConflicts[0].overlap.start)}` : ""}</p>
            <div className="teacher-week-day-body">{isFamilyView ? props.students.map((student) => {
              const learnerItems = items.filter((item) => item.studentId === student.id);
              return learnerItems.length ? <div className="teacher-week-learner-lane" key={student.id}><small>{student.displayName}</small><WeekItems items={learnerItems} onOpen={(item) => { setFocusedLesson(item); setFocusKey((value) => value + 1); }} /></div> : null;
            }) : <WeekItems items={items} onOpen={(item) => { setFocusedLesson(item); setFocusKey((value) => value + 1); }} />}</div>
          </section>;
        })}
      </main> : <div className="teacher-week-empty"><Sparkles size={25} /><span>{isFamilyView ? "Your family is ready" : `${props.learner?.displayName ?? "This learner"} is ready`}</span><h2>Turn the learning setup into this week.</h2><p>{props.curricula.length ? isFamilyView ? `Klio will plan ${formatNames(props.students.map((student) => student.displayName))} together, using each learner’s subjects, teaching rhythm, learning days, and daily limit.` : `${props.curricula.length} ${props.curricula.length === 1 ? "subject is" : "subjects are"} ready: ${props.curricula.slice(0, 4).map((unit) => unit.subject).join(", ")}${props.curricula.length > 4 ? `, and ${props.curricula.length - 4} more` : ""}.` : "Set up subjects for your learners, then Klio can build a realistic family week."}</p>{props.curricula.length ? <button type="button" onClick={props.onBuildWeek} disabled={props.busy === "build-week"}>{props.busy === "build-week" ? "Building the family week…" : props.students.length > 1 ? "Build the family week" : "Build this week"}<ArrowRight size={13} /></button> : <Link href="/app/settings">Set up learners <ArrowRight size={13} /></Link>}</div>;

  const schedule = props.mode === "month" ? <CalendarMonthView anchorDate={props.selectedDate} selectedDate={props.selectedDate} currentDate={props.currentDate} scopeStudentId={props.scopeId} familyLearningDays={props.familyLearningDays} students={props.students} assignments={props.assignments} conflicts={props.conflicts} onSelectDate={props.setSelectedDate} onViewWeek={() => props.navigateRange("week", props.selectedDate)} onAddConflict={props.onAddConflict} onEditConflict={props.onEditConflict} /> : weekSchedule;

  const items: SpatialWorkspaceItem[] = [
    { id: "schedule", label: "Schedule", title: props.mode === "month" ? monthLabel(props.selectedDate) : weekRangeLabel(props.days), x: 650, y: 470, width: 1240, focusZoom: .9, minFocusZoom: .72, className: `spatial-week-schedule ${props.mode === "month" ? "spatial-month-schedule" : ""}`, children: schedule },
    ...(props.pendingReviews.length ? [{ id: "review", label: "Review ready", title: "Klio checked this work", x: 240, y: 540, width: 500, focusZoom: 1.02, className: "spatial-summary-object", children: <CanvasReview review={props.pendingReviews[0]} assignment={props.assignments.find((item) => item.id === props.pendingReviews[0].assignmentId)} submission={props.submissions.find((item) => item.id === props.pendingReviews[0].submissionId)} evidence={props.evidence} learnerName={props.students.find((student) => student.id === props.assignments.find((item) => item.id === props.pendingReviews[0].assignmentId)?.studentId)?.displayName} busy={props.busy === props.pendingReviews[0].id} onApprove={props.onApproveReview} /> }] : []),
    ...(recentApplied ? [{ id: `adjusted:${recentApplied.id}`, label: "Klio adjusted", title: recentApplied.summary, x: 1980, y: 500, width: 390, focusZoom: 1, className: "spatial-note-object", children: <AdjustmentNote proposal={recentApplied} busy={props.busy === recentApplied.id} onUndo={() => props.onDecide(recentApplied, "undo")} onAcknowledge={() => props.onAcknowledge(recentApplied)} /> }] : []),
    ...visibleInsights.map((insight, index) => {
      const presentation = buildScheduleDecisionPresentation(insight, props.assignments, props.students);
      const planningState = presentation ? scheduleDecisionProposalState(presentation, props.planningProposals) : null;
      const turnState = presentation && !planningState ? scheduleDecisionTurnState(presentation, props.activeAgentTurn) : null;
      return { id: `insight:${insight.id}`, label: planningState?.status === "proposed" ? "Schedule ready" : turnState === "working" ? "Klio is working" : turnState === "needs_input" ? "Klio needs one detail" : insightLabel(insight.kind), title: planningState?.status === "proposed" ? "A schedule change is ready" : turnState ? presentation?.workingTitle ?? insight.title : presentation?.title ?? insight.title, x: index === 0 ? 1980 : 240, y: 560 + index * 300, width: 390, focusZoom: 1, className: "spatial-note-object", children: <InsightNote insight={insight} assignments={props.assignments} students={props.students} proposals={props.proposals} planningProposals={props.planningProposals} activeAgentTurn={props.activeAgentTurn} busy={props.busy} onDecide={props.onDecide} onAcknowledge={props.onAcknowledge} onDismiss={props.onDismissInsight} onStartPractice={props.onStartPractice} onPracticeFollowUp={props.onPracticeFollowUp} onAskKlio={props.onAskKlio} /> };
    }),
    ...(visibleProposal ? [{ id: `adjustment:${visibleProposal.id}`, label: "Schedule ready", title: visibleProposal.summary, x: 1980, y: 910, width: 390, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note teacher-note-decision note-yellow"><span><RotateCcw size={15} />Needs your approval</span><strong>{visibleProposal.summary}</strong><small>This family policy asks before applying the change.</small><div className="teacher-note-actions"><button type="button" onClick={() => props.onDecide(visibleProposal, "approve")} disabled={props.busy === visibleProposal.id}><Check size={12} />{props.busy === visibleProposal.id ? "Applying…" : "Accept changes"}</button><Link href="/app/adjustments">Review <ArrowRight size={12} /></Link></div></div> }] : []),
    ...practices.map((practice, index) => {
      const practiceSession = props.practiceSessions.find((item) => item.artifactId === practice.id && ["ready", "in_progress"].includes(item.status));
      const practiceLearnerName = practice.studentId ? props.students.find((student) => student.id === practice.studentId)?.displayName : undefined;
      return { id: `practice:${practice.id}`, label: "Practice", title: `${practiceLearnerName ? `${practiceLearnerName} · ` : ""}${practice.title}`, x: 1980, y: 1110 + index * 320, width: 420, focusZoom: 1.02, className: "spatial-practice-object", children: <CanvasPractice familyId={props.familyId} artifact={practice} learnerName={practiceLearnerName} session={practiceSession} busy={props.busy === practice.id || props.busy === practiceSession?.id} onStart={props.onStartPractice} onDismiss={props.onDismissPractice} /> };
    }),
    ...(activeReminder ? [{ id: `reminder:${activeReminder.id}`, label: "Reminder", title: activeReminder.title, x: 240, y: 1180, width: 350, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note note-cream"><span><Clock3 size={15} />Reminder</span><strong>{activeReminder.title}</strong><small>{activeReminder.dueAt ? dueLabel(activeReminder.dueAt) : "No due date"}</small></div> }] : []),
    ...(focusedLesson && props.mode === "week" ? [{ id: "lesson", parentId: "schedule", label: "Lesson", title: focusedLesson.title, x: 1990, y: 390, width: 520, focusZoom: 1.05, hideLandmark: true, movable: false, persistPosition: false, className: "spatial-lesson-object", children: <LessonDetail assignment={focusedLesson} learnerName={props.students.find((student) => student.id === focusedLesson.studentId)?.displayName} review={props.pendingReviews.find((item) => item.assignmentId === focusedLesson.id)} submission={props.submissions.find((item) => item.assignmentId === focusedLesson.id)} evidence={props.evidence} busy={props.busy === focusedLesson.id || props.busy === props.pendingReviews.find((item) => item.assignmentId === focusedLesson.id)?.id} onUpdate={props.onUpdate} onSubmit={props.onSubmit} onAdjust={props.onAdjust} onStartPractice={props.onStartPractice} onApproveReview={props.onApproveReview} onAttentionSaved={props.onAttentionSaved} onAskKlio={props.onAskKlio} /> }] : []),
  ];

  const toolbar = <div className="spatial-canvas-toolbar spatial-day-toolbar spatial-calendar-toolbar">
    <div className="teacher-canvas-nav"><button type="button" onClick={() => props.navigateRange(props.mode, props.mode === "month" ? shiftMonth(props.selectedDate, -1) : addDays(props.days[0], -7))} aria-label={props.mode === "month" ? "Previous month" : "Previous week"} disabled={props.navigationPending}><ArrowLeft size={16} /></button><h1>{props.mode === "month" ? monthLabel(props.selectedDate) : weekRangeLabel(props.days)}</h1><button type="button" onClick={() => props.navigateRange(props.mode, props.mode === "month" ? shiftMonth(props.selectedDate, 1) : addDays(props.days[0], 7))} aria-label={props.mode === "month" ? "Next month" : "Next week"} disabled={props.navigationPending}><ArrowRight size={16} /></button></div>
    <div className="teacher-toolbar-actions teacher-week-actions"><div className="calendar-view-toggle" role="group" aria-label="Schedule view"><Link href={scheduleViewHref("today", props.selectedDate, props.scopeId)}>Today</Link><button type="button" aria-pressed={props.mode === "week"} onClick={() => props.navigateRange("week", props.selectedDate)} disabled={props.navigationPending}>Week</button><button type="button" aria-pressed={props.mode === "month"} onClick={() => props.navigateRange("month", props.selectedDate)} disabled={props.navigationPending}>Month</button></div><button type="button" className={`teacher-plan-next ${props.mode === "month" ? "calendar-action-placeholder" : ""}`} onClick={props.onBuildNextWeek} disabled={props.mode === "month" || props.busy === "build-week"} aria-hidden={props.mode === "month"} tabIndex={props.mode === "month" ? -1 : undefined}>{props.busy === "build-week" && props.mode === "week" ? "Planning…" : "Plan next week"}</button><label><span>View</span><select aria-label="View schedule for" value={props.scopeId} onChange={(event) => props.chooseLearner(event.target.value)} disabled={props.navigationPending}>{props.students.length > 1 ? <option value="all">Family</option> : null}{props.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div>
  </div>;

  const layout = props.workspaceLayouts.find((item) => item.surface === "week" && item.scopeKey === props.scopeId);
  return <SpatialWorkspace ariaLabel={`${props.mode === "month" ? "Monthly" : "Weekly"} homeschool teaching board`} persistenceKey={`${props.mode}:${props.scopeId}`} items={items} initialView={{ x: -415, y: -160, zoom: .76 }} overviewView={{ x: -25, y: -105, zoom: .48 }} homeItemId="schedule" focusRequest={focusedLesson && props.mode === "week" ? { id: "lesson", key: focusKey } : null} layoutPersistence={{ familyId: props.familyId, surface: "week", scopeKey: props.scopeId, layoutVersion: 2, positions: layout?.layoutVersion === 2 ? layout.positions : undefined }} onCameraChange={(camera: SpatialCameraState) => { if (camera.level !== "item" || camera.id !== "lesson") setFocusedLesson(null); }} toolbar={toolbar} briefing={props.briefing} assistant={<div className="spatial-assistant-surface">{props.capture}</div>} />;
}

function WeekItem({ item, onOpen }: { item: AssignmentDTO; onOpen: () => void }) {
  return <button type="button" draggable onDragStart={(event) => startAssignmentDrag(event, item)} className={`teacher-week-item subject-${subjectTone(item.subject)} ${item.sourceKind === "practice" ? "supplemental" : ""} ${item.status === "completed" ? "completed" : ""}`} onClick={onOpen}><span>{item.subject}</span><strong>{item.title}</strong><small>{item.sourceKind === "practice" ? "Practice · " : ""}{item.estimatedMinutes ?? 0} min</small><ParentSupportLabel assignment={item} />{item.status === "completed" ? <Check size={12} /> : null}</button>;
}

function WeekItems({ items, onOpen }: { items: AssignmentDTO[]; onOpen: (item: AssignmentDTO) => void }) {
  const active = items.filter((item) => item.status !== "completed");
  const completed = items.filter((item) => item.status === "completed");
  return <>{active.map((item) => <WeekItem item={item} onOpen={() => onOpen(item)} key={item.id} />)}{completed.length ? <details className="teacher-week-completed"><summary><Check size={12} />{completed.length} complete</summary><div>{completed.map((item) => <WeekItem item={item} onOpen={() => onOpen(item)} key={item.id} />)}</div></details> : null}</>;
}

function AssignmentRow({ item, busy, onUpdate, onSubmit, onAdjust }: { item: AssignmentDTO; busy: boolean; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust?: (item: AssignmentDTO) => void }) {
  return <motion.article layout className={`ops-assignment ${item.status}`}>
    <button type="button" className="assignment-state" onClick={() => onUpdate(item, item.status === "completed" ? "planned" : "completed")} disabled={busy} aria-label={item.status === "completed" ? `Reopen ${item.title}` : `Complete ${item.title}`}>{item.status === "completed" ? <Check size={15} /> : <span />}</button>
    <div><p><span>{item.subject}</span>{item.scheduledTime ? <small>{formatTime(item.scheduledTime)}</small> : null}{item.estimatedMinutes ? <small>{item.estimatedMinutes} min</small> : null}<ParentSupportLabel assignment={item} /></p><strong>{item.title}</strong>{item.instructions ? <em>{item.instructions}</em> : null}</div>
    <span className={`status-word ${item.status}`}>{statusLabel(item.status)}</span>
    <div className="assignment-actions">{item.status !== "needs_review" && item.status !== "submitted" ? <button type="button" onClick={() => onSubmit(item)}><FileCheck2 size={12} />Add work</button> : null}{onAdjust && (item.status === "planned" || item.status === "doing") ? <button type="button" onClick={() => onAdjust(item)} disabled={busy}><RotateCcw size={12} />Not finished</button> : null}</div>
  </motion.article>;
}

type MaterialSuggestionView = { id: string; status: string; evidence_id: string; proposed_title: string | null; proposed_kind: string | null; proposed_instructions: string | null; proposed_minutes: number | null; proposed_path: unknown; confidence: number | null; rationale: string | null; uncertainty_flags: unknown; error_code: string | null };
type MaterialView = { evidence_id: string; role: string; position: number; evidence_items: { title: string | null } | Array<{ title: string | null }> | null };

function CurriculumAssignmentRow(props: { familyId: string; item: AssignmentDTO; busy: boolean; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onApplied: (changes: Partial<AssignmentDTO>) => void }) {
  const [materials, setMaterials] = useState<MaterialView[]>([]);
  const [suggestions, setSuggestions] = useState<MaterialSuggestionView[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "uploading" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const historical = ["doing", "submitted", "needs_review", "completed", "skipped"].includes(props.item.status);
  const inputId = `material-${props.item.id}`;

  async function loadMaterials() {
    setState("loading");
    const response = await fetch(`/api/assignments/${props.item.id}/materials`);
    const result = await response.json() as { materials?: MaterialView[]; suggestions?: MaterialSuggestionView[]; error?: string };
    if (!response.ok) { setState("error"); setMessage(result.error ?? "Could not load material."); return; }
    setMaterials(result.materials ?? []); setSuggestions(result.suggestions ?? []); setState("idle");
  }
  async function upload(file: File) {
    setState("uploading"); setMessage(null);
    const body = new FormData();
    body.set("familyId", props.familyId); body.set("studentId", props.item.studentId); body.set("assignmentId", props.item.id); body.set("capturePurpose", "curriculum_material"); body.set("kind", "note"); body.append("file", file);
    const response = await fetch("/api/evidence", { method: "POST", body });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setState("error"); setMessage(result.error ?? "Could not attach material."); return; }
    setMessage("Material saved. Klio is preparing an optional suggestion.");
    await loadMaterials();
  }
  async function decide(suggestion: MaterialSuggestionView, action: "apply" | "dismiss" | "retry", form?: HTMLFormElement) {
    setState("saving"); setMessage(null);
    const data = form ? new FormData(form) : null;
    const edits = data ? { title: String(data.get("title") ?? ""), itemKind: String(data.get("itemKind") ?? "lesson"), instructions: String(data.get("instructions") ?? ""), minutes: Number(data.get("minutes")), path: String(data.get("path") ?? "").split("/").map((part) => part.trim()).filter(Boolean) } : undefined;
    const response = await fetch(`/api/assignments/${props.item.id}/materials`, { method: action === "retry" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "retry" ? { action, suggestionId: suggestion.id } : { action, suggestionId: suggestion.id, ...(action === "apply" ? { edits } : {}) }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setState("error"); setMessage(result.error ?? "Could not save that decision."); return; }
    if (action === "apply" && edits) props.onApplied({ title: edits.title, instructions: edits.instructions, estimatedMinutes: edits.minutes, curriculumItemKind: edits.itemKind, curriculumPath: edits.path, curriculumItemState: "enriched" });
    setMessage(action === "apply" ? historical ? "The source is attached; historical lesson details stayed unchanged." : "Suggestion applied to this stable lesson." : action === "dismiss" ? "Suggestion dismissed. The source remains attached." : "Extraction queued again.");
    await loadMaterials();
  }
  const latest = suggestions[0];
  return <section className={`curriculum-assignment-row ${state === "uploading" ? "uploading" : ""}`} onDragOver={(event) => { if (!historical || event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}>
    <AssignmentRow item={props.item} busy={props.busy} onUpdate={props.onUpdate} onSubmit={props.onSubmit} />
    <div className="curriculum-item-meta"><span>{props.item.sequenceNumber ? `#${props.item.sequenceNumber}` : "Unnumbered"}</span><span>{props.item.curriculumItemKind ?? "lesson"}</span><span>{props.item.curriculumItemState === "enriched" ? "Source-enriched" : "Generic"}</span>{Array.isArray(props.item.curriculumPath) && props.item.curriculumPath.length ? <span>{props.item.curriculumPath.join(" / ")}</span> : null}</div>
    <details onToggle={(event) => { if (event.currentTarget.open && state === "idle" && !materials.length && !suggestions.length) void loadMaterials(); }}><summary><FileUp size={12} />Add material{materials.length ? ` · ${materials.length} saved` : ""}</summary><div className="curriculum-material-panel">
      <label htmlFor={inputId} className="material-upload-button">{state === "uploading" ? "Saving material…" : "Choose a file"}</label><input id={inputId} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} disabled={state === "uploading"} /><small>Or drop a supported teacher source onto this lesson. This is curriculum material, not learner work.</small>
      {materials.map((material) => { const evidence = Array.isArray(material.evidence_items) ? material.evidence_items[0] : material.evidence_items; return <a href={`/api/evidence/${material.evidence_id}/download`} key={material.evidence_id}>{evidence?.title ?? "Saved source"}</a>; })}
      {latest?.status === "ready" ? historical ? <p>This lesson already has history. You can inspect or add sources, but Klio will not rewrite its identity.</p> : <form onSubmit={(event) => { event.preventDefault(); void decide(latest, "apply", event.currentTarget); }} className="material-suggestion"><span><Sparkles size={12} />Review Klio’s suggestion</span><label>Title<input name="title" defaultValue={latest.proposed_title ?? props.item.title} /></label><div className="field-pair"><label>Kind<select name="itemKind" defaultValue={latest.proposed_kind ?? "lesson"}><option>lesson</option><option>assessment</option><option>review</option><option>project</option><option>activity</option></select></label><label>Minutes<input name="minutes" type="number" min="5" max="480" defaultValue={latest.proposed_minutes ?? props.item.estimatedMinutes ?? 40} /></label></div><label>Path<input name="path" defaultValue={Array.isArray(latest.proposed_path) ? latest.proposed_path.join(" / ") : ""} /></label><label>Directions<textarea name="instructions" defaultValue={latest.proposed_instructions ?? ""} /></label>{latest.rationale ? <p>{latest.rationale}</p> : null}<div><button type="button" onClick={() => void decide(latest, "dismiss")}>Keep current lesson</button><button type="submit" disabled={state === "saving"}>{state === "saving" ? "Applying…" : "Apply suggestion"}</button></div></form> : null}
      {latest?.status === "failed" ? <p>Klio could not extract a suggestion ({latest.error_code?.toLowerCase().replaceAll("_", " ")}). The source is still saved. <button type="button" onClick={() => void decide(latest, "retry")}>Retry</button></p> : null}
      {latest && ["queued", "processing"].includes(latest.status) ? <p>Klio is preparing an optional suggestion. <button type="button" onClick={() => void loadMaterials()}>Check status</button></p> : null}
      {latest && ["applied", "dismissed"].includes(latest.status) ? <p>{latest.status === "applied" ? "Suggestion applied." : "Suggestion dismissed; source retained."}</p> : null}
      {message ? <p role={state === "error" ? "alert" : "status"}>{message}</p> : null}
    </div></details>
  </section>;
}

type ScopeSuggestionView = { id: string; status: string; source_kind: string; identity_status: string; source_urls: unknown; assumptions: unknown; proposed_target_count: number | null; pacing: CurriculumResearchResult["pacing"] | null; confidenceWording: string | null; error_code: string | null; diff: Array<{ sequenceNumber: number; beforeTitle: string | null; disposition: "safe" | "review" | "protected" | "append"; proposed: { title: string; kind: string; path: string[]; minutes?: number | null } }> };

function safeScopeSources(value: unknown) {
  if (!Array.isArray(value)) return [];
  const sources = new Map<string, { url: string; label: string; title: string }>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const url = (candidate as { url?: unknown }).url;
    const title = (candidate as { title?: unknown }).title;
    if (typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol)) continue;
      const label = parsed.hostname.replace(/^www\./, "");
      if (!sources.has(label)) sources.set(label, { url: parsed.toString(), label, title: typeof title === "string" && title.trim() ? title.trim() : label });
    } catch {
      // Parent-facing links are limited to valid HTTP(S) sources.
    }
  }
  return [...sources.values()].slice(0, 5);
}

function CourseScopePanel(props: { familyId: string; unit: CurriculumUnitDTO; onAddIdentity: () => void; setNotice: (value: string | null) => void; onChanged: () => void }) {
  const [suggestions, setSuggestions] = useState<ScopeSuggestionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pollState, setPollState] = useState({ unitId: props.unit.id, count: 0 });
  const pollCount = pollState.unitId === props.unit.id ? pollState.count : 0;
  const load = useCallback(async () => {
    const response = await fetch(`/api/curriculum/${props.unit.id}/scope-suggestions`);
    const result = await response.json() as { suggestions?: ScopeSuggestionView[] };
    if (response.ok) setSuggestions(result.suggestions ?? []);
  }, [props.unit.id]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/curriculum/${props.unit.id}/scope-suggestions`).then(async (response) => ({ response, result: await response.json() as { suggestions?: ScopeSuggestionView[] } })).then(({ response, result }) => {
      if (active && response.ok) setSuggestions(result.suggestions ?? []);
    });
    return () => { active = false; };
  }, [props.unit.id]);
  const waitingForSearch = suggestions.some((suggestion) => ["queued", "processing"].includes(suggestion.status));
  useEffect(() => {
    if (!waitingForSearch || pollCount >= 40) return;
    const timeout = window.setTimeout(() => {
      void load().finally(() => setPollState((current) => current.unitId === props.unit.id ? { ...current, count: current.count + 1 } : { unitId: props.unit.id, count: 1 }));
    }, 2_500);
    return () => window.clearTimeout(timeout);
  }, [load, pollCount, props.unit.id, waitingForSearch]);
  async function upload(file: File) {
    setBusy(true);
    const body = new FormData(); body.set("familyId", props.familyId); body.set("studentId", props.unit.studentId); body.set("curriculumUnitId", props.unit.id); body.set("capturePurpose", "curriculum_identity"); body.set("kind", "book"); body.append("file", file);
    const response = await fetch("/api/evidence", { method: "POST", body }); const result = await response.json() as { error?: string }; setBusy(false);
    if (!response.ok) return props.setNotice(result.error ?? "Could not attach that course source.");
    props.setNotice("Course source saved. Klio is preparing a source-grounded outline proposal."); await load();
  }
  async function decide(suggestion: ScopeSuggestionView, action: "apply" | "dismiss" | "retry", form?: HTMLFormElement) {
    setBusy(true);
    const data = form ? new FormData(form) : null;
    const compactPacingReview = suggestion.pacing?.sourceGranularity === "container";
    const selections = suggestion.diff.filter((item) => item.disposition !== "protected" && (compactPacingReview || !data || data.has(`include-${item.sequenceNumber}`))).map((item) => {
      if (!data || compactPacingReview) return { sequenceNumber: item.sequenceNumber };
      const minutes = String(data.get(`minutes-${item.sequenceNumber}`) ?? "").trim();
      return {
        sequenceNumber: item.sequenceNumber,
        title: String(data.get(`title-${item.sequenceNumber}`) ?? item.proposed.title),
        kind: String(data.get(`kind-${item.sequenceNumber}`) ?? item.proposed.kind),
        path: String(data.get(`path-${item.sequenceNumber}`) ?? "").split("/").map((part) => part.trim()).filter(Boolean),
        minutes: minutes ? Number(minutes) : null,
      };
    });
    const response = await fetch(`/api/curriculum/${props.unit.id}/scope-suggestions`, { method: action === "retry" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "apply" ? { action, suggestionId: suggestion.id, selections } : { action, suggestionId: suggestion.id }) });
    const result = await response.json() as { error?: string }; setBusy(false);
    if (!response.ok) return props.setNotice(result.error ?? "Could not save that outline decision.");
    if (action === "retry") setPollState({ unitId: props.unit.id, count: 0 });
    if (action === "apply" || action === "dismiss") setReviewOpen(false);
    props.setNotice(action === "apply" ? "Suggested outline applied to safe stable lessons." : action === "dismiss" ? "Generic lessons kept. The source remains available." : "Outline search queued again."); await load(); props.onChanged();
  }
  async function refreshResearch() {
    setBusy(true);
    const response = await fetch(`/api/curriculum/${props.unit.id}/scope-suggestions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
    const result = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) return props.setNotice(result.error ?? "Could not research that curriculum again.");
    setReviewOpen(false);
    setPollState({ unitId: props.unit.id, count: 0 });
    props.setNotice("Klio is researching this curriculum again with the latest course details.");
    await load();
  }
  const current = suggestions.find((suggestion) => suggestion.status === "ready")
    ?? suggestions.find((suggestion) => ["queued", "processing"].includes(suggestion.status))
    ?? suggestions.find((suggestion) => suggestion.status === "failed");
  const sources = safeScopeSources(current?.source_urls);
  const eligibleCount = current?.diff.filter((item) => item.disposition !== "protected").length ?? 0;
  const pacingSummary = current?.pacing?.sourceGranularity === "container" && current.pacing.containerCount
    ? `${current.pacing.containerCount} ${current.pacing.containerLabel?.toLowerCase() ?? "module"}s paced as ${current.proposed_target_count ?? eligibleCount} daily sessions`
    : `${eligibleCount} lesson updates`;
  const pacingDetail = current?.pacing?.recommendedWeekCount && current.pacing.recommendedWeeklyFrequency
    ? `${current.pacing.recommendedWeekCount} weeks · ${current.pacing.recommendedWeeklyFrequency}× per week${current.pacing.minutesPerSession ? ` · ${current.pacing.minutesPerSession} minutes` : ""}`
    : "Review Klio’s proposed titles before changing anything.";
  const compactPacingReview = current?.pacing?.sourceGranularity === "container";
  const moduleSummaries = current?.diff.reduce<Array<{ title: string; count: number }>>((summaries, item) => {
    const title = item.proposed.path[0];
    if (!title) return summaries;
    const existing = summaries.find((summary) => summary.title === title);
    if (existing) existing.count += 1;
    else summaries.push({ title, count: 1 });
    return summaries;
  }, []) ?? [];
  const inputId = `course-evidence-${props.unit.id}`;
  return <aside className="course-scope-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}>
    <div className="course-scope-summary"><strong>{props.unit.identityStatus === "verified" ? "Verified course identity" : props.unit.identityStatus === "recognized" ? "Recognized course · edition unverified" : "Generic annual scope"}</strong><p>{props.unit.identityStatus === "recognized" ? "The edition is not confirmed, so any outline is a starting point—not an exact publisher map." : `${props.unit.targetLessonCount} stable lessons are ready without scheduling the year.`}</p>{current?.confidenceWording ? <small>{current.confidenceWording}</small> : null}{Array.isArray(current?.assumptions) && current.assumptions.length ? <small className="course-scope-assumptions">{current.assumptions.join(" ")}</small> : null}{sources.length ? <nav className="course-scope-sources" aria-label="Sources Klio used"><small>Sources Klio used</small><div>{sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" title={source.title} aria-label={`${source.title} — ${source.label}`} key={source.url}>{source.label}</a>)}</div></nav> : null}</div>
    <div className="course-scope-actions"><label htmlFor={inputId}><FileUp size={12} />{busy ? "Saving…" : "Add course source"}</label><input id={inputId} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} disabled={busy} /><button type="button" onClick={props.onAddIdentity}>Add edition or ISBN</button><button type="button" onClick={() => void refreshResearch()} disabled={busy || waitingForSearch}>{waitingForSearch ? "Researching…" : "Research again"}</button></div>
    {current?.status === "ready" && current.diff.length ? <div className="course-scope-review-callout"><div><Sparkles size={16} /><p><strong>{pacingSummary} are ready</strong><small>{pacingDetail}</small></p></div><button type="button" onClick={() => setReviewOpen(true)}>Review outline</button></div> : null}
    {current?.status === "ready" && !current.diff.length ? <div className="course-scope-empty"><p>Klio did not find enough reliable table-of-contents detail to rename these lessons.</p><button type="button" onClick={() => void decide(current, "dismiss")} disabled={busy}>Keep generic lessons</button></div> : null}
    {current?.status === "failed" ? <p className="course-scope-state">The outline could not be prepared ({current.error_code?.toLowerCase().replaceAll("_", " ")}). <button type="button" onClick={() => void decide(current, "retry")}>Retry</button></p> : null}
    {current && ["queued", "processing"].includes(current.status) ? <p className="course-scope-state">Klio is searching for a matching table of contents. This page will update automatically. <button type="button" onClick={() => void load()}>Check now</button></p> : null}
    <AnimatePresence>{reviewOpen && current?.status === "ready" && current.diff.length ? <motion.div className="scope-review-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setReviewOpen(false)}>
      <motion.form className="scope-review-dialog course-scope-diff" role="dialog" aria-modal="true" aria-labelledby={`scope-review-title-${props.unit.id}`} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void decide(current, "apply", event.currentTarget); }} initial={{ opacity: 0, y: 18, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .99 }} transition={{ duration: .18 }}>
        <header><div><span>Curriculum outline</span><strong id={`scope-review-title-${props.unit.id}`}>Review proposed daily work</strong><small>{current.pacing?.sourceGranularity === "container" ? `${current.pacing.containerCount} ${current.pacing.containerLabel?.toLowerCase() ?? "module"}s stay organized as the course hierarchy; these rows are the sessions Klio schedules.` : "Select only the rows you want. Lessons with history stay unchanged."}</small></div><div className="scope-review-heading-actions"><span>{eligibleCount} eligible</span><button type="button" onClick={() => setReviewOpen(false)} aria-label="Close outline review"><X size={18} /></button></div></header>
        {compactPacingReview ? <div className="course-pacing-review">
          <section className="course-pacing-metrics" aria-label="Proposed course pacing"><div><span>Course structure</span><strong>{current.pacing?.containerCount} {current.pacing?.containerLabel?.toLowerCase()}s</strong></div><div><span>Daily work</span><strong>{current.proposed_target_count} sessions</strong></div><div><span>School year</span><strong>{current.pacing?.recommendedWeekCount} weeks</strong></div><div><span>Weekly rhythm</span><strong>{current.pacing?.recommendedWeeklyFrequency}× · {current.pacing?.minutesPerSession ?? props.unit.defaultMinutes} min</strong></div></section>
          <div className="course-pacing-modules" aria-label="Module session distribution">{moduleSummaries.map((module, index) => <div key={module.title}><span>{String(index + 1).padStart(2, "0")}</span><strong>{module.title.replace(/^(module|chapter|unit|week)\s+\d+\s*:\s*/i, "")}</strong><small>{module.count} sessions</small></div>)}</div>
          <p>These are pacing placeholders organized under the publisher’s module titles. Upload the publisher’s daily schedule later to replace “Session 1” with exact reading, lab, review, and test work.</p>
        </div> : <div className="course-scope-diff-list">{current.diff.map((item) => <fieldset key={item.sequenceNumber} disabled={item.disposition === "protected" || busy}>
          <label className="course-scope-select"><input type="checkbox" name={`include-${item.sequenceNumber}`} defaultChecked={item.disposition !== "protected"} /><span>{current.pacing?.sourceGranularity === "container" ? "Session" : "Lesson"} {item.sequenceNumber}</span><small>{item.disposition === "protected" ? "Protected history" : item.disposition === "review" ? "Scheduled or enriched · review" : item.disposition === "append" ? "New stable session" : "Safe placeholder"}</small></label>
          <div className="course-scope-before"><span>Current</span><p>{item.beforeTitle ?? "Not created yet"}</p></div>
          <div className="course-scope-after"><label>Suggested title<input name={`title-${item.sequenceNumber}`} defaultValue={item.proposed.title} /></label><label>Kind<select name={`kind-${item.sequenceNumber}`} defaultValue={item.proposed.kind}><option>lesson</option><option>assessment</option><option>review</option><option>project</option><option>activity</option></select></label><label>Minutes<input name={`minutes-${item.sequenceNumber}`} type="number" min="5" max="480" defaultValue={item.proposed.minutes ?? ""} /></label><label>Path<input name={`path-${item.sequenceNumber}`} defaultValue={item.proposed.path.join(" / ")} /></label></div>
        </fieldset>)}</div>}
        <footer><button type="button" onClick={() => void decide(current, "dismiss")} disabled={busy}>Keep generic lessons</button><button type="submit" disabled={busy}>{busy ? "Applying…" : compactPacingReview ? `Use ${current.pacing?.recommendedWeekCount}-week schedule` : "Use suggested outline"}</button></footer>
      </motion.form>
    </motion.div> : null}</AnimatePresence>
  </aside>;
}

const DEFAULT_LESSONS_PER_DASHBOARD_PAGE = 4;

function AssignmentsSurface(props: { familyId: string; studentId: string; selectedUnitId: string | null; nextCursor: string | null; navigationPending: boolean; navigate: (href: string) => void; students: StudentDTO[]; enabledWeekdays: number[]; units: CurriculumUnitDTO[]; assignments: AssignmentDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; showCurriculum: boolean; setShowCurriculum: (value: boolean) => void; onSubmit: (item: AssignmentDTO) => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => Promise<boolean> }) {
  const router = useRouter();
  const isFamilyView = props.studentId === "all";
  const [draftUnit, setDraftUnit] = useState<CurriculumUnitDTO | null>(null);
  const [frequencyOverrides, setFrequencyOverrides] = useState<Record<string, number>>({});
  const [visibleAssignments, setVisibleAssignments] = useState(() => dedupeAssignmentsById(props.assignments));
  const [statusOverrides, setStatusOverrides] = useState<Record<string, AssignmentDTO["status"]>>({});
  const [nextCursor, setNextCursor] = useState(props.nextCursor);
  const [pageState, setPageState] = useState<"idle" | "loading" | "error">("idle");
  const [lessonPage, setLessonPage] = useState(0);
  const [lessonsPerPage, setLessonsPerPage] = useState(DEFAULT_LESSONS_PER_DASHBOARD_PAGE);
  const [curriculumResearch, setCurriculumResearch] = useState<CurriculumResearchResult | null>(null);
  const [researchState, setResearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [researchMessage, setResearchMessage] = useState<string | null>(null);
  const [researchMode, setResearchMode] = useState<"detected" | "generic">("generic");
  const [scopeDraft, setScopeDraft] = useState({ sequenceLabel: "Lesson", targetLessonCount: 100 });
  const [rhythmDraft, setRhythmDraft] = useState({ weeklyFrequency: 5, estimatedMinutes: 40 });
  const selectedUnit = props.units.find((unit) => unit.id === props.selectedUnitId) ?? null;
  const displayedAssignments = reconcileAssignmentPage(visibleAssignments, props.assignments).map((item) => statusOverrides[item.id] ? { ...item, status: statusOverrides[item.id] } : item);
  const lessonStart = lessonPage * lessonsPerPage;
  const lessonsForPage = displayedAssignments.slice(lessonStart, lessonStart + lessonsPerPage);
  const hasNextLessonPage = lessonStart + lessonsPerPage < displayedAssignments.length || Boolean(nextCursor);
  useEffect(() => {
    const fitDashboard = () => {
      const nextPageSize = window.innerHeight < 840 ? 2 : window.innerHeight < 1_120 ? 3 : 5;
      setLessonsPerPage(nextPageSize);
      setLessonPage(0);
    };
    fitDashboard();
    window.addEventListener("resize", fitDashboard);
    return () => window.removeEventListener("resize", fitDashboard);
  }, []);
  function openCurriculum(unit: CurriculumUnitDTO | null) {
    setDraftUnit(unit);
    setCurriculumResearch(null);
    setResearchState("idle");
    setResearchMessage(null);
    setResearchMode("generic");
    setScopeDraft({ sequenceLabel: unit?.sequenceLabel ?? "Lesson", targetLessonCount: unit?.targetLessonCount ?? 100 });
    setRhythmDraft({ weeklyFrequency: Math.min(unit?.weeklyFrequency ?? 5, Math.max(1, props.enabledWeekdays.length)), estimatedMinutes: unit?.defaultMinutes ?? 40 });
    props.setShowCurriculum(true);
  }
  function closeCurriculum() { props.setShowCurriculum(false); setDraftUnit(null); setCurriculumResearch(null); setResearchState("idle"); setResearchMessage(null); }
  function selectUnit(unit: CurriculumUnitDTO) { props.navigate(assignmentsViewHref(props.studentId, unit.id)); }
  async function loadMore() {
    if (!selectedUnit || !nextCursor || pageState === "loading") return false;
    setPageState("loading");
    const params = new URLSearchParams({ familyId: props.familyId, curriculumUnitId: selectedUnit.id, cursor: nextCursor, limit: "50" });
    try {
      const response = await fetch(`/api/assignments?${params.toString()}`);
      const result = await response.json() as { assignments?: AssignmentDTO[]; nextCursor?: string | null; error?: string };
      if (!response.ok || !result.assignments || !("nextCursor" in result)) throw new Error(result.error ?? "Klio could not load more lessons.");
      setVisibleAssignments((current) => dedupeAssignmentsById([...reconcileAssignmentPage(current, props.assignments), ...result.assignments!]));
      setNextCursor(result.nextCursor ?? null);
      setPageState("idle");
      return result.assignments.length > 0;
    } catch {
      setPageState("error");
      return false;
    }
  }
  async function showNextLessonPage() {
    const nextStart = (lessonPage + 1) * lessonsPerPage;
    if (nextStart < displayedAssignments.length) return setLessonPage((current) => current + 1);
    if (await loadMore()) setLessonPage((current) => current + 1);
  }
  async function updateCourseAssignment(item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") {
    setStatusOverrides((current) => ({ ...current, [item.id]: status }));
    const saved = await props.onUpdate(item, status);
    if (!saved) setStatusOverrides((current) => { const next = { ...current }; delete next[item.id]; return next; });
  }
  async function researchCurriculum(form: HTMLFormElement) {
    const data = new FormData(form);
    data.set("familyId", props.familyId);
    setResearchState("loading");
    setResearchMessage(null);
    const response = await fetch("/api/curriculum/research", { method: "POST", body: data });
    const result = await response.json() as { research?: CurriculumResearchResult; error?: string };
    if (!response.ok || !result.research) {
      setResearchState("error");
      setResearchMessage(result.error ?? "Klio could not research that curriculum.");
      return;
    }
    const research = result.research;
    const detectedCount = research.structure.detectedItemCount;
    setCurriculumResearch(research);
    setResearchState("ready");
    if (detectedCount) {
      setResearchMode("detected");
      setScopeDraft({ sequenceLabel: research.structure.sequenceLabel, targetLessonCount: detectedCount });
      setRhythmDraft((current) => ({ weeklyFrequency: Math.min(research.pacing.recommendedWeeklyFrequency ?? current.weeklyFrequency, Math.max(1, props.enabledWeekdays.length)), estimatedMinutes: research.pacing.minutesPerSession ?? current.estimatedMinutes }));
      setResearchMessage(research.structure.expandedFromContainers ? `Klio found ${research.structure.containerCount} ${research.structure.containerLabel?.toLowerCase() ?? "module"}s and a source-supported ${detectedCount}-session annual pace.` : `Klio found a source-supported ${detectedCount}-${research.structure.sequenceLabel.toLowerCase()} outline. Confirm how you want to plan it.`);
    } else {
      setResearchMode("generic");
      setScopeDraft({ sequenceLabel: "Lesson", targetLessonCount: 100 });
      setResearchMessage("Klio found the course, but not a complete schedulable outline. The 100-lesson starting scope is selected.");
    }
  }
  function chooseResearchMode(mode: "detected" | "generic") {
    setResearchMode(mode);
    if (mode === "detected" && curriculumResearch?.structure.detectedItemCount) {
      setScopeDraft({ sequenceLabel: curriculumResearch.structure.sequenceLabel, targetLessonCount: curriculumResearch.structure.detectedItemCount });
      setRhythmDraft((current) => ({ weeklyFrequency: Math.min(curriculumResearch.pacing.recommendedWeeklyFrequency ?? current.weeklyFrequency, Math.max(1, props.enabledWeekdays.length)), estimatedMinutes: curriculumResearch.pacing.minutesPerSession ?? current.estimatedMinutes }));
    } else {
      setScopeDraft({ sequenceLabel: "Lesson", targetLessonCount: 100 });
    }
  }
  async function addCurriculum(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); props.setBusy("curriculum");
    const response = await fetch("/api/curriculum", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ curriculumUnitId: draftUnit?.id ?? null, familyId: props.familyId, studentId: draftUnit?.studentId ?? props.studentId, subject: data.get("subject"), title: data.get("title"), sequenceLabel: data.get("sequenceLabel"), targetLessonCount: Number(data.get("targetLessonCount")), estimatedMinutes: Number(data.get("estimatedMinutes")), weeklyFrequency: Number(data.get("weeklyFrequency")), attentionMode: data.get("attentionMode"), parentAttentionMinutes: data.get("attentionMode") === "flexible" ? Number(data.get("parentAttentionMinutes")) : null, curriculumUrl: data.get("curriculumUrl") || null, publisher: data.get("publisher") || null, productName: data.get("productName") || null, gradeLabel: data.get("gradeLabel") || null, editionLabel: data.get("editionLabel") || null, isbn: data.get("isbn") || null, research: !draftUnit && curriculumResearch ? { result: curriculumResearch, mode: researchMode } : null }) });
    const result = await response.json() as { assignmentCount?: number; scheduledCount?: number; unit?: { id: string; subject: string; sequence_label?: string }; error?: string }; props.setBusy(null);
    if (!response.ok) return props.setNotice(result.error ?? "Klio could not add that curriculum.");
    if (!result.unit || typeof result.assignmentCount !== "number") return props.setNotice("Klio could not confirm the curriculum that was added.");
    const createdItemLabel = curriculumResearch?.structure.expandedFromContainers ? "daily sessions" : `${scopeDraft.sequenceLabel.toLowerCase()}${result.assignmentCount === 1 ? "" : "s"}`;
    closeCurriculum(); props.setNotice(`${result.assignmentCount} unscheduled ${result.unit.subject} ${createdItemLabel} are ready. Plan the week when you’re ready.`);
    if (selectedUnit?.id === result.unit.id) router.refresh();
    else props.navigate(assignmentsViewHref(props.studentId, result.unit.id));
    form.reset();
  }
  async function updateFrequency(unit: CurriculumUnitDTO, weeklyFrequency: number) {
    props.setBusy(`rhythm-${unit.id}`); props.setNotice(null);
    const response = await fetch(`/api/curriculum/${unit.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ weeklyFrequency }) });
    const result = await response.json(); props.setBusy(null);
    if (!response.ok) return props.setNotice(result.error ?? "Klio could not save that teaching rhythm.");
    setFrequencyOverrides((current) => ({ ...current, [unit.id]: weeklyFrequency }));
    props.setNotice(`${unit.subject} will be taught ${weeklyFrequency} ${weeklyFrequency === 1 ? "time" : "times"} per week.`); router.refresh();
  }
  return <div className="assignments-layout assignments-dashboard">
    <aside className="curriculum-index"><header><span>Curriculum</span>{!isFamilyView ? <button type="button" onClick={() => openCurriculum(null)}><Plus size={13} />Add once</button> : null}</header>{props.units.length ? props.units.map((unit) => {
      const active = selectedUnit?.id === unit.id;
      return <section className={active ? "active" : ""} key={unit.id}>
        <p>{isFamilyView ? `${props.students.find((student) => student.id === unit.studentId)?.displayName ?? "Learner"} · ${unit.subject}` : unit.subject}</p>
        <button className="curriculum-unit-select" type="button" onClick={() => selectUnit(unit)} disabled={props.navigationPending} aria-current={active ? "page" : undefined}>{unit.title}<ChevronRight size={11} /></button>
        {active ? <div className="curriculum-unit-detail">
          <label className="curriculum-rhythm"><span>Teach</span><select aria-label={`${unit.subject} times per week`} value={frequencyOverrides[unit.id] ?? unit.weeklyFrequency} onChange={(event) => void updateFrequency(unit, Number(event.target.value))} disabled={props.busy === `rhythm-${unit.id}`}>{[1,2,3,4,5,6,7].map((frequency) => <option value={frequency} key={frequency}>{frequency}× / week</option>)}</select></label>
          <span>{unit.identityStatus === "verified" ? "Edition verified" : unit.identityStatus === "recognized" ? "Publisher recognized · edition unverified" : "Generic scope"}</span>
          <span>{unit.assignmentCount ? `${unit.completedCount} of ${unit.assignmentCount} completed` : "Ready for Klio to plan"}</span>
          <i><b style={{ width: `${unit.assignmentCount ? unit.completedCount / unit.assignmentCount * 100 : 0}%` }} /></i>
          <button type="button" onClick={() => openCurriculum(unit)}>Edit course details<ChevronRight size={11} /></button>
        </div> : null}
      </section>;
    }) : <div className="curriculum-empty"><strong>Add each curriculum once.</strong><span>Klio creates the numbered assignments and keeps their order when the week changes.</span></div>}</aside>
    <main className="assignment-library">
      <header><div><span>{selectedUnit ? `${isFamilyView ? `${props.students.find((student) => student.id === selectedUnit.studentId)?.displayName ?? "Learner"} · ` : ""}${selectedUnit.subject}` : "Other work"}</span><strong>{selectedUnit?.title ?? "Choose a curriculum"}</strong>{selectedUnit ? <small>{selectedUnit.assignmentCount} lessons · {selectedUnit.completedCount} completed · {selectedUnit.activeCount} active</small> : null}</div>{!isFamilyView ? <button type="button" onClick={() => openCurriculum(null)}><Plus size={16} />Add curriculum</button> : null}</header>
      {selectedUnit ? <CourseScopePanel familyId={props.familyId} unit={selectedUnit} onAddIdentity={() => openCurriculum(selectedUnit)} setNotice={props.setNotice} onChanged={() => router.refresh()} /> : null}
      <section className="lesson-dashboard" aria-label="Course lessons">
        <header><div><span>Lesson plan</span><strong>{selectedUnit ? `${lessonStart + (lessonsForPage.length ? 1 : 0)}–${lessonStart + lessonsForPage.length} of ${selectedUnit.assignmentCount}` : `${displayedAssignments.length} lessons`}</strong></div><nav aria-label="Lesson pages"><button type="button" onClick={() => setLessonPage((current) => Math.max(0, current - 1))} disabled={lessonPage === 0 || pageState === "loading"} aria-label="Previous lessons"><ArrowLeft size={16} /></button><span>Page {lessonPage + 1}</span><button type="button" onClick={() => void showNextLessonPage()} disabled={!hasNextLessonPage || pageState === "loading"} aria-label="Next lessons">{pageState === "loading" ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}</button></nav></header>
        {pageState === "error" ? <div className="lesson-dashboard-error" role="alert"><span>Klio could not load the next lessons. Everything already loaded is still here.</span><button type="button" onClick={() => void showNextLessonPage()}>Try again</button></div> : null}
        <div className="lesson-dashboard-list">{lessonsForPage.map((item) => <CurriculumAssignmentRow familyId={props.familyId} item={item} busy={props.busy === item.id} onUpdate={(assignment, status) => void updateCourseAssignment(assignment, status)} onSubmit={props.onSubmit} onApplied={(changes) => setVisibleAssignments((current) => current.map((assignment) => assignment.id === item.id ? { ...assignment, ...changes } : assignment))} key={item.id} />)}</div>
      </section>
    </main>
    <AnimatePresence>{props.showCurriculum ? <motion.form key={draftUnit?.id ?? "new"} className="curriculum-drawer" onSubmit={addCurriculum} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}>
      <header><div><span>{draftUnit ? "Course details" : "Smart curriculum setup"}</span><h2>{draftUnit ? "Update the annual scope" : "Let Klio read the course first"}</h2><p>{draftUnit ? "Change the stable annual scope without disturbing completed work." : "Add whatever you have. Klio researches the structure before creating assignments."}</p></div><button type="button" onClick={closeCurriculum} aria-label="Close"><X size={17} /></button></header>
      <div className="curriculum-fields">
        <label><span>Curriculum or course</span><input name="title" required placeholder="Algebra I" defaultValue={draftUnit?.title ?? ""} /></label>
        <label><span>Subject</span><input name="subject" required placeholder="Math" defaultValue={draftUnit?.subject ?? ""} /></label>
        <details className="curriculum-identity-fields" open={!draftUnit}><summary>Book, publisher, or edition details</summary><div className="field-pair"><label><span>Publisher</span><input name="publisher" maxLength={120} defaultValue={draftUnit?.publisher ?? ""} /></label><label><span>Product</span><input name="productName" maxLength={200} defaultValue={draftUnit?.productName ?? ""} /></label><label><span>Grade / level</span><input name="gradeLabel" maxLength={80} defaultValue={draftUnit?.gradeLabel ?? ""} /></label><label><span>Edition or year</span><input name="editionLabel" maxLength={120} defaultValue={draftUnit?.editionLabel ?? ""} /></label><label><span>ISBN</span><input name="isbn" maxLength={32} defaultValue={draftUnit?.isbn ?? ""} /></label><label><span>Reference link</span><input name="curriculumUrl" type="url" placeholder="Publisher or product page" defaultValue={draftUnit?.curriculumUrl ?? ""} /></label></div></details>
        {!draftUnit ? <section className="curriculum-research-step" aria-labelledby="curriculum-research-title">
          <header><div><span>Before assignments are created</span><strong id="curriculum-research-title">Research the curriculum</strong><small>Name, ISBN, link, or a source file is enough to start.</small></div><Sparkles size={17} /></header>
          <label className="curriculum-source-drop"><FileUp size={18} /><span><strong>Add a cover or table of contents</strong><small>Optional JPG, PNG, WebP, or PDF · 20 MB maximum</small></span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
          <button type="button" className="curriculum-research-button" onClick={(event) => { const form = event.currentTarget.form; if (form) void researchCurriculum(form); }} disabled={researchState === "loading"}>{researchState === "loading" ? <><LoaderCircle size={15} className="spin" />Klio is reading and searching…</> : curriculumResearch ? "Research again" : "Research before creating"}</button>
          {researchState === "loading" ? <div className="curriculum-research-loading" aria-hidden="true"><i /><i /><i /></div> : null}
          {researchMessage ? <p className={`curriculum-research-message ${researchState}`} role={researchState === "error" ? "alert" : "status"}>{researchMessage}</p> : null}
          {curriculumResearch ? <motion.div className="curriculum-research-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <header><div><span>Klio found</span><strong>{curriculumResearch.structure.detectedItemCount ? curriculumResearch.structure.expandedFromContainers ? `${curriculumResearch.structure.detectedItemCount} daily sessions` : `${curriculumResearch.structure.detectedItemCount} ${curriculumResearch.structure.sequenceLabel.toLowerCase()}${curriculumResearch.structure.detectedItemCount === 1 ? "" : "s"}` : "Course identity only"}</strong></div><small>{Math.round(curriculumResearch.proposal.confidence * 100)}% source confidence</small></header>
            {curriculumResearch.structure.expandedFromContainers ? <p><strong>{curriculumResearch.structure.containerCount} {curriculumResearch.structure.containerLabel?.toLowerCase()}s</strong> organize the course · {curriculumResearch.pacing.recommendedWeekCount} weeks · {curriculumResearch.pacing.recommendedWeeklyFrequency}× per week{curriculumResearch.pacing.minutesPerSession ? ` · ${curriculumResearch.pacing.minutesPerSession} minutes` : ""}</p> : null}
            {curriculumResearch.proposal.assumptions.length ? <p>{curriculumResearch.proposal.assumptions.slice(0, 2).join(" ")}</p> : null}
            {safeScopeSources(curriculumResearch.sources).length ? <div className="curriculum-research-sources">{safeScopeSources(curriculumResearch.sources).map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}</a>)}</div> : null}
            <fieldset><legend>How should Klio build this course?</legend>
              {curriculumResearch.structure.detectedItemCount ? <label className={researchMode === "detected" ? "selected" : ""}><input type="radio" name="researchMode" value="detected" checked={researchMode === "detected"} onChange={() => chooseResearchMode("detected")} /><span><strong>{curriculumResearch.structure.expandedFromContainers ? `Use ${curriculumResearch.structure.detectedItemCount} daily sessions` : `Use ${curriculumResearch.structure.detectedItemCount} ${curriculumResearch.structure.sequenceLabel.toLowerCase()}s`}</strong><small>{curriculumResearch.structure.expandedFromContainers ? `Keep the ${curriculumResearch.structure.containerCount} ${curriculumResearch.structure.containerLabel?.toLowerCase()}s as hierarchy and schedule the publisher-supported pace.` : "Create the source-supported outline with its actual titles."}</small></span><Check size={15} /></label> : null}
              <label className={researchMode === "generic" ? "selected" : ""}><input type="radio" name="researchMode" value="generic" checked={researchMode === "generic"} onChange={() => chooseResearchMode("generic")} /><span><strong>Start with 100 generic lessons</strong><small>Use this when the source shows broad units but not daily work.</small></span><Check size={15} /></label>
            </fieldset>
          </motion.div> : null}
        </section> : null}
        <section className="curriculum-plan-fields"><header><span>{draftUnit ? "Annual scope" : "Confirmed plan"}</span><small>{curriculumResearch ? "Based on your choice above; you can still edit it." : "No research required—100 lessons remains the safe starting point."}</small></header>
          <div className="field-pair"><label><span>Numbering</span><select name="sequenceLabel" value={scopeDraft.sequenceLabel} onChange={(event) => setScopeDraft((current) => ({ ...current, sequenceLabel: event.target.value }))}><option>Lesson</option><option>Unit</option><option>Chapter</option><option>Module</option><option>Week</option></select></label><label><span>Items this school year</span><input name="targetLessonCount" type="number" min="1" max="500" value={scopeDraft.targetLessonCount} onChange={(event) => setScopeDraft((current) => ({ ...current, targetLessonCount: Number(event.target.value) }))} required /></label></div>
        </section>
        <div className="field-pair"><label><span>Times per week</span><select name="weeklyFrequency" value={rhythmDraft.weeklyFrequency} onChange={(event) => setRhythmDraft((current) => ({ ...current, weeklyFrequency: Number(event.target.value) }))}>{Array.from({ length: Math.max(1, props.enabledWeekdays.length) }, (_, index) => index + 1).map((frequency) => <option value={frequency} key={frequency}>{frequency}× per week</option>)}</select></label><label><span>Typical minutes</span><input name="estimatedMinutes" type="number" min="5" max="480" value={rhythmDraft.estimatedMinutes} onChange={(event) => setRhythmDraft((current) => ({ ...current, estimatedMinutes: Number(event.target.value) }))} required /></label></div>
        <label><span>Parent support</span><select name="attentionMode" defaultValue={draftUnit?.attentionMode ?? "unspecified"}><option value="unspecified">Not decided</option><option value="parent_led">Needs me</option><option value="independent">Independent</option><option value="flexible">Start together</option></select></label>
        <label><span>Minutes together (for Start together)</span><input name="parentAttentionMinutes" type="number" min="1" max="480" defaultValue={draftUnit?.parentAttentionMinutes ?? 10} /></label>
      </div>
      <footer><button type="button" onClick={closeCurriculum}>Cancel</button><button type="submit" disabled={props.busy === "curriculum" || researchState === "loading"}>{props.busy === "curriculum" ? "Saving…" : draftUnit ? "Save course" : curriculumResearch ? curriculumResearch.structure.expandedFromContainers ? `Create ${scopeDraft.targetLessonCount} daily sessions` : `Create ${scopeDraft.targetLessonCount} ${scopeDraft.sequenceLabel.toLowerCase()}${scopeDraft.targetLessonCount === 1 ? "" : "s"}` : "Create 100-lesson course"}</button></footer>
    </motion.form> : null}</AnimatePresence>
  </div>;
}

function ReviewSurface(props: { assignments: AssignmentDTO[]; students: StudentDTO[]; reviews: AssignmentReviewDTO[]; submissions: SubmissionDTO[]; legacyCount: number; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void }) {
  const router = useRouter();
  async function decide(form: HTMLFormElement, review: AssignmentReviewDTO, decision: "approve" | "reject") {
    const data = new FormData(form); props.setBusy(review.id);
    const scoreValue = data.get("score"); const response = await fetch(`/api/assignment-reviews/${review.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, score: scoreValue === "" ? null : Number(scoreValue), scoreLabel: data.get("scoreLabel") || null, feedback: data.get("feedback") || "", rubric: reviewRubric(review.rubric), masterySignals: reviewMasterySignals(review.masterySignals) }) });
    const result = await response.json(); props.setBusy(null);
    if (!response.ok) return props.setNotice(result.error ?? "Klio could not save that review.");
    props.setNotice(decision === "approve" ? "Klio’s review was approved and added to the learning record." : "Submission returned without recording a grade."); router.refresh();
  }
  async function redraft(review: AssignmentReviewDTO) {
    props.setBusy(`draft-${review.id}`);
    const response = await fetch(`/api/assignment-reviews/${review.id}/draft`, { method: "POST" });
    const result = await response.json();
    props.setBusy(null);
    if (!response.ok) return props.setNotice(result.error ?? "Klio could not review that work yet.");
    props.setNotice("Klio reviewed the submitted work. Give the draft a quick check.");
    router.refresh();
  }
  if (!props.reviews.length) return <div className="review-empty"><ClipboardCheck size={28} /><span>Review & grades</span><h2>No submitted work is waiting.</h2><p>Scores and attached work appear here when you want Klio to draft feedback. Completion notes simply update the week.</p>{props.legacyCount ? <Link href="/app/activity">Review {props.legacyCount} Klio suggestion{props.legacyCount === 1 ? "" : "s"} <ArrowRight size={13} /></Link> : <Link href="/app/assignments">View assignments <ArrowRight size={13} /></Link>}</div>;
  return <div className="review-queue"><header><span>{props.reviews.length} ready to check</span><p>Klio reviewed each submitted source. Approve the draft or make a quick edit.</p>{props.legacyCount ? <Link href="/app/activity">{props.legacyCount} other Klio suggestion{props.legacyCount === 1 ? "" : "s"} <ArrowRight size={12} /></Link> : null}</header>{props.reviews.map((review) => { const assignment = props.assignments.find((item) => item.id === review.assignmentId); const submission = props.submissions.find((item) => item.id === review.submissionId); if (!assignment) return null; const rubric = reviewRubric(review.rubric); const mastery = reviewMasterySignals(review.masterySignals); const hasDraft = review.draftScore !== null || rubric.length > 0 || mastery.length > 0; const learnerName = props.students.find((student) => student.id === assignment.studentId)?.displayName; return <form onSubmit={(event) => { event.preventDefault(); void decide(event.currentTarget, review, "approve"); }} className="grade-review" key={review.id}><header><div><span>{learnerName ? `${learnerName} · ${assignment.subject}` : assignment.subject}</span><h2>{assignment.title}</h2><p>Submitted {submission ? shortDate(submission.submittedAt.slice(0,10)) : "recently"}{submission?.evidenceIds.length ? ` · ${submission.evidenceIds.length} source file${submission.evidenceIds.length === 1 ? "" : "s"}` : ""}</p></div><span className="draft-mark"><Sparkles size={12} />{hasDraft ? "Reviewed by Klio" : "Needs a quick check"}</span></header><div className="grade-review-body"><label className="score-field"><span>Klio’s suggested score</span><div><input aria-label="Klio’s suggested score %" name="score" type="number" min="0" max="100" step="0.1" defaultValue={review.draftScore ?? ""} placeholder="—" /><b>%</b></div></label><label><span>Grade label</span><input name="scoreLabel" defaultValue={review.scoreLabel ?? ""} placeholder="Optional: B+, Pass" /></label><label className="feedback-field"><span>Klio’s feedback</span><textarea name="feedback" defaultValue={review.draftFeedback ?? ""} required /></label></div>{rubric.length || mastery.length ? <div className="review-evidence">{rubric.map((item) => <span key={`${item.criterion}-${item.level}`}><b>{item.criterion}</b>{item.level}</span>)}{mastery.map((item) => <span key={`${item.skill}-${item.status}`}><b>{item.skill}</b>{item.status.replace("-", " ")}</span>)}</div> : null}{Array.isArray(review.uncertaintyFlags) && review.uncertaintyFlags.length ? <p className="review-caution">Parent check: {review.uncertaintyFlags.join(" ")}</p> : null}<footer><button type="button" onClick={() => void redraft(review)} disabled={props.busy === `draft-${review.id}`}><Sparkles size={13} />{props.busy === `draft-${review.id}` ? "Reviewing…" : "Have Klio review again"}</button><button type="button" onClick={(event) => { const form = event.currentTarget.closest("form"); if (form) void decide(form, review, "reject"); }}>Return to work</button><button type="submit" disabled={props.busy === review.id}><Check size={13} />{props.busy === review.id ? "Saving…" : "Looks right — approve"}</button></footer></form>; })}</div>;
}

function reviewRubric(value: unknown): Array<{ criterion: string; level: string; note?: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { criterion: string; level: string; note?: string } => Boolean(item && typeof item === "object" && "criterion" in item && typeof item.criterion === "string" && "level" in item && typeof item.level === "string"));
}

function reviewMasterySignals(value: unknown): Array<{ skill: string; status: "emerging" | "developing" | "secure" | "needs-review" }> {
  if (!Array.isArray(value)) return [];
  const statuses = new Set(["emerging", "developing", "secure", "needs-review"]);
  return value.filter((item): item is { skill: string; status: "emerging" | "developing" | "secure" | "needs-review" } => Boolean(item && typeof item === "object" && "skill" in item && typeof item.skill === "string" && "status" in item && typeof item.status === "string" && statuses.has(item.status)));
}

function AdjustmentsSurface(props: { assignments: AssignmentDTO[]; students: StudentDTO[]; proposals: AdjustmentDTO[]; planningProposals: PlanningProposalDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; onUndo: (proposal: AdjustmentDTO) => void; onAcknowledge: (proposal: AdjustmentDTO) => Promise<boolean> }) {
  const router = useRouter();
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  async function decide(proposal: AdjustmentDTO, decision: "approve" | "reject") { props.setBusy(proposal.id); const response = await fetch(`/api/adjustments/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }); const result = await response.json(); props.setBusy(null); if (!response.ok) return props.setNotice(result.error ?? "Klio could not apply that change."); props.setNotice(decision === "approve" ? "The week has been updated." : "The proposed change was declined."); router.refresh(); }
  async function decidePlanning(proposal: PlanningProposalDTO, decision: "approve" | "reject") { props.setBusy(proposal.id); const response = await fetch(`/api/planning-proposals/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }); const result = await response.json(); props.setBusy(null); if (!response.ok) return props.setNotice(result.error ?? "Klio could not apply that proposal."); props.setNotice(decision === "approve" ? "The approved plan is now part of the family workspace." : "The proposal was declined; current records are unchanged."); router.refresh(); }
  async function acknowledge(proposal: AdjustmentDTO) { setAcknowledging(proposal.id); await props.onAcknowledge(proposal); setAcknowledging(null); }
  const current = props.proposals.filter((proposal) => proposal.status === "proposed");
  const completed = props.proposals.filter((proposal) => proposal.status === "applied" && !proposal.acknowledgedAt);
  const planning = props.planningProposals.filter((proposal) => proposal.status === "proposed");
  return <div className="adjustments-list">
    {planning.map((proposal) => <article key={proposal.id}><header><div><span>{props.students.find((student) => student.id === proposal.studentId)?.displayName ?? "Learner"} · {planningKindLabel(proposal.proposalKind)} · {proposal.risk} risk</span><h2>{proposal.title}</h2><p>{proposal.summary}</p></div><Sparkles size={18} /></header><p>{proposal.reason}</p><PlanningChangeSummary proposal={proposal} assignments={props.assignments} /><footer><button type="button" onClick={() => void decidePlanning(proposal, "reject")} disabled={props.busy === proposal.id}>Decline</button><button type="button" onClick={() => void decidePlanning(proposal, "approve")} disabled={props.busy === proposal.id}><Check size={13} />{props.busy === proposal.id ? "Applying…" : proposal.proposalKind === "grade" ? "Return work" : "Approve proposal"}</button></footer></article>)}
    {current.map((proposal) => <article key={proposal.id}><header><div><span>{props.students.find((student) => student.id === proposal.studentId)?.displayName ?? "Learner"} · Proposed for week of {shortDate(proposal.weekStart)}</span><h2>{proposal.summary}</h2><p>{proposal.reason}</p></div><Sparkles size={18} /></header><ol>{proposal.actions.map((action) => { const assignment = props.assignments.find((item) => item.id === action.assignmentId); const before = action.beforeState as { scheduledDate?: string }; const after = action.afterState as { scheduledDate?: string; title?: string; subject?: string }; return <li key={action.id}><span>{action.actionType === "add_practice" ? after.subject ?? "Practice" : assignment?.subject ?? "Practice"}</span><strong>{action.actionType === "add_practice" ? after.title ?? "Focused review" : assignment?.title ?? "Focused review"}</strong><div><s>{before.scheduledDate ? weekday(before.scheduledDate) : "New"}</s><ArrowRight size={12} /><b>{after.scheduledDate ? weekday(after.scheduledDate) : "Unscheduled"}</b></div></li>; })}</ol><footer><button type="button" onClick={() => void decide(proposal, "reject")}>Keep current week</button><button type="button" onClick={() => void decide(proposal, "approve")} disabled={props.busy === proposal.id}><Check size={13} />{props.busy === proposal.id ? "Applying…" : "Approve changes"}</button></footer></article>)}
    {completed.map((proposal) => <article key={`completed-${proposal.id}`}><header><div><span>{props.students.find((student) => student.id === proposal.studentId)?.displayName ?? "Learner"} · Schedule updated</span><h2>{proposal.summary}</h2><p>{proposal.reason}</p></div><Check size={18} /></header>{proposal.actions.length ? <ol>{proposal.actions.map((action) => { const assignment = props.assignments.find((item) => item.id === action.assignmentId); const before = action.beforeState as { scheduledDate?: string }; const after = action.afterState as { scheduledDate?: string; title?: string; subject?: string }; return <li key={action.id}><span>{action.actionType === "add_practice" ? after.subject ?? "Practice" : assignment?.subject ?? "Schedule"}</span><strong>{action.actionType === "add_practice" ? after.title ?? "Focused review" : assignment?.title ?? "Scheduled work"}</strong><div><s>{before.scheduledDate ? weekday(before.scheduledDate) : "New"}</s><ArrowRight size={12} /><b>{after.scheduledDate ? weekday(after.scheduledDate) : "Unscheduled"}</b></div></li>; })}</ol> : null}<footer>{proposal.undoStatus === "available" ? <button type="button" onClick={() => props.onUndo(proposal)} disabled={props.busy === proposal.id}><RotateCcw size={13} />{props.busy === proposal.id ? "Undoing…" : "Undo change"}</button> : null}<button type="button" onClick={() => void acknowledge(proposal)} disabled={acknowledging === proposal.id}><Check size={13} />{acknowledging === proposal.id ? "Acknowledging…" : "Acknowledge"}</button></footer></article>)}
    {!planning.length && !current.length && !completed.length ? <div className="review-empty"><RotateCcw size={28} /><span>Proposed changes</span><h2>Nothing is waiting for your decision.</h2><p>Schedule, goal, curriculum, and return-work proposals appear here before they change family records.</p><Link href="/app">Return to this week <ArrowRight size={13} /></Link></div> : null}
  </div>;
}

function PlanningChangeSummary({ proposal, assignments }: { proposal: PlanningProposalDTO; assignments: AssignmentDTO[] }) {
  const changes = proposal.changes && typeof proposal.changes === "object" && !Array.isArray(proposal.changes) ? proposal.changes as Record<string, unknown> : {};
  const rows = Array.isArray(changes.changes) ? changes.changes.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).slice(0, 12) : [];
  if (rows.length) return <ol>{rows.map((change, index) => { const assignment = assignments.find((item) => item.id === change.assignmentId); return <li key={`${String(change.assignmentId)}-${index}`}><span>{assignment?.subject ?? "Schedule"}</span><strong>{assignment?.title ?? "Planned work"}</strong><div>{typeof change.scheduledDate === "string" ? <b>{shortDate(change.scheduledDate)}</b> : null}{typeof change.estimatedMinutes === "number" ? <b>{change.estimatedMinutes} min</b> : null}</div></li>; })}</ol>;
  return <p className="proposal-scope">Only the named {planningKindLabel(proposal.proposalKind).toLowerCase()} record will change. Source evidence is never edited or deleted.</p>;
}

function planningKindLabel(kind: string) { return ({ learner_goal: "Learning goal", curriculum: "Curriculum", curriculum_cadence: "Curriculum cadence", weekly_plan: "Weekly plan", term_plan: "Term plan", schedule_resize: "Lesson duration", grade: "Return work" } as Record<string, string>)[kind] ?? "Plan"; }

function SubmissionPanel({ assignment, familyEvidence, busy, setBusy, setNotice, close }: { assignment: AssignmentDTO; familyEvidence: EvidenceDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; close: () => void }) {
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(assignment.id); const response = await fetch(`/api/assignments/${assignment.id}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidenceIds: data.getAll("evidenceIds"), note: data.get("note") || null }) }); const result = await response.json(); setBusy(null); if (!response.ok) return setNotice(result.error ?? "Klio could not attach that work."); close(); if (result.outcome === "comment") { setNotice(`Note added to ${assignment.title}. Klio will keep it with this lesson.`); router.refresh(); return; } if (result.outcome === "completed") { setNotice(`${assignment.title} marked complete. The note was added to the learning record.`); router.refresh(); return; } setNotice(result.completionRecorded ? "Completion recorded. Klio drafted a review for your confirmation." : "Work submitted. Klio drafted a review for your confirmation."); router.push("/app/review"); router.refresh(); }
  return <motion.div className="submission-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.form className="submission-panel" onSubmit={submit} initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }}><header><div><span>Add a lesson update</span><h2>{assignment.title}</h2><p>A simple completion note closes the lesson. A score or attached work goes to Review for feedback.</p></div><button type="button" onClick={close} aria-label="Close"><X size={17} /></button></header><div className="submission-sources">{familyEvidence.length ? familyEvidence.map((item) => <label key={item.id}><input type="checkbox" name="evidenceIds" value={item.id} /><span><strong>{item.title ?? item.rawText?.slice(0,70) ?? "Saved capture"}</strong><small>{shortDate(item.createdAt.slice(0,10))} · {item.kind}</small></span></label>) : <p>No saved captures yet. Add a completion note below, or capture work when you want feedback.</p>}</div><label className="submission-note"><span>What happened?</span><textarea name="note" placeholder="Finished in 30 minutes — or add a score and what needs attention." /></label><footer><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={busy === assignment.id}>Save update</button></footer></motion.form></motion.div>;
}

function surfaceLabel(surface: Surface) { return ({ today: "Today", week: "This week", assignments: "Curriculum & assignments", review: "Review & grades", adjustments: "Klio’s proposed adjustments" } as const)[surface]; }
function surfaceTitle(surface: Surface, learner: string) { return ({ today: `${learner}’s day`, week: `${learner}’s week`, assignments: "Plan the work once", review: "Confirm what the work shows", adjustments: "Keep the week realistic" } as const)[surface]; }
function surfaceDescription(surface: Surface) { return ({ today: "What is ahead and what needs your attention today.", week: "What is planned, what changed, and what needs your decision.", assignments: "Curriculum becomes ordered work—not a lesson form you repeat every day.", review: "Klio reviews the submitted work; you give the draft a quick check before it becomes part of the record.", adjustments: "Preview coordinated moves before anything changes." } as const)[surface]; }
function statusLabel(status: string) { return ({ planned: "Planned", doing: "Doing", submitted: "Submitted", needs_review: "Needs review", completed: "Complete", skipped: "Skipped" } as Record<string,string>)[status] ?? status; }
function initialDate(assignments: AssignmentDTO[], studentId: string, currentDate: string) { const dates = assignments.filter((item) => (studentId === "all" || item.studentId === studentId) && item.scheduledDate).map((item) => item.scheduledDate!).sort(); return dates.find((date) => date >= currentDate) ?? dates.at(-1) ?? currentDate; }
function formatNames(names: string[]) { return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names); }
function startAssignmentDrag(event: React.DragEvent, assignment: AssignmentDTO) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-klio-assignment", assignment.id);
  event.dataTransfer.setData("text/plain", assignment.title);
}
function weekday(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }); }
function dayNumber(date: string) { return new Date(`${date}T12:00:00Z`).getUTCDate(); }
function longDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); }
function shortDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
function weekRangeLabel(days: string[]) { const first = new Date(`${days[0]}T12:00:00Z`); const last = new Date(`${days.at(-1)}T12:00:00Z`); return `${first.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`; }
function formatTime(time: string) { const [hour, minute] = time.split(":").map(Number); return new Date(2000,0,1,hour,minute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function scheduleViewHref(view: "today" | "week" | "month", date: string, scopeId: string) {
  const params = new URLSearchParams();
  params.set("date", date);
  if (scopeId !== "all") params.set("student", scopeId);
  if (view === "month") params.set("view", "month");
  return `${view === "today" ? "/app" : "/app/week"}?${params.toString()}`;
}
function assignmentsViewHref(scopeId: string, unitId: string | null) {
  const params = new URLSearchParams();
  if (scopeId !== "all") params.set("student", scopeId);
  if (unitId) params.set("unit", unitId);
  const query = params.toString();
  return `/app/assignments${query ? `?${query}` : ""}`;
}
function reconcileAssignmentPage(local: AssignmentDTO[], serverPage: AssignmentDTO[]) {
  const serverIds = new Set(serverPage.map((item) => item.id));
  return dedupeAssignmentsById([...serverPage, ...local.filter((item) => !serverIds.has(item.id))]);
}
function formatTimeFromMinutes(minutes: number) { return formatTime(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`); }
function attentionConflicts(assignments: AssignmentDTO[]) { return findParentAttentionConflicts(assignments.map((item) => ({ id: item.id, studentId: item.studentId, scheduledStart: item.scheduledTime, requirement: { mode: item.resolvedAttentionMode, lessonMinutes: item.estimatedMinutes ?? 0, parentMinutes: item.resolvedParentMinutes, inherited: item.attentionInherited, source: item.attentionSource } }))); }
function dayConflictLabel(assignment: AssignmentDTO, students: StudentDTO[], includeLearner: boolean) { const learner = includeLearner ? students.find((student) => student.id === assignment.studentId)?.displayName : undefined; return learner ? `${learner} · ${assignment.title}` : assignment.title; }
function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0,10); }
function dueLabel(value: string) { return new Date(value).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
function subjectTone(subject: string) { const value = subject.toLowerCase(); if (/math|algebra|geometry|calculus/.test(value)) return "blue"; if (/science|biology|chemistry|physics/.test(value)) return "green"; if (/history|social|geography/.test(value)) return "gold"; if (/english|language|writing|literature|reading/.test(value)) return "lilac"; if (/art|music/.test(value)) return "rose"; return "neutral"; }
