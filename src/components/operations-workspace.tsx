"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, ClipboardCheck, Clock3, FileCheck2, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { InboxWorkspace } from "@/components/inbox-workspace";
import { unfinishedAssignmentsBefore } from "@/lib/assignments/attention";
import type { AdjustmentDTO, AssignmentDTO, AssignmentReviewDTO, CurriculumUnitDTO, SubmissionDTO } from "@/lib/data/operations";
import type { AgentTurnDTO, ArtifactDTO, CategoryDTO, EvidenceDTO, ReminderDTO, StudentDTO } from "@/lib/data/workspace";

type Surface = "today" | "week" | "assignments" | "review" | "adjustments";
type Workspace = {
  family: { id: string; name: string; timezone: string; available_days: unknown };
  students: StudentDTO[];
  evidence: EvidenceDTO[];
  categories: CategoryDTO[];
  reminders: ReminderDTO[];
  artifacts: ArtifactDTO[];
  latestAgentTurn: AgentTurnDTO | null;
  pendingApprovals: number;
  currentDate: string;
  curriculumUnits: CurriculumUnitDTO[];
  assignments: AssignmentDTO[];
  submissions: SubmissionDTO[];
  assignmentReviews: AssignmentReviewDTO[];
  adjustments: AdjustmentDTO[];
};

export function OperationsWorkspace({ surface, workspace, initialSelectedDate, initialStudentId }: { surface: Surface; workspace: Workspace; initialSelectedDate?: string; initialStudentId?: string }) {
  const router = useRouter();
  const defaultsToFamily = workspace.students.length > 1;
  const [studentId, setStudentId] = useState(defaultsToFamily ? (initialStudentId ?? "all") : (initialStudentId ?? workspace.students[0]?.id ?? ""));
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate ?? initialDate(workspace.assignments, studentId, workspace.currentDate));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCurriculum, setShowCurriculum] = useState(false);
  const [submissionAssignment, setSubmissionAssignment] = useState<AssignmentDTO | null>(null);
  const [captureAssignment, setCaptureAssignment] = useState<AssignmentDTO | null>(null);
  const selectedLearner = workspace.students.find((student) => student.id === studentId);
  const learner = selectedLearner ?? workspace.students[0];
  const assignments = studentId === "all" ? workspace.assignments : workspace.assignments.filter((item) => item.studentId === studentId);
  const days = useMemo(() => workWeek(selectedDate), [selectedDate]);
  const pendingReviews = workspace.assignmentReviews.filter((review) => review.status === "draft" && assignments.some((item) => item.id === review.assignmentId));
  const proposals = workspace.adjustments.filter((proposal) => (studentId === "all" || proposal.studentId === studentId) && proposal.status === "proposed");
  const captureWorkspace = <InboxWorkspace familyId={workspace.family.id} students={workspace.students} categories={workspace.categories} initialEvidence={workspace.evidence} initialReminders={workspace.reminders} initialArtifacts={workspace.artifacts} pendingApprovals={workspace.pendingApprovals} initialAgentTurn={workspace.latestAgentTurn} initialStudentId={learner?.id ?? ""} assignmentContext={captureAssignment ? { id: captureAssignment.id, studentId: captureAssignment.studentId, title: captureAssignment.title, subject: captureAssignment.subject } : null} onAssignmentDrop={(assignmentId) => setCaptureAssignment(workspace.assignments.find((item) => item.id === assignmentId) ?? null)} onAssignmentContextClear={() => setCaptureAssignment(null)} compact dashboard />;

  async function updateAssignment(assignment: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") {
    setBusy(assignment.id); setNotice(null);
    const response = await fetch(`/api/assignments/${assignment.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not update that assignment.");
    setNotice(status === "completed" ? `${assignment.title} marked complete.` : `${assignment.title} updated.`);
    router.refresh();
  }

  async function proposeAdjustments(items: AssignmentDTO[]) {
    const [first] = items;
    if (!first) return;
    setBusy(first.id); setNotice(null);
    const response = await fetch("/api/adjustments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId: workspace.family.id, studentId: first.studentId, ...(items.length === 1 ? { assignmentId: first.id } : { assignmentIds: items.map((item) => item.id) }) }) });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not adjust the week.");
    setNotice("Klio prepared a coordinated schedule. Accept it here or review the details.");
    router.refresh();
  }

  async function decideAdjustment(proposal: AdjustmentDTO, decision: "approve" | "reject") {
    setBusy(proposal.id); setNotice(null);
    const response = await fetch(`/api/adjustments/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) return setNotice(result.error ?? "Klio could not apply that change.");
    setNotice(decision === "approve" ? "The week has been updated." : "The proposed change was declined.");
    router.refresh();
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
      proposals={proposals}
      artifacts={workspace.artifacts.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)}
      busy={busy}
      onUpdate={updateAssignment}
      onSubmit={setCaptureAssignment}
      onAdjust={(item) => void proposeAdjustments([item])}
      onAdjustAll={(items) => void proposeAdjustments(items)}
      onDecide={(proposal, decision) => void decideAdjustment(proposal, decision)}
      capture={captureWorkspace}
    /> : null}
    {surface === "week" ? <WeekSurface scopeId={studentId} assignments={assignments} curricula={workspace.curriculumUnits.filter((unit) => (studentId === "all" || unit.studentId === studentId) && unit.status === "active")} learner={selectedLearner} students={workspace.students} chooseLearner={chooseLearner} days={days} selectedDate={selectedDate} setSelectedDate={setSelectedDate} capacity={learner?.dailyCapacityMinutes ?? 180} pendingReviews={pendingReviews} proposals={proposals} reminders={workspace.reminders.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)} artifacts={workspace.artifacts.filter((item) => studentId === "all" || !item.studentId || item.studentId === studentId)} busy={busy} onBuildWeek={() => buildWeek()} onBuildNextWeek={() => buildWeek(addDays(days[0], 7))} onUpdate={updateAssignment} onSubmit={setCaptureAssignment} onAdjust={(item) => void proposeAdjustments([item])} onDecide={(proposal, decision) => void decideAdjustment(proposal, decision)} capture={captureWorkspace} /> : null}
    {surface === "assignments" ? <AssignmentsSurface familyId={workspace.family.id} studentId={studentId} students={workspace.students} units={workspace.curriculumUnits.filter((unit) => studentId === "all" || unit.studentId === studentId)} assignments={assignments} busy={busy} setBusy={setBusy} setNotice={setNotice} showCurriculum={showCurriculum} setShowCurriculum={setShowCurriculum} onSubmit={setSubmissionAssignment} onUpdate={updateAssignment} /> : null}
    {surface === "review" ? <ReviewSurface assignments={assignments} students={workspace.students} reviews={pendingReviews} submissions={workspace.submissions} legacyCount={workspace.pendingApprovals} busy={busy} setBusy={setBusy} setNotice={setNotice} /> : null}
    {surface === "adjustments" ? <AdjustmentsSurface assignments={assignments} students={workspace.students} proposals={workspace.adjustments.filter((proposal) => studentId === "all" || proposal.studentId === studentId)} busy={busy} setBusy={setBusy} setNotice={setNotice} /> : null}

    <AnimatePresence>{submissionAssignment ? <SubmissionPanel assignment={submissionAssignment} familyEvidence={workspace.evidence.filter((item) => item.studentIds.includes(submissionAssignment.studentId)).slice(0, 12)} busy={busy} setBusy={setBusy} setNotice={setNotice} close={() => setSubmissionAssignment(null)} /> : null}</AnimatePresence>
  </div>;
}

function DaySurface(props: {
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
  proposals: AdjustmentDTO[];
  artifacts: ArtifactDTO[];
  busy: string | null;
  onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void;
  onSubmit: (item: AssignmentDTO) => void;
  onAdjust: (item: AssignmentDTO) => void;
  onAdjustAll: (items: AssignmentDTO[]) => void;
  onDecide: (proposal: AdjustmentDTO, decision: "approve" | "reject") => void;
  capture: React.ReactNode;
}) {
  const dayAssignments = props.assignments.filter((item) => item.scheduledDate === props.selectedDate && item.status !== "skipped");
  const [selectedId, setSelectedId] = useState<string | null>(() => dayAssignments.find((item) => item.status !== "completed")?.id ?? dayAssignments[0]?.id ?? null);
  const minutes = dayAssignments.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
  const completed = dayAssignments.filter((item) => item.status === "completed").length;
  const activeReminders = props.reminders.filter((item) => item.status === "pending").slice(0, 2);
  const practice = props.artifacts.find((item) => item.type === "practice" && ["approved", "draft"].includes(item.status));
  const unfinished = unfinishedAssignmentsBefore(props.assignments, props.currentDate);
  const firstUnfinished = unfinished[0];
  const learnerUnfinished = firstUnfinished ? unfinished.filter((item) => item.studentId === firstUnfinished.studentId) : [];
  const unfinishedLearnerName = firstUnfinished ? props.students.find((student) => student.id === firstUnfinished.studentId)?.displayName ?? "Your learner" : "";
  const selectedDayIsPast = props.selectedDate < props.currentDate;
  const selectedDayIsToday = props.selectedDate === props.currentDate;
  const isFamilyView = props.scopeId === "all";
  return <div className="teacher-canvas teacher-day-canvas">
    <header className="teacher-canvas-toolbar">
      <div className="teacher-date-control">
        <button type="button" onClick={() => props.setSelectedDate(addDays(props.selectedDate, -1))} aria-label="Previous day"><ArrowLeft size={16} /></button>
        <div><span>Day plan</span><h1>{longDate(props.selectedDate)}</h1><p>{dayAssignments.length} {dayAssignments.length === 1 ? "lesson" : "lessons"} · {formatMinutes(minutes)}</p></div>
        <button type="button" onClick={() => props.setSelectedDate(addDays(props.selectedDate, 1))} aria-label="Next day"><ArrowRight size={16} /></button>
      </div>
      <div className="teacher-toolbar-actions"><Link href="/app/week"><CalendarDays size={14} />This week</Link><label><span>View</span><select aria-label="View day plan for" value={props.scopeId} onChange={(event) => props.chooseLearner(event.target.value)}>{props.students.length > 1 ? <option value="all">Family</option> : null}{props.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div>
    </header>

    <div className="teacher-orbit">
      <aside className="teacher-notes teacher-notes-left" aria-label="Klio notes">
        {props.reviews[0] ? <Link className="teacher-note note-lilac note-tilt-left" href="/app/review"><span><ClipboardCheck size={15} />Ready for review</span><strong>{props.reviews.length} {props.reviews.length === 1 ? "assignment" : "assignments"}</strong><small>Check Klio’s feedback</small><ArrowRight size={15} /></Link> : <div className={`teacher-note ${selectedDayIsPast && completed < dayAssignments.length ? "note-cream" : "note-green"} note-tilt-left`}><span><Check size={15} />{selectedDayIsToday ? "Today’s pace" : selectedDayIsPast ? `${weekdayLong(props.selectedDate)}’s result` : `${weekdayLong(props.selectedDate)}’s plan`}</span><strong>{completed} of {dayAssignments.length} finished</strong><small>{completed === dayAssignments.length && dayAssignments.length ? "That is everything planned." : selectedDayIsPast ? "Unfinished work needs a new place." : "The plan is ready when you are."}</small></div>}
        {activeReminders[1] ? <div className="teacher-note note-cream note-tilt-right"><span><Clock3 size={15} />Reminder</span><strong>{activeReminders[1].title}</strong><small>{activeReminders[1].dueAt ? dueLabel(activeReminders[1].dueAt) : "No due date"}</small></div> : null}
      </aside>

      <main className={`teacher-day-sheet ${isFamilyView ? "family-view" : ""}`}>
        <header><div><span>{isFamilyView ? "Family work" : `${props.learner?.displayName ?? "Learner"}’s work`}</span><strong>{completed}/{dayAssignments.length} complete</strong></div><i><b style={{ width: `${dayAssignments.length ? completed / dayAssignments.length * 100 : 0}%` }} /></i></header>
        <div className="teacher-day-list">
          {dayAssignments.length ? dayAssignments.map((item, index) => <DayAssignmentRow item={item} learnerName={isFamilyView ? props.students.find((student) => student.id === item.studentId)?.displayName : undefined} selected={selectedId === item.id} busy={props.busy === item.id} onSelect={() => setSelectedId(item.id)} onUpdate={props.onUpdate} onSubmit={props.onSubmit} onAdjust={props.onAdjust} index={index} key={item.id} />) : <div className="day-empty"><CalendarDays size={25} /><strong>The page is open today.</strong><span>Leave it clear or ask Klio to plan from your curriculum.</span><Link href="/app/week">Plan this week <ArrowRight size={12} /></Link></div>}
        </div>
      </main>

      <aside className="teacher-notes teacher-notes-right" aria-label="Next from Klio">
        {props.proposals[0] ? <div className="teacher-note teacher-note-decision note-yellow note-tilt-right"><span><RotateCcw size={15} />Schedule ready</span><strong>{props.proposals[0].summary}</strong><small>Nothing moves until you accept.</small><div className="teacher-note-actions"><button type="button" onClick={() => props.onDecide(props.proposals[0], "approve")} disabled={props.busy === props.proposals[0].id}><Check size={12} />{props.busy === props.proposals[0].id ? "Applying…" : "Accept changes"}</button><Link href="/app/adjustments">Review <ArrowRight size={12} /></Link></div></div> : firstUnfinished ? <button className="teacher-note note-yellow note-tilt-right" type="button" onClick={() => props.onAdjustAll(learnerUnfinished)} disabled={props.busy === firstUnfinished.id} aria-label={`Prepare a new schedule for ${unfinishedLearnerName}’s ${learnerUnfinished.length} unfinished ${learnerUnfinished.length === 1 ? "lesson" : "lessons"}`}><span><RotateCcw size={15} />Unfinished work</span><strong>{unfinishedLearnerName} has {learnerUnfinished.length} {learnerUnfinished.length === 1 ? "lesson" : "lessons"} behind</strong><small>{props.busy === firstUnfinished.id ? "Preparing one coordinated schedule…" : "Move them together and preserve each course’s order."}</small><ArrowRight size={15} /></button> : activeReminders[0] ? <div className="teacher-note note-yellow note-tilt-right"><span><Clock3 size={15} />Reminder</span><strong>{activeReminders[0].title}</strong><small>{activeReminders[0].dueAt ? dueLabel(activeReminders[0].dueAt) : "No due date"}</small></div> : null}
        {practice ? <Link className="teacher-note note-blue note-tilt-left" href={`/app/artifacts/${practice.id}`}><span><Sparkles size={15} />Practice idea</span><strong>{practice.title}</strong><small>Open when it is useful</small><ArrowRight size={15} /></Link> : null}
        {!props.proposals.length && !unfinished.length && !activeReminders.length && !practice ? <div className="teacher-note note-green note-tilt-right"><span><Check size={15} />From Klio</span><strong>Nothing needs attention.</strong><small>Your week is in good shape.</small></div> : null}
      </aside>
    </div>

    <div className="teacher-klio-dock">{props.capture}</div>
  </div>;
}

function DayAssignmentRow(props: { item: AssignmentDTO; learnerName?: string; selected: boolean; busy: boolean; index: number; onSelect: () => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust: (item: AssignmentDTO) => void }) {
  const complete = props.item.status === "completed";
  return <article className={`day-assignment ${props.selected ? "selected" : ""} ${complete ? "completed" : ""}`} draggable onDragStart={(event) => startAssignmentDrag(event, props.item)} onClick={props.onSelect}>
    <time>{props.item.scheduledTime ? formatTime(props.item.scheduledTime) : props.index === 0 ? "Start here" : "Next"}</time>
    <span className="day-subject-mark">{props.item.subject.slice(0, 1).toUpperCase()}</span>
    <div><small>{props.learnerName ? `${props.learnerName} · ${props.item.subject}` : props.item.subject}</small><strong>{props.item.title}</strong>{props.item.instructions ? <p>{props.item.instructions}</p> : null}</div>
    <span className="day-duration">{props.item.estimatedMinutes ? `${props.item.estimatedMinutes} min` : "Flexible"}</span>
    <span className="day-state">{complete ? <><Check size={15} />Done</> : statusLabel(props.item.status)}</span>
    {props.selected ? <div className="day-row-actions" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => props.onUpdate(props.item, complete ? "planned" : "completed")} disabled={props.busy}><Check size={12} />{complete ? "Reopen" : "Done"}</button>
      <button type="button" onClick={() => props.onSubmit(props.item)}><FileCheck2 size={12} />Add work</button>
      {!complete ? <button type="button" onClick={() => props.onAdjust(props.item)} disabled={props.busy}><RotateCcw size={12} />Not finished</button> : null}
    </div> : null}
  </article>;
}

function WeekSurface(props: { scopeId: string; assignments: AssignmentDTO[]; curricula: CurriculumUnitDTO[]; learner: StudentDTO | undefined; students: StudentDTO[]; chooseLearner: (id: string) => void; days: string[]; selectedDate: string; setSelectedDate: (date: string) => void; capacity: number; pendingReviews: AssignmentReviewDTO[]; proposals: AdjustmentDTO[]; reminders: ReminderDTO[]; artifacts: ArtifactDTO[]; busy: string | null; onBuildWeek: () => void; onBuildNextWeek: () => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust: (item: AssignmentDTO) => void; onDecide: (proposal: AdjustmentDTO, decision: "approve" | "reject") => void; capture: React.ReactNode }) {
  const isFamilyView = props.scopeId === "all";
  const selected = props.assignments.filter((item) => item.scheduledDate === props.selectedDate && item.status !== "skipped");
  const weekAssignments = props.assignments.filter((item) => item.scheduledDate && props.days.includes(item.scheduledDate) && item.status !== "skipped");
  const scheduledCurricula = new Set(weekAssignments.map((item) => item.curriculumUnitId).filter(Boolean)).size;
  const minutes = selected.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
  const activeReminder = props.reminders.find((item) => item.status === "pending");
  const practice = props.artifacts.find((item) => item.type === "practice" && ["approved", "draft"].includes(item.status));
  const totalFinished = weekAssignments.filter((item) => item.status === "completed").length;
  return <div className="teacher-canvas teacher-week-canvas">
    <header className="teacher-canvas-toolbar teacher-week-toolbar">
      <div className="teacher-week-title"><span>This week</span><h1>{shortDate(props.days[0])} – {shortDate(props.days[4])}</h1><p>{weekAssignments.length} lessons · {totalFinished} complete{isFamilyView ? ` · ${props.students.length} learners` : ""}</p></div>
      <div className="teacher-week-actions"><div className="teacher-week-controls"><button type="button" onClick={() => props.setSelectedDate(addDays(props.days[0], -7))} aria-label="Previous week"><ArrowLeft size={16} /></button><button type="button" onClick={() => props.setSelectedDate(today())}>Today</button><button type="button" onClick={() => props.setSelectedDate(addDays(props.days[0], 7))} aria-label="Next week"><ArrowRight size={16} /></button></div><label><span>View</span><select aria-label="View schedule for" value={props.scopeId} onChange={(event) => props.chooseLearner(event.target.value)}>{props.students.length > 1 ? <option value="all">Family</option> : null}{props.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div>
    </header>

    {weekAssignments.length ? <div className="teacher-week-orbit">
      <aside className="teacher-week-margin teacher-week-margin-left">
        <div className="teacher-note note-green note-tilt-left"><span><Check size={15} />Week so far</span><strong>{totalFinished} lessons finished</strong><small>{scheduledCurricula === props.curricula.length ? "Every subject has a place." : `${scheduledCurricula} of ${props.curricula.length} subjects planned.`}</small></div>
        {props.pendingReviews.length ? <Link className="teacher-note note-lilac note-tilt-right" href="/app/review"><span><ClipboardCheck size={15} />Ready for review</span><strong>{props.pendingReviews.length} waiting</strong><small>Confirm feedback and scores</small><ArrowRight size={15} /></Link> : null}
      </aside>

      <main className={`teacher-week-sheet ${isFamilyView ? "family-view" : ""}`} aria-label="Weekly schedule">
        {props.days.map((date) => {
          const items = weekAssignments.filter((item) => item.scheduledDate === date);
          const done = items.filter((item) => item.status === "completed").length;
          return <section className={date === props.selectedDate ? "selected" : ""} key={date}>
            <button type="button" className="teacher-week-day-head" onClick={() => props.setSelectedDate(date)}><span>{weekday(date)}</span><strong>{dayNumber(date)}</strong><small>{done}/{items.length}</small></button>
            <div className="teacher-week-day-body">{isFamilyView ? props.students.map((student) => {
              const learnerItems = items.filter((item) => item.studentId === student.id);
              return learnerItems.length ? <div className="teacher-week-learner-lane" key={student.id}><small>{student.displayName}</small>{learnerItems.map((item) => <WeekItem item={item} date={date} key={item.id} />)}</div> : null;
            }) : items.map((item) => <WeekItem item={item} date={date} key={item.id} />)}</div>
          </section>;
        })}
      </main>

      <aside className="teacher-week-margin teacher-week-margin-right">
        {props.proposals[0] ? <div className="teacher-note teacher-note-decision note-yellow note-tilt-right"><span><RotateCcw size={15} />Schedule ready</span><strong>{props.proposals[0].summary}</strong><small>Nothing moves until you accept.</small><div className="teacher-note-actions"><button type="button" onClick={() => props.onDecide(props.proposals[0], "approve")} disabled={props.busy === props.proposals[0].id}><Check size={12} />{props.busy === props.proposals[0].id ? "Applying…" : "Accept changes"}</button><Link href="/app/adjustments">Review <ArrowRight size={12} /></Link></div></div> : activeReminder ? <div className="teacher-note note-yellow note-tilt-right"><span><Clock3 size={15} />Reminder</span><strong>{activeReminder.title}</strong><small>{activeReminder.dueAt ? dueLabel(activeReminder.dueAt) : "No due date"}</small></div> : null}
        {practice ? <Link className="teacher-note note-blue note-tilt-left" href={`/app/artifacts/${practice.id}`}><span><Sparkles size={15} />Practice idea</span><strong>{practice.title}</strong><small>Use only if it helps</small><ArrowRight size={15} /></Link> : null}
        {!props.proposals.length && !activeReminder && !practice ? <button className="teacher-note note-cream note-tilt-left" type="button" onClick={scheduledCurricula < props.curricula.length ? props.onBuildWeek : props.onBuildNextWeek} disabled={props.busy === "build-week"}><span><Sparkles size={15} />Keep planning</span><strong>{props.busy === "build-week" ? "Klio is planning…" : scheduledCurricula < props.curricula.length ? "Finish the family week" : "Plan next week"}</strong><small>{scheduledCurricula < props.curricula.length ? `${props.curricula.length - scheduledCurricula} subjects still need a place` : "Use the same teaching rhythm"}</small><ArrowRight size={15} /></button> : null}
      </aside>
    </div> : <div className="teacher-week-empty"><Sparkles size={25} /><span>{isFamilyView ? "Your family is ready" : `${props.learner?.displayName ?? "This learner"} is ready`}</span><h2>Turn the learning setup into this week.</h2><p>{props.curricula.length ? isFamilyView ? `Klio will plan ${formatNames(props.students.map((student) => student.displayName))} together, using each learner’s subjects, teaching rhythm, learning days, and daily limit.` : `${props.curricula.length} ${props.curricula.length === 1 ? "subject is" : "subjects are"} ready: ${props.curricula.slice(0, 4).map((unit) => unit.subject).join(", ")}${props.curricula.length > 4 ? `, and ${props.curricula.length - 4} more` : ""}.` : "Set up subjects for your learners, then Klio can build a realistic family week."}</p>{props.curricula.length ? <button type="button" onClick={props.onBuildWeek} disabled={props.busy === "build-week"}>{props.busy === "build-week" ? "Building the family week…" : props.students.length > 1 ? "Build the family week" : "Build this week"}<ArrowRight size={13} /></button> : <Link href="/app/settings">Set up learners <ArrowRight size={13} /></Link>}</div>}

    {weekAssignments.length ? <div className="teacher-week-foot"><span>{longDate(props.selectedDate)}</span><strong>{selected.length} lessons · {formatMinutes(minutes)}</strong><small>{isFamilyView ? `${new Set(selected.map((item) => item.studentId)).size} learners scheduled` : minutes > props.capacity ? `${minutes - props.capacity} minutes over the usual day` : `${Math.max(0, props.capacity - minutes)} minutes still open`}</small>{!isFamilyView ? <Link href={`/app?date=${props.selectedDate}&student=${props.scopeId}`}>Open the day <ArrowRight size={12} /></Link> : null}</div> : null}
    <div className="teacher-klio-dock">{props.capture}</div>
  </div>;
}

function WeekItem({ item, date }: { item: AssignmentDTO; date: string }) {
  return <Link draggable onDragStart={(event) => startAssignmentDrag(event, item)} className={`teacher-week-item subject-${subjectTone(item.subject)} ${item.status === "completed" ? "completed" : ""}`} href={`/app?date=${date}&student=${item.studentId}`}><span>{item.subject}</span><strong>{item.title}</strong><small>{item.estimatedMinutes ?? 0} min</small>{item.status === "completed" ? <Check size={12} /> : null}</Link>;
}

function AssignmentRow({ item, busy, onUpdate, onSubmit, onAdjust }: { item: AssignmentDTO; busy: boolean; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void; onSubmit: (item: AssignmentDTO) => void; onAdjust?: (item: AssignmentDTO) => void }) {
  return <motion.article layout className={`ops-assignment ${item.status}`}>
    <button type="button" className="assignment-state" onClick={() => onUpdate(item, item.status === "completed" ? "planned" : "completed")} disabled={busy} aria-label={item.status === "completed" ? `Reopen ${item.title}` : `Complete ${item.title}`}>{item.status === "completed" ? <Check size={15} /> : <span />}</button>
    <div><p><span>{item.subject}</span>{item.scheduledTime ? <small>{formatTime(item.scheduledTime)}</small> : null}{item.estimatedMinutes ? <small>{item.estimatedMinutes} min</small> : null}</p><strong>{item.title}</strong>{item.instructions ? <em>{item.instructions}</em> : null}</div>
    <span className={`status-word ${item.status}`}>{statusLabel(item.status)}</span>
    <div className="assignment-actions">{item.status !== "needs_review" && item.status !== "submitted" ? <button type="button" onClick={() => onSubmit(item)}><FileCheck2 size={12} />Add work</button> : null}{onAdjust && (item.status === "planned" || item.status === "doing") ? <button type="button" onClick={() => onAdjust(item)} disabled={busy}><RotateCcw size={12} />Not finished</button> : null}</div>
  </motion.article>;
}

function AssignmentsSurface(props: { familyId: string; studentId: string; students: StudentDTO[]; units: CurriculumUnitDTO[]; assignments: AssignmentDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; showCurriculum: boolean; setShowCurriculum: (value: boolean) => void; onSubmit: (item: AssignmentDTO) => void; onUpdate: (item: AssignmentDTO, status: "doing" | "completed" | "planned" | "skipped") => void }) {
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
    <AnimatePresence>{props.showCurriculum ? <motion.form key={draftUnit?.id ?? "new"} className="curriculum-drawer" onSubmit={addCurriculum} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}><header><div><span>{draftUnit ? "Curriculum ready" : "New curriculum"}</span><h2>{draftUnit ? "Schedule the next lessons" : "Add the sequence once"}</h2><p>{draftUnit ? "This course was added during learner setup. Choose when its lessons begin." : "Klio will create the next assignments on your learning days."}</p></div><button type="button" onClick={closeCurriculum} aria-label="Close"><X size={17} /></button></header><div className="curriculum-fields"><label><span>Curriculum or course</span><input name="title" required placeholder="Algebra I" defaultValue={draftUnit?.title ?? ""} /></label><label><span>Subject</span><input name="subject" required placeholder="Math" defaultValue={draftUnit?.subject ?? ""} /></label><label><span>Numbering</span><select name="sequenceLabel" defaultValue={draftUnit?.sequenceLabel ?? "Lesson"}><option>Lesson</option><option>Unit</option><option>Chapter</option><option>Module</option></select></label><div className="field-pair"><label><span>Start at</span><input name="startSequence" type="number" min="1" defaultValue={draftUnit?.nextSequenceNumber ?? 1} required /></label><label><span>How many</span><input name="count" type="number" min="1" max="40" defaultValue="10" required /></label></div><label><span>First date</span><input name="startDate" type="date" defaultValue={today()} required /></label><fieldset><legend>Learning days</legend>{[[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"]].map(([value,label]) => <label key={value}><input type="checkbox" name="weekdays" value={value} defaultChecked /><span>{label}</span></label>)}</fieldset><label><span>Times per week</span><select name="weeklyFrequency" defaultValue={draftUnit?.weeklyFrequency ?? 5}>{[1,2,3,4,5,6,7].map((frequency) => <option value={frequency} key={frequency}>{frequency}× per week</option>)}</select></label><div className="field-pair"><label><span>Preferred minutes</span><input name="estimatedMinutes" type="number" min="5" defaultValue={draftUnit?.defaultMinutes ?? 40} required /></label><label><span>Time</span><input name="scheduledTime" type="time" /></label></div><label><span>Curriculum link</span><input name="curriculumUrl" type="url" placeholder="Optional" defaultValue={draftUnit?.curriculumUrl ?? ""} /></label></div><footer><button type="button" onClick={closeCurriculum}>Cancel</button><button type="submit" disabled={props.busy === "curriculum"}>{props.busy === "curriculum" ? "Adding…" : "Create assignments"}</button></footer></motion.form> : null}</AnimatePresence>
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

function AdjustmentsSurface(props: { assignments: AssignmentDTO[]; students: StudentDTO[]; proposals: AdjustmentDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void }) {
  const router = useRouter();
  async function decide(proposal: AdjustmentDTO, decision: "approve" | "reject") { props.setBusy(proposal.id); const response = await fetch(`/api/adjustments/${proposal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }); const result = await response.json(); props.setBusy(null); if (!response.ok) return props.setNotice(result.error ?? "Klio could not apply that change."); props.setNotice(decision === "approve" ? "The week has been updated." : "The proposed change was declined."); router.refresh(); }
  const current = props.proposals.filter((proposal) => proposal.status === "proposed");
  return <div className="adjustments-list">{current.length ? current.map((proposal) => <article key={proposal.id}><header><div><span>{props.students.find((student) => student.id === proposal.studentId)?.displayName ?? "Learner"} · Proposed for week of {shortDate(proposal.weekStart)}</span><h2>{proposal.summary}</h2><p>{proposal.reason}</p></div><Sparkles size={18} /></header><ol>{proposal.actions.map((action) => { const assignment = props.assignments.find((item) => item.id === action.assignmentId); const before = action.beforeState as { scheduledDate?: string }; const after = action.afterState as { scheduledDate?: string; title?: string; subject?: string }; return <li key={action.id}><span>{action.actionType === "add_practice" ? after.subject ?? "Practice" : assignment?.subject ?? "Practice"}</span><strong>{action.actionType === "add_practice" ? after.title ?? "Focused review" : assignment?.title ?? "Focused review"}</strong><div><s>{before.scheduledDate ? weekday(before.scheduledDate) : "New"}</s><ArrowRight size={12} /><b>{after.scheduledDate ? weekday(after.scheduledDate) : "Unscheduled"}</b></div></li>; })}</ol><footer><button type="button" onClick={() => void decide(proposal, "reject")}>Keep current week</button><button type="button" onClick={() => void decide(proposal, "approve")} disabled={props.busy === proposal.id}><Check size={13} />{props.busy === proposal.id ? "Applying…" : "Approve changes"}</button></footer></article>) : <div className="review-empty"><RotateCcw size={28} /><span>Proposed adjustments</span><h2>The current week has no pending changes.</h2><p>Use “Not finished” on an assignment and Klio will preserve lesson order and daily capacity.</p><Link href="/app">Return to this week <ArrowRight size={13} /></Link></div>}</div>;
}

function SubmissionPanel({ assignment, familyEvidence, busy, setBusy, setNotice, close }: { assignment: AssignmentDTO; familyEvidence: EvidenceDTO[]; busy: string | null; setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; close: () => void }) {
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(assignment.id); const response = await fetch(`/api/assignments/${assignment.id}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidenceIds: data.getAll("evidenceIds"), note: data.get("note") || null }) }); const result = await response.json(); setBusy(null); if (!response.ok) return setNotice(result.error ?? "Klio could not attach that work."); close(); if (result.outcome === "completed") { setNotice(`${assignment.title} marked complete. The note was added to the learning record.`); router.refresh(); return; } setNotice("Work submitted. Klio drafted a review for your confirmation."); router.push("/app/review"); router.refresh(); }
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
  event.dataTransfer.effectAllowed = "link";
  event.dataTransfer.setData("application/x-klio-assignment", assignment.id);
  event.dataTransfer.setData("text/plain", assignment.title);
}
function workWeek(date: string) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return Array.from({ length: 5 }, (_, index) => { const day = new Date(value); day.setUTCDate(value.getUTCDate() + index); return day.toISOString().slice(0,10); }); }
function weekday(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }); }
function weekdayLong(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }); }
function dayNumber(date: string) { return new Date(`${date}T12:00:00Z`).getUTCDate(); }
function longDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); }
function shortDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
function formatTime(time: string) { const [hour, minute] = time.split(":").map(Number); return new Date(2000,0,1,hour,minute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0,10); }
function formatMinutes(minutes: number) { const hours = Math.floor(minutes / 60); const remainder = minutes % 60; return [hours ? `${hours} hr` : "", remainder ? `${remainder} min` : ""].filter(Boolean).join(" ") || "No time planned"; }
function dueLabel(value: string) { return new Date(value).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
function subjectTone(subject: string) { const value = subject.toLowerCase(); if (/math|algebra|geometry|calculus/.test(value)) return "blue"; if (/science|biology|chemistry|physics/.test(value)) return "green"; if (/history|social|geography/.test(value)) return "gold"; if (/english|language|writing|literature|reading/.test(value)) return "lilac"; if (/art|music/.test(value)) return "rose"; return "neutral"; }
