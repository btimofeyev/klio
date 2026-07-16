"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, ClipboardCheck, Clock3, FileCheck2, GripVertical, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { InboxWorkspace } from "@/components/inbox-workspace";
import { SpatialWorkspace, type SpatialCameraState, type SpatialWorkspaceItem } from "@/components/spatial-workspace";
import type { AdjustmentDTO, AssignmentDTO, AssignmentReviewDTO, CurriculumUnitDTO, PlanningProposalDTO, PracticeSessionDTO, SubmissionDTO } from "@/lib/data/operations";
import type { AgentConversationDTO, AgentTurnDTO, ArtifactDTO, CategoryDTO, EvidenceDTO, KlioInsightDTO, ReminderDTO, StudentDTO, WorkspaceLayoutDTO } from "@/lib/data/workspace";
import { reorderDayIds } from "@/lib/schedule/day-order";
import { normalizePracticeSpec } from "@/lib/practice/spec";
import { estimatedPracticeMinutes } from "@/lib/practice/presentation";
import { practicePreviewStyles } from "@/components/practice-preview";
import { reviewEntityAction } from "@/app/app/actions";
import { PracticePlayer, type PracticePlayerResult } from "@/components/practice-player";
import { learnerWeekdays, learningWeekDates } from "@/lib/assignments/dates";

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
};

export function OperationsWorkspace({ surface, workspace, initialSelectedDate, initialStudentId, initialArtifactId, initialPracticeSessionId }: { surface: Surface; workspace: Workspace; initialSelectedDate?: string; initialStudentId?: string; initialArtifactId?: string; initialPracticeSessionId?: string }) {
  const router = useRouter();
  const defaultsToFamily = workspace.students.length > 1;
  const [studentId, setStudentId] = useState(defaultsToFamily ? (initialStudentId ?? "all") : (initialStudentId ?? workspace.students[0]?.id ?? ""));
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate ?? initialDate(workspace.assignments, studentId, workspace.currentDate));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const [activePracticeSessionId, setActivePracticeSessionId] = useState<string | null>(() => initialPracticeSessionId ?? (initialArtifactId
    ? workspace.practiceSessions.find((session) => session.artifactId === initialArtifactId && ["ready", "in_progress"].includes(session.status))?.id ?? null
    : null));
  const autoOpeningArtifactRef = useRef<string | null>(activePracticeSessionId && initialArtifactId ? initialArtifactId : null);
  const practiceSessions = useMemo(() => [...practiceSessionOverrides, ...workspace.practiceSessions.filter((item) => !practiceSessionOverrides.some((override) => override.id === item.id))]
    .map((item) => completedPracticeSessionIds.includes(item.id) ? { ...item, status: "completed" } : dismissedPracticeSessionIds.includes(item.id) ? { ...item, status: "dismissed" } : item), [completedPracticeSessionIds, dismissedPracticeSessionIds, practiceSessionOverrides, workspace.practiceSessions]);
  const activePracticeSession = practiceSessions.find((item) => item.id === activePracticeSessionId) ?? null;
  const liveInsights = [...optimisticInsights, ...workspace.insights.filter((item) => !optimisticInsights.some((optimistic) => optimistic.id === item.id))]
    .filter((insight, index, all) => all.findIndex((candidate) => insightGroupKey(candidate) === insightGroupKey(insight)) === index)
    .filter((insight) => !dismissedInsightKeys.includes(insightGroupKey(insight)))
    .filter((insight) => typeof insight.actionRef.proposalId !== "string" || (!resolvedProposalIds.includes(insight.actionRef.proposalId) && !acknowledgedProposalIds.includes(insight.actionRef.proposalId)));
  const selectedLearner = workspace.students.find((student) => student.id === studentId);
  const learner = selectedLearner ?? workspace.students[0];
  const assignments = studentId === "all" ? workspace.assignments : workspace.assignments.filter((item) => item.studentId === studentId);
  const enabledWeekdays = useMemo(() => {
    if (selectedLearner) return learnerWeekdays(selectedLearner.schedulePreferences, workspace.family.available_days);
    return [...new Set(workspace.students.flatMap((student) => learnerWeekdays(student.schedulePreferences, workspace.family.available_days)))].sort();
  }, [selectedLearner, workspace.family.available_days, workspace.students]);
  const days = useMemo(() => learningWeekDates(selectedDate, enabledWeekdays), [enabledWeekdays, selectedDate]);
  const pendingReviews = workspace.assignmentReviews.filter((review) => review.status === "draft" && assignments.some((item) => item.id === review.assignmentId));
  const proposals = workspace.adjustments.filter((proposal) => studentId === "all" || proposal.studentId === studentId);
  const deskTurn = workspace.latestAgentTurn && (["queued", "running", "awaiting_parent", "failed"].includes(workspace.latestAgentTurn.status) || (workspace.latestAgentTurn.status === "completed" && workspace.latestAgentTurn.conversationId === workspace.latestAgentConversation?.id)) ? workspace.latestAgentTurn : null;
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

  const captureWorkspace = <InboxWorkspace key={`capture-${studentId}`} familyId={workspace.family.id} students={workspace.students} categories={workspace.categories} initialEvidence={workspace.evidence} initialReminders={workspace.reminders} initialArtifacts={workspace.artifacts} pendingApprovals={workspace.pendingApprovals} initialAgentTurn={deskTurn} initialAgentConversation={workspace.latestAgentConversation} initialStudentId={selectedLearner?.id ?? ""} workspaceDate={selectedDate} assignmentContext={captureAssignment ? { id: captureAssignment.id, studentId: captureAssignment.studentId, title: captureAssignment.title, subject: captureAssignment.subject } : null} onAssignmentDrop={(assignmentId) => setCaptureAssignment(workspace.assignments.find((item) => item.id === assignmentId) ?? null)} onAssignmentContextClear={() => setCaptureAssignment(null)} onPracticeOpen={(artifactId) => void openPractice({ artifactId })} compact dashboard />;

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
    if (!response.ok) return setNotice(result.error ?? "Klio could not update that assignment.");
    setNotice(status === "completed" ? `${assignment.title} is done. Klio recorded it and is checking the follow-through.` : `${assignment.title} updated.`);
    router.refresh();
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
    router.refresh();
  }

  function chooseLearner(id: string) {
    setStudentId(id);
    setSelectedDate(initialDate(workspace.assignments, id, workspace.currentDate));
    if (id !== "all") document.cookie = `klio-learner=${encodeURIComponent(id)}; Path=/app; Max-Age=31536000; SameSite=Lax`;
  }

  return <div className="ops-workspace">
    {surface !== "today" && surface !== "week" ? <header className="ops-header">
      <div><span>{surfaceLabel(surface)}</span><h1>{surfaceTitle(surface, learner?.displayName ?? "Your learner")}</h1><p>{surfaceDescription(surface)}</p></div>
      <label><span>View</span><select value={studentId} onChange={(event) => chooseLearner(event.target.value)}>{workspace.students.length > 1 ? <option value="all">Family</option> : null}{workspace.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
    </header> : null}
    {notice ? <p className="ops-notice" role="status"><Sparkles size={14} />{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={13} /></button></p> : null}

    {surface === "today" ? <DaySurface key={`${studentId}-${selectedDate}`}
      assignments={assignments}
      scopeId={studentId}
      currentDate={workspace.currentDate}
      selectedDate={selectedDate}
      setSelectedDate={setSelectedDate}
      learner={learner}
      students={workspace.students}
      chooseLearner={chooseLearner}
      reminders={workspace.reminders.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
      reviews={pendingReviews}
      approvedReviews={workspace.assignmentReviews.filter((review) => review.status === "approved")}
      submissions={workspace.submissions}
      evidence={workspace.evidence}
      proposals={proposals}
      acknowledgedProposalIds={acknowledgedProposalIds}
      artifacts={workspace.artifacts.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
      practiceSessions={practiceSessions.filter((item) => studentId === "all" || item.studentId === studentId)}
      insights={liveInsights.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
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
      familyId={workspace.family.id}
      initialArtifactId={initialArtifactId}
      workspaceLayouts={workspace.workspaceLayouts}
      capture={captureWorkspace}
    /> : null}
    {surface === "week" ? <WeekSurface familyId={workspace.family.id} workspaceLayouts={workspace.workspaceLayouts} scopeId={studentId} assignments={assignments} curricula={workspace.curriculumUnits.filter((unit) => (studentId === "all" || unit.studentId === studentId) && unit.status === "active")} learner={selectedLearner} students={workspace.students} chooseLearner={chooseLearner} days={days} currentDate={workspace.currentDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate} capacity={learner?.dailyCapacityMinutes ?? 180} pendingReviews={pendingReviews} approvedReviews={workspace.assignmentReviews.filter((review) => review.status === "approved")} submissions={workspace.submissions} evidence={workspace.evidence} proposals={proposals} acknowledgedProposalIds={acknowledgedProposalIds} reminders={workspace.reminders.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)} artifacts={workspace.artifacts.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)} practiceSessions={practiceSessions.filter((item) => studentId === "all" || item.studentId === studentId)} insights={liveInsights.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)} busy={busy} onBuildWeek={() => buildWeek()} onBuildNextWeek={() => buildWeek(addDays(days[0], 7))} onUpdate={updateAssignment} onMove={(assignmentId, date) => void moveAssignment(assignmentId, date)} onSubmit={setCaptureAssignment} onAdjust={(item) => void proposeAdjustments([item])} onDecide={(proposal, decision) => void decideAdjustment(proposal, decision)} onAcknowledge={acknowledgeAdjustment} onDismissInsight={dismissInsight} onStartPractice={(input) => void openPractice(input)} onDismissPractice={(session, reason) => void dismissPractice(session, reason)} onPracticeFollowUp={(insight, action) => void practiceFollowUp(insight, action)} onApproveReview={(review) => void approveReview(review)} capture={captureWorkspace} /> : null}
    {surface === "assignments" ? <AssignmentsSurface familyId={workspace.family.id} studentId={studentId} students={workspace.students} enabledWeekdays={enabledWeekdays} units={workspace.curriculumUnits.filter((unit) => studentId === "all" || unit.studentId === studentId)} assignments={assignments} busy={busy} setBusy={setBusy} setNotice={setNotice} showCurriculum={showCurriculum} setShowCurriculum={setShowCurriculum} onSubmit={setSubmissionAssignment} onUpdate={updateAssignment} /> : null}
    {surface === "review" ? <ReviewSurface assignments={assignments} students={workspace.students} reviews={pendingReviews} submissions={workspace.submissions} legacyCount={workspace.pendingApprovals} busy={busy} setBusy={setBusy} setNotice={setNotice} /> : null}
    {surface === "adjustments" ? <AdjustmentsSurface assignments={assignments} students={workspace.students} proposals={workspace.adjustments.filter((proposal) => studentId === "all" || proposal.studentId === studentId)} planningProposals={workspace.planningProposals.filter((proposal) => studentId === "all" || proposal.studentId === studentId)} busy={busy} setBusy={setBusy} setNotice={setNotice} /> : null}

    <AnimatePresence>{submissionAssignment ? <SubmissionPanel assignment={submissionAssignment} familyEvidence={workspace.evidence.filter((item) => item.studentIds.includes(submissionAssignment.studentId)).slice(0, 12)} busy={busy} setBusy={setBusy} setNotice={setNotice} close={() => setSubmissionAssignment(null)} /> : null}</AnimatePresence>
    <AnimatePresence>{activePracticeSession ? <PracticeOverlay session={activePracticeSession} title={workspace.artifacts.find((artifact) => artifact.id === activePracticeSession.artifactId)?.title} learnerName={workspace.students.find((student) => student.id === activePracticeSession.studentId)?.displayName ?? "Learner"} onClose={() => setActivePracticeSessionId(null)} onCompleted={(result) => practiceCompleted(activePracticeSession.id, result)} /> : null}</AnimatePresence>
  </div>;
}

function DaySurface(props: {
  familyId: string;
  initialArtifactId?: string;
  workspaceLayouts: WorkspaceLayoutDTO[];
  assignments: AssignmentDTO[];
  scopeId: string;
  currentDate: string;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  learner: StudentDTO | undefined;
  students: StudentDTO[];
  chooseLearner: (id: string) => void;
  reminders: ReminderDTO[];
  reviews: AssignmentReviewDTO[];
  approvedReviews: AssignmentReviewDTO[];
  submissions: SubmissionDTO[];
  evidence: EvidenceDTO[];
  proposals: AdjustmentDTO[];
  acknowledgedProposalIds: string[];
  artifacts: ArtifactDTO[];
  practiceSessions: PracticeSessionDTO[];
  insights: KlioInsightDTO[];
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
  capture: React.ReactNode;
}) {
  const dayAssignments = props.assignments.filter((item) => item.scheduledDate === props.selectedDate && item.status !== "skipped");
  const [selectedId, setSelectedId] = useState<string | null>(() => dayAssignments.find((item) => item.status !== "completed")?.id ?? dayAssignments[0]?.id ?? null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const minutes = dayAssignments.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
  const completed = dayAssignments.filter((item) => item.status === "completed").length;
  const activeReminders = props.reminders.filter((item) => item.status === "pending" && isParentFacingReminder(item)).slice(0, 1);
  const practices = props.artifacts.filter((item) => item.type === "practice" && practiceArtifactIsAvailable(item, props.practiceSessions)).slice(0, 3);
  const visibleInsights = rankWorkspaceInsights(props.insights)
    .filter((item) => item.kind !== "on_track" && isParentFacingWorkspaceInsight(item) && !isResolvedAdjustmentInsight(item, props.proposals))
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
        <header><div><span>{isFamilyView ? "Family work" : `${props.learner?.displayName ?? "Learner"}’s work`}</span><strong>{completed}/{dayAssignments.length} complete</strong></div><i><b style={{ width: `${dayAssignments.length ? completed / dayAssignments.length * 100 : 0}%` }} /></i><p className="day-order-hint"><GripVertical size={12} />Drag lessons to reorder or drop one on Klio</p></header>
        <div className="teacher-day-list">
          {dayAssignments.length ? dayAssignments.map((item, index) => <DayAssignmentRow item={item} learnerName={isFamilyView ? props.students.find((student) => student.id === item.studentId)?.displayName : props.learner?.displayName} selected={selectedId === item.id} focused={focusedId === item.id} busy={props.busy === item.id || props.busy === props.reviews.find((review) => review.assignmentId === item.id)?.id} review={props.reviews.find((review) => review.assignmentId === item.id)} submission={props.submissions.find((submission) => submission.assignmentId === item.id)} evidence={props.evidence} onSelect={() => { setSelectedId(item.id); setFocusedId((current) => current === item.id ? null : item.id); }} onCollapse={() => setFocusedId((current) => current === item.id ? null : current)} onUpdate={props.onUpdate} onSubmit={props.onSubmit} onAdjust={props.onAdjust} onApproveReview={props.onApproveReview} onReorder={reorderByDrop} index={index} key={item.id} />) : <div className="day-empty"><CalendarDays size={25} /><strong>The page is open today.</strong><span>Leave it clear or ask Klio to plan from your curriculum.</span><Link href="/app/week">Plan this week <ArrowRight size={12} /></Link></div>}
        </div>
      </main>;
  const items: SpatialWorkspaceItem[] = [
    { id: "schedule", label: "Schedule", title: longDate(props.selectedDate), x: 730, y: 470, width: 720, focusZoom: .92, minFocusZoom: .78, className: "spatial-day-schedule", children: schedule },
    ...(props.reviews.length ? [{ id: "review", label: "Review ready", title: `${props.reviews.length} ${props.reviews.length === 1 ? "assignment" : "assignments"}`, x: 260, y: 520, width: 350, focusZoom: 1, className: "spatial-note-object", children: <Link className="teacher-note note-lilac" href="/app/review"><span><ClipboardCheck size={15} />Klio checked the work</span><strong>{props.reviews.length} {props.reviews.length === 1 ? "review is" : "reviews are"} ready</strong><small>Approve the grounded feedback when you are ready.</small><ArrowRight size={15} /></Link> }] : []),
    ...(recentApplied ? [{ id: `adjusted:${recentApplied.id}`, label: "Klio adjusted", title: recentApplied.summary, x: 1500, y: 480, width: 390, focusZoom: 1, className: "spatial-note-object", children: <AdjustmentNote proposal={recentApplied} busy={props.busy === recentApplied.id} onUndo={() => props.onDecide(recentApplied, "undo")} onAcknowledge={() => props.onAcknowledge(recentApplied)} /> }] : []),
    ...visibleInsights.map((insight, index) => ({ id: `insight:${insight.id}`, label: insightLabel(insight.kind), title: insight.title, x: index === 0 ? 1500 : 260, y: 500 + index * 260, width: 390, focusZoom: 1, className: "spatial-note-object", children: <InsightNote insight={insight} proposals={props.proposals} busy={props.busy} onDecide={props.onDecide} onAcknowledge={props.onAcknowledge} onDismiss={props.onDismissInsight} onStartPractice={props.onStartPractice} onPracticeFollowUp={props.onPracticeFollowUp} /> })),
    ...(visibleProposal ? [{ id: `adjustment:${visibleProposal.id}`, label: "Schedule ready", title: visibleProposal.summary, x: 1500, y: 760, width: 390, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note teacher-note-decision note-yellow"><span><RotateCcw size={15} />Needs your approval</span><strong>{visibleProposal.summary}</strong><small>This family policy asks before applying the change.</small><div className="teacher-note-actions"><button type="button" onClick={() => props.onDecide(visibleProposal, "approve")} disabled={props.busy === visibleProposal.id}><Check size={12} />{props.busy === visibleProposal.id ? "Applying…" : "Accept changes"}</button><Link href="/app/adjustments">Review <ArrowRight size={12} /></Link></div></div> }] : []),
    ...practices.map((practice, index) => {
      const practiceSession = props.practiceSessions.find((item) => item.artifactId === practice.id && ["ready", "in_progress"].includes(item.status));
      const practiceLearnerName = practice.studentId ? props.students.find((student) => student.id === practice.studentId)?.displayName : undefined;
      return { id: `practice:${practice.id}`, label: "Practice", title: `${practiceLearnerName ? `${practiceLearnerName} · ` : ""}${practice.title}`, x: 1540, y: 820 + index * 320, width: 420, focusZoom: 1.02, className: "spatial-practice-object", children: <CanvasPractice familyId={props.familyId} artifact={practice} learnerName={practiceLearnerName} session={practiceSession} busy={props.busy === practice.id || props.busy === practiceSession?.id} onStart={props.onStartPractice} onDismiss={props.onDismissPractice} /> };
    }),
    ...(activeReminders[0] ? [{ id: `reminder:${activeReminders[0].id}`, label: "Reminder", title: activeReminders[0].title, x: 260, y: 1020, width: 350, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note note-cream"><span><Clock3 size={15} />Reminder</span><strong>{activeReminders[0].title}</strong><small>{activeReminders[0].dueAt ? dueLabel(activeReminders[0].dueAt) : "No due date"}</small></div> }] : []),
  ];
  const toolbar = <div className="spatial-canvas-toolbar spatial-day-toolbar">
    <div className="teacher-canvas-nav"><button type="button" onClick={() => props.setSelectedDate(addDays(props.selectedDate, -1))} aria-label="Previous day"><ArrowLeft size={15} /></button><button type="button" className="teacher-canvas-today" onClick={() => props.setSelectedDate(props.currentDate)} disabled={props.selectedDate === props.currentDate}>Today</button><button type="button" onClick={() => props.setSelectedDate(addDays(props.selectedDate, 1))} aria-label="Next day"><ArrowRight size={15} /></button></div>
    <div className="teacher-canvas-heading"><span>Daily plan</span><h1>{longDate(props.selectedDate)}</h1><p>{dayAssignments.length} {dayAssignments.length === 1 ? "lesson" : "lessons"} · {formatMinutes(minutes)}</p></div>
    <div className="teacher-toolbar-actions"><Link href="/app/week"><CalendarDays size={14} />Week</Link><label><span>View</span><select aria-label="View day plan for" value={props.scopeId} onChange={(event) => props.chooseLearner(event.target.value)}>{props.students.length > 1 ? <option value="all">Family</option> : null}{props.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div>
  </div>;

  const layout = props.workspaceLayouts.find((item) => item.surface === "day" && item.scopeKey === props.scopeId);
  const focusedPractice = practices.find((practice) => practice.id === props.initialArtifactId);
  return <SpatialWorkspace ariaLabel="Daily homeschool teaching board" persistenceKey={`day:${props.scopeId}`} items={items} initialView={{ x: -385, y: -270, zoom: .86 }} overviewView={{ x: 20, y: -90, zoom: .52 }} homeItemId="schedule" focusRequest={focusedPractice ? { id: `practice:${focusedPractice.id}`, key: 1 } : null} layoutPersistence={{ familyId: props.familyId, surface: "day", scopeKey: props.scopeId, layoutVersion: 2, positions: layout?.layoutVersion === 2 ? layout.positions : undefined }} onCameraChange={(camera) => { if (camera.level !== "nested") setFocusedId(null); }} toolbar={toolbar} assistant={<div className="spatial-assistant-surface">{props.capture}</div>} />;
}

function DayAssignmentRow(props: { item: AssignmentDTO; learnerName?: string; selected: boolean; focused: boolean; busy: boolean; review?: AssignmentReviewDTO; submission?: SubmissionDTO; evidence: EvidenceDTO[]; index: number; onSelect: () => void; onCollapse: () => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust: (item: AssignmentDTO) => void; onApproveReview: (review: AssignmentReviewDTO) => void; onReorder: (movedId: string, targetId: string, placeAfter: boolean) => void }) {
  const complete = props.item.status === "completed";
  return <article className={`day-assignment ${props.selected ? "selected" : ""} ${props.focused ? "focused" : ""} ${complete ? "completed" : ""}`} data-spatial-focus-target data-spatial-focus-id={props.item.id} data-spatial-focus-label={props.item.title} data-spatial-focus-zoom="1.14" draggable title={complete ? "Completed. Select to view details or drag to Klio." : "Drag to reorder or hand this lesson to Klio"} onDragStart={(event) => startAssignmentDrag(event, props.item)} onDragEnd={() => document.querySelectorAll(".day-drop-before,.day-drop-after").forEach((element) => element.classList.remove("day-drop-before", "day-drop-after"))} onDragOver={(event) => { if (!event.dataTransfer.types.includes("application/x-klio-assignment")) return; event.preventDefault(); const after = event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2; event.currentTarget.classList.toggle("day-drop-before", !after); event.currentTarget.classList.toggle("day-drop-after", after); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.classList.remove("day-drop-before", "day-drop-after"); }} onDrop={(event) => { event.preventDefault(); const movedId = event.dataTransfer.getData("application/x-klio-assignment"); const after = event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2; event.currentTarget.classList.remove("day-drop-before", "day-drop-after"); if (movedId) props.onReorder(movedId, props.item.id, after); }} onClick={props.onSelect}>
    <span className="day-drag-grip" aria-hidden="true"><GripVertical size={14} /></span>
    <time>{props.item.scheduledTime ? formatTime(props.item.scheduledTime) : props.index === 0 ? "Start here" : "Next"}</time>
    <span className="day-subject-mark">{props.item.subject.slice(0, 1).toUpperCase()}</span>
    <div><small>{props.learnerName ? `${props.learnerName} · ${props.item.subject}` : props.item.subject}</small><strong>{props.item.title}</strong>{props.item.instructions ? <p>{props.item.instructions}</p> : null}</div>
    <span className="day-duration">{props.item.estimatedMinutes ? `${props.item.estimatedMinutes} min` : "Flexible"}</span>
    {complete ? <button type="button" className="day-state day-completed-open" aria-expanded={props.focused} aria-label={`${props.focused ? "Hide" : "View"} details for ${props.item.title}`} onClick={(event) => { event.stopPropagation(); props.onSelect(); }}><Check size={15} />Done</button> : props.item.status !== "planned" ? <span className="day-state">{statusLabel(props.item.status)}</span> : null}
    {props.selected && !complete ? <div className="day-row-actions" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => { props.onUpdate(props.item, "completed"); props.onCollapse(); }} disabled={props.busy}><Check size={12} />Done</button>
      <button type="button" onClick={() => props.onSubmit(props.item)}><Sparkles size={12} />Hand to Klio</button>
      <button type="button" onClick={() => props.onAdjust(props.item)} disabled={props.busy}><RotateCcw size={12} />Not finished</button>
    </div> : null}
    {props.focused ? <LessonDetail assignment={props.item} learnerName={props.learnerName} review={props.review} submission={props.submission} evidence={props.evidence} busy={props.busy} onUpdate={props.onUpdate} onSubmit={props.onSubmit} onAdjust={props.onAdjust} onApproveReview={props.onApproveReview} hideActions={!complete} /> : null}
  </article>;
}

function LessonDetail(props: { assignment: AssignmentDTO; learnerName?: string; review?: AssignmentReviewDTO; submission?: SubmissionDTO; evidence: EvidenceDTO[]; busy: boolean; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust: (item: AssignmentDTO) => void; onApproveReview: (review: AssignmentReviewDTO) => void; hideActions?: boolean }) {
  const sources = props.submission ? props.evidence.filter((item) => props.submission?.evidenceIds.includes(item.id)) : [];
  return <div className="lesson-focus-detail" onClick={(event) => event.stopPropagation()}>
    <header><div><span>{props.learnerName ? `${props.learnerName} · ` : ""}{props.assignment.subject}</span><h2>{props.assignment.title}</h2></div><span className={`lesson-focus-status ${props.assignment.status}`}>{statusLabel(props.assignment.status)}</span></header>
    <div className="lesson-focus-meta"><span>{props.assignment.scheduledDate ? longDate(props.assignment.scheduledDate) : "Not scheduled"}</span><span>{props.assignment.estimatedMinutes ? `${props.assignment.estimatedMinutes} minutes` : "Flexible length"}</span><span>{props.assignment.sourceKind === "practice" ? "Supplemental practice" : "Curriculum work"}</span></div>
    {props.assignment.instructions ? <p>{props.assignment.instructions}</p> : <p className="lesson-focus-empty">No additional lesson directions were added.</p>}
    {sources.length ? <div className="lesson-focus-sources"><span>Submitted work</span>{sources.map((source) => <a href={source.mimeType ? `/api/evidence/${source.id}/download` : `/app/records?q=${encodeURIComponent(source.title ?? source.rawText?.slice(0, 50) ?? "")}`} key={source.id}>{source.title ?? source.kind}<ArrowRight size={11} /></a>)}</div> : null}
    {props.review ? <CanvasReview review={props.review} assignment={props.assignment} submission={props.submission} evidence={props.evidence} learnerName={props.learnerName} busy={props.busy} onApprove={props.onApproveReview} compact /> : props.hideActions ? null : <div className="lesson-focus-actions"><button type="button" onClick={() => props.onUpdate(props.assignment, props.assignment.status === "completed" ? "planned" : "completed")} disabled={props.busy}><Check size={13} />{props.assignment.status === "completed" ? "Reopen lesson" : "Mark done"}</button><button type="button" onClick={() => props.onSubmit(props.assignment)}><FileCheck2 size={13} />Hand to Klio</button>{props.assignment.status !== "completed" ? <button type="button" onClick={() => props.onAdjust(props.assignment)} disabled={props.busy}><RotateCcw size={13} />Not finished</button> : null}</div>}
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
  if (kind === "needs_detail") return "Needs one detail";
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

function InsightNote({ insight, proposals, busy, onDecide, onAcknowledge, onDismiss, onStartPractice, onPracticeFollowUp }: { insight: KlioInsightDTO; proposals: AdjustmentDTO[]; busy: string | null; onDecide: (proposal: AdjustmentDTO, decision: "approve" | "reject" | "undo") => void; onAcknowledge: (proposal: AdjustmentDTO) => Promise<boolean>; onDismiss: (insight: KlioInsightDTO) => Promise<boolean>; onStartPractice: (input: { sessionId?: string; artifactId?: string }) => void; onPracticeFollowUp: (insight: KlioInsightDTO, action: "extend_time" | "create_more_practice") => void }) {
  const router = useRouter();
  const [undoing, setUndoing] = useState(false);
  const [dismissing, setDismissing] = useState(false);
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
  const tone = insight.kind === "adjusted" ? "note-green" : insight.kind === "practice_ready" ? "note-blue" : insight.kind === "needs_detail" ? "note-yellow" : "note-lilac";
  return <div className={`teacher-note teacher-note-insight ${tone} note-tilt-right`}>
    <span><Sparkles size={15} />{insight.kind === "adjusted" ? "Klio adjusted" : insight.kind === "practice_ready" ? "Practice ready" : insight.kind === "needs_detail" ? "Needs one detail" : "Klio noticed"}</span>
    <strong>{insight.title}</strong><small>{insight.summary}</small>
    <div className="teacher-note-actions">
      {practiceSessionId && practiceOutcome !== "needs_support" && practiceOutcome !== "understood" && practiceOutcome !== "checking" ? <button className="note-action-primary" type="button" onClick={() => onStartPractice({ sessionId: practiceSessionId, artifactId: artifactId ?? undefined })}>Start practice <ArrowRight size={12} /></button> : artifactId && !practiceOutcome ? <button className="note-action-primary" type="button" onClick={() => onStartPractice({ artifactId })}>Start practice <ArrowRight size={12} /></button> : null}
      {practiceOutcome === "needs_support" ? <>
        <button className="note-action-primary" type="button" onClick={() => onPracticeFollowUp(insight, "extend_time")} disabled={busy === insight.id}><Clock3 size={12} />Add 10 minutes</button>
        <button className="note-action-secondary" type="button" onClick={() => onPracticeFollowUp(insight, "create_more_practice")} disabled={busy === insight.id}><Plus size={12} />Make follow-up</button>
      </> : null}
      {undoAvailable && proposalId ? <button className="note-action-secondary" type="button" aria-label="Undo" onClick={() => void undo()} disabled={undoing || busy === proposalId}><RotateCcw size={12} />{undoing || busy === proposalId ? "Undoing…" : "Undo change"}</button> : null}
      {insight.evidenceRefs.length ? <Link className="note-action-quiet" href="/app/activity">Show evidence</Link> : null}
      <button className="note-action-dismiss" type="button" onClick={() => void dismiss()} disabled={dismissing}>{acknowledgesAdjustment ? <Check size={12} /> : <X size={12} />}{dismissing ? (acknowledgesAdjustment ? "Acknowledging…" : "Dismissing…") : (acknowledgesAdjustment ? "Acknowledge" : "Dismiss")}</button>
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

function WeekSurface(props: { familyId: string; workspaceLayouts: WorkspaceLayoutDTO[]; scopeId: string; assignments: AssignmentDTO[]; curricula: CurriculumUnitDTO[]; learner: StudentDTO | undefined; students: StudentDTO[]; chooseLearner: (id: string) => void; days: string[]; currentDate: string; selectedDate: string; setSelectedDate: (date: string) => void; capacity: number; pendingReviews: AssignmentReviewDTO[]; approvedReviews: AssignmentReviewDTO[]; submissions: SubmissionDTO[]; evidence: EvidenceDTO[]; proposals: AdjustmentDTO[]; acknowledgedProposalIds: string[]; reminders: ReminderDTO[]; artifacts: ArtifactDTO[]; practiceSessions: PracticeSessionDTO[]; insights: KlioInsightDTO[]; busy: string | null; onBuildWeek: () => void; onBuildNextWeek: () => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onMove: (assignmentId: string, date: string) => void; onSubmit: (item: AssignmentDTO) => void; onAdjust: (item: AssignmentDTO) => void; onDecide: (proposal: AdjustmentDTO, decision: "approve" | "reject" | "undo") => void; onAcknowledge: (proposal: AdjustmentDTO) => Promise<boolean>; onDismissInsight: (insight: KlioInsightDTO) => Promise<boolean>; onStartPractice: (input: { sessionId?: string; artifactId?: string }) => void; onDismissPractice: (session: PracticeSessionDTO, reason: PracticeDismissalReason) => void; onPracticeFollowUp: (insight: KlioInsightDTO, action: "extend_time" | "create_more_practice") => void; onApproveReview: (review: AssignmentReviewDTO) => void; capture: React.ReactNode }) {
  const isFamilyView = props.scopeId === "all";
  const [focusedLesson, setFocusedLesson] = useState<AssignmentDTO | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const weekAssignments = props.assignments.filter((item) => item.scheduledDate && props.days.includes(item.scheduledDate) && item.status !== "skipped");
  const activeReminder = props.reminders.find((item) => item.status === "pending" && isParentFacingReminder(item));
  const practices = props.artifacts.filter((item) => item.type === "practice" && practiceArtifactIsAvailable(item, props.practiceSessions)).slice(0, 3);
  const visibleInsights = rankWorkspaceInsights(props.insights)
    .filter((item) => item.kind !== "on_track" && isParentFacingWorkspaceInsight(item) && !isResolvedAdjustmentInsight(item, props.proposals))
    .slice(0, 2);
  const visibleProposal = props.proposals.find((proposal) => proposal.status === "proposed" && !visibleInsights.some((insight) => insight.actionRef.proposalId === proposal.id));
  const recentApplied = props.proposals.find((proposal) => proposal.status === "applied" && proposal.undoStatus === "available" && !proposal.acknowledgedAt && !props.acknowledgedProposalIds.includes(proposal.id) && !visibleInsights.some((insight) => insight.actionRef.proposalId === proposal.id));
  const totalFinished = weekAssignments.filter((item) => item.status === "completed").length;
  const scheduledLearners = new Set(weekAssignments.map((item) => item.studentId));
  const learnerCoverage = props.students.filter((student) => scheduledLearners.has(student.id));
  const schedule = weekAssignments.length ? <main className={`teacher-week-sheet ${isFamilyView ? "family-view" : ""}`} aria-label="Weekly schedule">
        {props.days.map((date) => {
          const items = weekAssignments.filter((item) => item.scheduledDate === date);
          const done = items.filter((item) => item.status === "completed").length;
          return <section className={date === props.selectedDate ? "selected" : ""} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-klio-assignment")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); const assignmentId = event.dataTransfer.getData("application/x-klio-assignment"); if (assignmentId) props.onMove(assignmentId, date); }} key={date}>
            <button type="button" className="teacher-week-day-head" onClick={() => props.setSelectedDate(date)}><span>{weekday(date)}</span><strong>{dayNumber(date)}</strong><small>{done}/{items.length}</small></button>
            <div className="teacher-week-day-body">{isFamilyView ? props.students.map((student) => {
              const learnerItems = items.filter((item) => item.studentId === student.id);
              return learnerItems.length ? <div className="teacher-week-learner-lane" key={student.id}><small>{student.displayName}</small>{learnerItems.map((item) => <WeekItem item={item} onOpen={() => { setFocusedLesson(item); setFocusKey((value) => value + 1); }} key={item.id} />)}</div> : null;
            }) : items.map((item) => <WeekItem item={item} onOpen={() => { setFocusedLesson(item); setFocusKey((value) => value + 1); }} key={item.id} />)}</div>
          </section>;
        })}
      </main> : <div className="teacher-week-empty"><Sparkles size={25} /><span>{isFamilyView ? "Your family is ready" : `${props.learner?.displayName ?? "This learner"} is ready`}</span><h2>Turn the learning setup into this week.</h2><p>{props.curricula.length ? isFamilyView ? `Klio will plan ${formatNames(props.students.map((student) => student.displayName))} together, using each learner’s subjects, teaching rhythm, learning days, and daily limit.` : `${props.curricula.length} ${props.curricula.length === 1 ? "subject is" : "subjects are"} ready: ${props.curricula.slice(0, 4).map((unit) => unit.subject).join(", ")}${props.curricula.length > 4 ? `, and ${props.curricula.length - 4} more` : ""}.` : "Set up subjects for your learners, then Klio can build a realistic family week."}</p>{props.curricula.length ? <button type="button" onClick={props.onBuildWeek} disabled={props.busy === "build-week"}>{props.busy === "build-week" ? "Building the family week…" : props.students.length > 1 ? "Build the family week" : "Build this week"}<ArrowRight size={13} /></button> : <Link href="/app/settings">Set up learners <ArrowRight size={13} /></Link>}</div>;

  const items: SpatialWorkspaceItem[] = [
    { id: "schedule", label: "Schedule", title: weekRangeLabel(props.days), x: 650, y: 470, width: 1240, focusZoom: .9, minFocusZoom: .72, className: "spatial-week-schedule", children: schedule },
    ...(props.pendingReviews.length ? [{ id: "review", label: "Review ready", title: "Klio checked this work", x: 240, y: 540, width: 500, focusZoom: 1.02, className: "spatial-summary-object", children: <CanvasReview review={props.pendingReviews[0]} assignment={props.assignments.find((item) => item.id === props.pendingReviews[0].assignmentId)} submission={props.submissions.find((item) => item.id === props.pendingReviews[0].submissionId)} evidence={props.evidence} learnerName={props.students.find((student) => student.id === props.assignments.find((item) => item.id === props.pendingReviews[0].assignmentId)?.studentId)?.displayName} busy={props.busy === props.pendingReviews[0].id} onApprove={props.onApproveReview} /> }] : []),
    ...(recentApplied ? [{ id: `adjusted:${recentApplied.id}`, label: "Klio adjusted", title: recentApplied.summary, x: 1980, y: 500, width: 390, focusZoom: 1, className: "spatial-note-object", children: <AdjustmentNote proposal={recentApplied} busy={props.busy === recentApplied.id} onUndo={() => props.onDecide(recentApplied, "undo")} onAcknowledge={() => props.onAcknowledge(recentApplied)} /> }] : []),
    ...visibleInsights.map((insight, index) => ({ id: `insight:${insight.id}`, label: insightLabel(insight.kind), title: insight.title, x: index === 0 ? 1980 : 240, y: 560 + index * 300, width: 390, focusZoom: 1, className: "spatial-note-object", children: <InsightNote insight={insight} proposals={props.proposals} busy={props.busy} onDecide={props.onDecide} onAcknowledge={props.onAcknowledge} onDismiss={props.onDismissInsight} onStartPractice={props.onStartPractice} onPracticeFollowUp={props.onPracticeFollowUp} /> })),
    ...(visibleProposal ? [{ id: `adjustment:${visibleProposal.id}`, label: "Schedule ready", title: visibleProposal.summary, x: 1980, y: 910, width: 390, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note teacher-note-decision note-yellow"><span><RotateCcw size={15} />Needs your approval</span><strong>{visibleProposal.summary}</strong><small>This family policy asks before applying the change.</small><div className="teacher-note-actions"><button type="button" onClick={() => props.onDecide(visibleProposal, "approve")} disabled={props.busy === visibleProposal.id}><Check size={12} />{props.busy === visibleProposal.id ? "Applying…" : "Accept changes"}</button><Link href="/app/adjustments">Review <ArrowRight size={12} /></Link></div></div> }] : []),
    ...practices.map((practice, index) => {
      const practiceSession = props.practiceSessions.find((item) => item.artifactId === practice.id && ["ready", "in_progress"].includes(item.status));
      const practiceLearnerName = practice.studentId ? props.students.find((student) => student.id === practice.studentId)?.displayName : undefined;
      return { id: `practice:${practice.id}`, label: "Practice", title: `${practiceLearnerName ? `${practiceLearnerName} · ` : ""}${practice.title}`, x: 1980, y: 1110 + index * 320, width: 420, focusZoom: 1.02, className: "spatial-practice-object", children: <CanvasPractice familyId={props.familyId} artifact={practice} learnerName={practiceLearnerName} session={practiceSession} busy={props.busy === practice.id || props.busy === practiceSession?.id} onStart={props.onStartPractice} onDismiss={props.onDismissPractice} /> };
    }),
    ...(activeReminder ? [{ id: `reminder:${activeReminder.id}`, label: "Reminder", title: activeReminder.title, x: 240, y: 1180, width: 350, focusZoom: 1, className: "spatial-note-object", children: <div className="teacher-note note-cream"><span><Clock3 size={15} />Reminder</span><strong>{activeReminder.title}</strong><small>{activeReminder.dueAt ? dueLabel(activeReminder.dueAt) : "No due date"}</small></div> }] : []),
    ...(focusedLesson ? [{ id: "lesson", parentId: "schedule", label: "Lesson", title: focusedLesson.title, x: 1990, y: 390, width: 520, focusZoom: 1.05, hideLandmark: true, movable: false, persistPosition: false, className: "spatial-lesson-object", children: <LessonDetail assignment={focusedLesson} learnerName={props.students.find((student) => student.id === focusedLesson.studentId)?.displayName} review={props.pendingReviews.find((item) => item.assignmentId === focusedLesson.id)} submission={props.submissions.find((item) => item.assignmentId === focusedLesson.id)} evidence={props.evidence} busy={props.busy === focusedLesson.id || props.busy === props.pendingReviews.find((item) => item.assignmentId === focusedLesson.id)?.id} onUpdate={props.onUpdate} onSubmit={props.onSubmit} onAdjust={props.onAdjust} onApproveReview={props.onApproveReview} /> }] : []),
  ];

  const toolbar = <div className="spatial-canvas-toolbar">
    <div className="teacher-canvas-nav"><button type="button" onClick={() => props.setSelectedDate(addDays(props.days[0], -7))} aria-label="Previous week"><ArrowLeft size={15} /></button><button type="button" className="teacher-canvas-today" onClick={() => props.setSelectedDate(props.currentDate)}>Today</button><button type="button" onClick={() => props.setSelectedDate(addDays(props.days[0], 7))} aria-label="Next week"><ArrowRight size={15} /></button></div>
    <div className="teacher-canvas-heading"><span>Weekly plan</span><h1>{weekRangeLabel(props.days)}</h1><p>{weekAssignments.length} lessons · {totalFinished} complete{isFamilyView ? ` · ${learnerCoverage.length} of ${props.students.length} learners scheduled` : ""}</p></div>
    <div className="teacher-week-actions"><button type="button" className="teacher-plan-next" onClick={props.onBuildNextWeek} disabled={props.busy === "build-week"}>{props.busy === "build-week" ? "Planning…" : "Plan next week"}</button><label><span>View</span><select aria-label="View schedule for" value={props.scopeId} onChange={(event) => props.chooseLearner(event.target.value)}>{props.students.length > 1 ? <option value="all">Family</option> : null}{props.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div>
  </div>;

  const layout = props.workspaceLayouts.find((item) => item.surface === "week" && item.scopeKey === props.scopeId);
  return <SpatialWorkspace ariaLabel="Weekly homeschool teaching board" persistenceKey={`week:${props.scopeId}`} items={items} initialView={{ x: -415, y: -160, zoom: .76 }} overviewView={{ x: -25, y: -105, zoom: .48 }} homeItemId="schedule" focusRequest={focusedLesson ? { id: "lesson", key: focusKey } : null} layoutPersistence={{ familyId: props.familyId, surface: "week", scopeKey: props.scopeId, layoutVersion: 2, positions: layout?.layoutVersion === 2 ? layout.positions : undefined }} onCameraChange={(camera: SpatialCameraState) => { if (camera.level !== "item" || camera.id !== "lesson") setFocusedLesson(null); }} toolbar={toolbar} assistant={<div className="spatial-assistant-surface">{props.capture}</div>} />;
}

function WeekItem({ item, onOpen }: { item: AssignmentDTO; onOpen: () => void }) {
  return <button type="button" draggable onDragStart={(event) => startAssignmentDrag(event, item)} className={`teacher-week-item subject-${subjectTone(item.subject)} ${item.sourceKind === "practice" ? "supplemental" : ""} ${item.status === "completed" ? "completed" : ""}`} onClick={onOpen}><span>{item.subject}</span><strong>{item.title}</strong><small>{item.sourceKind === "practice" ? "Practice · " : ""}{item.estimatedMinutes ?? 0} min</small>{item.status === "completed" ? <Check size={12} /> : null}</button>;
}

function AssignmentRow({ item, busy, onUpdate, onSubmit, onAdjust }: { item: AssignmentDTO; busy: boolean; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust?: (item: AssignmentDTO) => void }) {
  return <motion.article layout className={`ops-assignment ${item.status}`}>
    <button type="button" className="assignment-state" onClick={() => onUpdate(item, item.status === "completed" ? "planned" : "completed")} disabled={busy} aria-label={item.status === "completed" ? `Reopen ${item.title}` : `Complete ${item.title}`}>{item.status === "completed" ? <Check size={15} /> : <span />}</button>
    <div><p><span>{item.subject}</span>{item.scheduledTime ? <small>{formatTime(item.scheduledTime)}</small> : null}{item.estimatedMinutes ? <small>{item.estimatedMinutes} min</small> : null}</p><strong>{item.title}</strong>{item.instructions ? <em>{item.instructions}</em> : null}</div>
    <span className={`status-word ${item.status}`}>{statusLabel(item.status)}</span>
    <div className="assignment-actions">{item.status !== "needs_review" && item.status !== "submitted" ? <button type="button" onClick={() => onSubmit(item)}><FileCheck2 size={12} />Add work</button> : null}{onAdjust && (item.status === "planned" || item.status === "doing") ? <button type="button" onClick={() => onAdjust(item)} disabled={busy}><RotateCcw size={12} />Not finished</button> : null}</div>
  </motion.article>;
}

function AssignmentsSurface(props: { familyId: string; studentId: string; students: StudentDTO[]; enabledWeekdays: number[]; units: CurriculumUnitDTO[]; assignments: AssignmentDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; showCurriculum: boolean; setShowCurriculum: (value: boolean) => void; onSubmit: (item: AssignmentDTO) => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void }) {
  const router = useRouter();
  const isFamilyView = props.studentId === "all";
  const [draftUnit, setDraftUnit] = useState<CurriculumUnitDTO | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(props.units[0]?.id ?? null);
  const [frequencyOverrides, setFrequencyOverrides] = useState<Record<string, number>>({});
  const selectedUnit = props.units.find((unit) => unit.id === selectedUnitId) ?? props.units[0] ?? null;
  const visibleAssignments = selectedUnit ? props.assignments.filter((item) => item.curriculumUnitId === selectedUnit.id) : props.assignments.filter((item) => !item.curriculumUnitId);
  function openCurriculum(unit: CurriculumUnitDTO | null) { setDraftUnit(unit); props.setShowCurriculum(true); }
  function closeCurriculum() { props.setShowCurriculum(false); setDraftUnit(null); }
  async function addCurriculum(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); props.setBusy("curriculum");
    const response = await fetch("/api/curriculum", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ curriculumUnitId: draftUnit?.id ?? null, familyId: props.familyId, studentId: draftUnit?.studentId ?? props.studentId, subject: data.get("subject"), title: data.get("title"), sequenceLabel: data.get("sequenceLabel"), startSequence: Number(data.get("startSequence")), count: Number(data.get("count")), startDate: data.get("startDate"), weekdays: data.getAll("weekdays").map(Number), scheduledTime: data.get("scheduledTime") || null, estimatedMinutes: Number(data.get("estimatedMinutes")), weeklyFrequency: Number(data.get("weeklyFrequency")), curriculumUrl: data.get("curriculumUrl") || null }) });
    const result = await response.json(); props.setBusy(null);
    if (!response.ok) return props.setNotice(result.error ?? "Klio could not add that curriculum.");
    closeCurriculum(); props.setNotice(`${result.assignments.length} ${result.unit.subject} assignments added.`); router.refresh(); form.reset();
  }
  async function updateFrequency(unit: CurriculumUnitDTO, weeklyFrequency: number) {
    props.setBusy(`rhythm-${unit.id}`); props.setNotice(null);
    const response = await fetch(`/api/curriculum/${unit.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ weeklyFrequency }) });
    const result = await response.json(); props.setBusy(null);
    if (!response.ok) return props.setNotice(result.error ?? "Klio could not save that teaching rhythm.");
    setFrequencyOverrides((current) => ({ ...current, [unit.id]: weeklyFrequency }));
    props.setNotice(`${unit.subject} will be taught ${weeklyFrequency} ${weeklyFrequency === 1 ? "time" : "times"} per week.`); router.refresh();
  }
  return <div className="assignments-layout">
    <aside className="curriculum-index"><header><span>Curriculum</span>{!isFamilyView ? <button type="button" onClick={() => openCurriculum(null)}><Plus size={13} />Add once</button> : null}</header>{props.units.length ? props.units.map((unit) => {
      const items = props.assignments.filter((item) => item.curriculumUnitId === unit.id);
      const completed = items.filter((item) => item.status === "completed").length;
      const active = selectedUnit?.id === unit.id;
      return <section className={active ? "active" : ""} key={unit.id}>
        <p>{isFamilyView ? `${props.students.find((student) => student.id === unit.studentId)?.displayName ?? "Learner"} · ${unit.subject}` : unit.subject}</p>
        <button className="curriculum-unit-select" type="button" onClick={() => setSelectedUnitId(unit.id)}>{unit.title}<ChevronRight size={11} /></button>
        {active ? <div className="curriculum-unit-detail">
          <label className="curriculum-rhythm"><span>Teach</span><select aria-label={`${unit.subject} times per week`} value={frequencyOverrides[unit.id] ?? unit.weeklyFrequency} onChange={(event) => void updateFrequency(unit, Number(event.target.value))} disabled={props.busy === `rhythm-${unit.id}`}>{[1,2,3,4,5,6,7].map((frequency) => <option value={frequency} key={frequency}>{frequency}× / week</option>)}</select></label>
          <span>{items.length ? `${completed} of ${items.length} completed` : "Ready for Klio to plan"}</span>
          <i><b style={{ width: `${items.length ? completed / items.length * 100 : 0}%` }} /></i>
          <button type="button" onClick={() => openCurriculum(unit)}>{items.length ? "Add more lessons" : "Schedule lessons"}<ChevronRight size={11} /></button>
        </div> : null}
      </section>;
    }) : <div className="curriculum-empty"><strong>Add each curriculum once.</strong><span>Klio creates the numbered assignments and keeps their order when the week changes.</span></div>}</aside>
    <main className="assignment-library"><header><div><span>{selectedUnit ? `${isFamilyView ? `${props.students.find((student) => student.id === selectedUnit.studentId)?.displayName ?? "Learner"} · ` : ""}${selectedUnit.subject}` : "Other work"}</span><strong>{selectedUnit?.title ?? "Assignments without curriculum"}</strong><small>{visibleAssignments.filter((item) => item.status !== "completed" && item.status !== "skipped").length} active</small></div>{!isFamilyView ? <button type="button" onClick={() => openCurriculum(null)}><Plus size={14} />Add curriculum</button> : null}</header><div>{visibleAssignments.map((item) => <AssignmentRow item={item} busy={props.busy === item.id} onUpdate={props.onUpdate} onSubmit={props.onSubmit} key={item.id} />)}</div></main>
    <AnimatePresence>{props.showCurriculum ? <motion.form key={draftUnit?.id ?? "new"} className="curriculum-drawer" onSubmit={addCurriculum} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}><header><div><span>{draftUnit ? "Curriculum ready" : "New curriculum"}</span><h2>{draftUnit ? "Schedule the next lessons" : "Add the sequence once"}</h2><p>{draftUnit ? "This course was added during learner setup. Choose when its lessons begin." : "Klio will create the next assignments on your learning days."}</p></div><button type="button" onClick={closeCurriculum} aria-label="Close"><X size={17} /></button></header><div className="curriculum-fields"><label><span>Curriculum or course</span><input name="title" required placeholder="Algebra I" defaultValue={draftUnit?.title ?? ""} /></label><label><span>Subject</span><input name="subject" required placeholder="Math" defaultValue={draftUnit?.subject ?? ""} /></label><label><span>Numbering</span><select name="sequenceLabel" defaultValue={draftUnit?.sequenceLabel ?? "Lesson"}><option>Lesson</option><option>Unit</option><option>Chapter</option><option>Module</option></select></label><div className="field-pair"><label><span>Start at</span><input name="startSequence" type="number" min="1" defaultValue={draftUnit?.nextSequenceNumber ?? 1} required /></label><label><span>How many</span><input name="count" type="number" min="1" max="40" defaultValue="10" required /></label></div><label><span>First date</span><input name="startDate" type="date" defaultValue={today()} required /></label><fieldset><legend>Learning days</legend>{[[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[0,"Sun"]].map(([value,label]) => <label key={value}><input type="checkbox" name="weekdays" value={value} defaultChecked={props.enabledWeekdays.includes(Number(value))} disabled={!props.enabledWeekdays.includes(Number(value))} /><span>{label}</span></label>)}</fieldset><small>Enable additional learning days in the learner’s settings first.</small><label><span>Times per week</span><select name="weeklyFrequency" defaultValue={Math.min(draftUnit?.weeklyFrequency ?? 5, props.enabledWeekdays.length)}>{Array.from({ length: props.enabledWeekdays.length }, (_, index) => index + 1).map((frequency) => <option value={frequency} key={frequency}>{frequency}× per week</option>)}</select></label><div className="field-pair"><label><span>Preferred minutes</span><input name="estimatedMinutes" type="number" min="5" defaultValue={draftUnit?.defaultMinutes ?? 40} required /></label><label><span>Time</span><input name="scheduledTime" type="time" /></label></div><label><span>Reference link (Klio won’t open it)</span><input name="curriculumUrl" type="url" placeholder="Optional HTTP(S) reference" defaultValue={draftUnit?.curriculumUrl ?? ""} /></label></div><footer><button type="button" onClick={closeCurriculum}>Cancel</button><button type="submit" disabled={props.busy === "curriculum"}>{props.busy === "curriculum" ? "Adding…" : "Create assignments"}</button></footer></motion.form> : null}</AnimatePresence>
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

function AdjustmentsSurface(props: { assignments: AssignmentDTO[]; students: StudentDTO[]; proposals: AdjustmentDTO[]; planningProposals: PlanningProposalDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void }) {
  const router = useRouter();
  async function decide(proposal: AdjustmentDTO, decision: "approve" | "reject") { props.setBusy(proposal.id); const response = await fetch(`/api/adjustments/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }); const result = await response.json(); props.setBusy(null); if (!response.ok) return props.setNotice(result.error ?? "Klio could not apply that change."); props.setNotice(decision === "approve" ? "The week has been updated." : "The proposed change was declined."); router.refresh(); }
  async function decidePlanning(proposal: PlanningProposalDTO, decision: "approve" | "reject") { props.setBusy(proposal.id); const response = await fetch(`/api/planning-proposals/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }); const result = await response.json(); props.setBusy(null); if (!response.ok) return props.setNotice(result.error ?? "Klio could not apply that proposal."); props.setNotice(decision === "approve" ? "The approved plan is now part of the family workspace." : "The proposal was declined; current records are unchanged."); router.refresh(); }
  const current = props.proposals.filter((proposal) => proposal.status === "proposed");
  const planning = props.planningProposals.filter((proposal) => proposal.status === "proposed");
  return <div className="adjustments-list">
    {planning.map((proposal) => <article key={proposal.id}><header><div><span>{props.students.find((student) => student.id === proposal.studentId)?.displayName ?? "Learner"} · {planningKindLabel(proposal.proposalKind)} · {proposal.risk} risk</span><h2>{proposal.title}</h2><p>{proposal.summary}</p></div><Sparkles size={18} /></header><p>{proposal.reason}</p><PlanningChangeSummary proposal={proposal} assignments={props.assignments} /><footer><button type="button" onClick={() => void decidePlanning(proposal, "reject")} disabled={props.busy === proposal.id}>Decline</button><button type="button" onClick={() => void decidePlanning(proposal, "approve")} disabled={props.busy === proposal.id}><Check size={13} />{props.busy === proposal.id ? "Applying…" : proposal.proposalKind === "grade" ? "Return work" : "Approve proposal"}</button></footer></article>)}
    {current.map((proposal) => <article key={proposal.id}><header><div><span>{props.students.find((student) => student.id === proposal.studentId)?.displayName ?? "Learner"} · Proposed for week of {shortDate(proposal.weekStart)}</span><h2>{proposal.summary}</h2><p>{proposal.reason}</p></div><Sparkles size={18} /></header><ol>{proposal.actions.map((action) => { const assignment = props.assignments.find((item) => item.id === action.assignmentId); const before = action.beforeState as { scheduledDate?: string }; const after = action.afterState as { scheduledDate?: string; title?: string; subject?: string }; return <li key={action.id}><span>{action.actionType === "add_practice" ? after.subject ?? "Practice" : assignment?.subject ?? "Practice"}</span><strong>{action.actionType === "add_practice" ? after.title ?? "Focused review" : assignment?.title ?? "Focused review"}</strong><div><s>{before.scheduledDate ? weekday(before.scheduledDate) : "New"}</s><ArrowRight size={12} /><b>{after.scheduledDate ? weekday(after.scheduledDate) : "Unscheduled"}</b></div></li>; })}</ol><footer><button type="button" onClick={() => void decide(proposal, "reject")}>Keep current week</button><button type="button" onClick={() => void decide(proposal, "approve")} disabled={props.busy === proposal.id}><Check size={13} />{props.busy === proposal.id ? "Applying…" : "Approve changes"}</button></footer></article>)}
    {!planning.length && !current.length ? <div className="review-empty"><RotateCcw size={28} /><span>Proposed changes</span><h2>Nothing is waiting for your decision.</h2><p>Schedule, goal, curriculum, and return-work proposals appear here before they change family records.</p><Link href="/app">Return to this week <ArrowRight size={13} /></Link></div> : null}
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
function today() { return new Date().toISOString().slice(0,10); }
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
function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0,10); }
function formatMinutes(minutes: number) { const hours = Math.floor(minutes / 60); const remainder = minutes % 60; return [hours ? `${hours} hr` : "", remainder ? `${remainder} min` : ""].filter(Boolean).join(" ") || "No time planned"; }
function dueLabel(value: string) { return new Date(value).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
function subjectTone(subject: string) { const value = subject.toLowerCase(); if (/math|algebra|geometry|calculus/.test(value)) return "blue"; if (/science|biology|chemistry|physics/.test(value)) return "green"; if (/history|social|geography/.test(value)) return "gold"; if (/english|language|writing|literature|reading/.test(value)) return "lilac"; if (/art|music/.test(value)) return "rose"; return "neutral"; }
