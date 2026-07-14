"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Circle, Clock3, ExternalLink, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { InboxWorkspace, type InboxWorkspaceProps } from "@/components/inbox-workspace";
import type { ArtifactDTO, ReminderDTO, ScheduleItemDTO, StudentDTO } from "@/lib/data/workspace";
import { buildCurriculumSequence, inferNextCurriculumLessons } from "@/lib/schedule/sequence";

type Props = {
  familyId: string;
  timezone: string;
  availableDays: string[];
  students: StudentDTO[];
  initialStudentId: string;
  initialScheduleItems: ScheduleItemDTO[];
  reminders: ReminderDTO[];
  artifacts: ArtifactDTO[];
  captureProps: Omit<InboxWorkspaceProps, "initialStudentId" | "compact">;
};

type SequenceProposal = {
  sourceItem: ScheduleItemDTO;
  items: Array<{ title: string; scheduledDate: string }>;
};

export function ParentWeekWorkspace({ familyId, timezone, availableDays, students, initialStudentId, initialScheduleItems, reminders, artifacts, captureProps }: Props) {
  const today = dateInTimezone(new Date(), timezone);
  const initialDay = nextAvailableDate(today, availableDays, true);
  const [studentId, setStudentId] = useState(initialStudentId);
  const [weekStartDate, setWeekStartDate] = useState(startOfWeek(initialDay));
  const [selectedDate, setSelectedDate] = useState(initialDay);
  const [items, setItems] = useState(initialScheduleItems);
  const [adding, setAdding] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [sequenceProposal, setSequenceProposal] = useState<SequenceProposal | null>(null);
  const [sequenceBusy, setSequenceBusy] = useState(false);
  const [nextLessonBusy, setNextLessonBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const learner = students.find((student) => student.id === studentId) ?? students[0];
  const days = useMemo(() => learningDaysForWeek(weekStartDate, availableDays), [weekStartDate, availableDays]);
  const studentItems = items.filter((item) => item.studentId === studentId);
  const weekItems = studentItems.filter((item) => item.scheduledDate && days.some((day) => day.date === item.scheduledDate));
  const selectedItems = studentItems.filter((item) => item.scheduledDate === selectedDate).sort(compareScheduleItems);
  const nextLessonOptions = inferNextCurriculumLessons(studentItems, selectedDate);
  const completedThisWeek = weekItems.filter((item) => item.completedAt).length;
  const openReminder = reminders.find((item) => item.status === "pending" && (!item.studentId || item.studentId === studentId));
  const practice = artifacts.find((artifact) => artifact.studentId === studentId && artifact.type === "practice" && artifact.status === "approved");

  function chooseStudent(nextStudentId: string) {
    setStudentId(nextStudentId);
    setSequenceProposal(null);
    document.cookie = `klio-learner=${encodeURIComponent(nextStudentId)}; Path=/app; Max-Age=31536000; SameSite=Lax`;
  }

  function moveWeek(offset: number) {
    const nextStart = addDays(weekStartDate, offset * 7);
    const nextDays = learningDaysForWeek(nextStart, availableDays);
    setWeekStartDate(nextStart);
    setSelectedDate(nextDays[0]?.date ?? nextStart);
    setAdding(false);
    setSequenceProposal(null);
  }

  async function updateItem(item: ScheduleItemDTO, action: "complete" | "reopen" | "move_forward") {
    setWorkingId(item.id); setNotice(null);
    try {
      const response = await fetch(`/api/schedule/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Klio could not update the week.");
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, scheduledDate: result.scheduledDate, completedAt: result.completedAt, rescheduledCount: result.rescheduledCount } : candidate));
      if (action === "move_forward") setNotice(`${item.title} moved to ${formatDay(result.scheduledDate)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Klio could not update the week.");
    } finally { setWorkingId(null); }
  }

  async function addScheduleItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice(null);
    try {
      const estimatedMinutes = Number(formData.get("estimatedMinutes"));
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familyId, studentId,
          title: formData.get("title"), subject: formData.get("subject"), description: formData.get("description"),
          scheduledDate: formData.get("scheduledDate"), scheduledTime: formData.get("scheduledTime") || null,
          estimatedMinutes: Number.isFinite(estimatedMinutes) && estimatedMinutes > 0 ? estimatedMinutes : null,
          curriculumUrl: formData.get("curriculumUrl") || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Klio could not add that work.");
      setItems((current) => [...current, result.item]);
      setSelectedDate(result.item.scheduledDate);
      setAdding(false);
      const proposedItems = buildCurriculumSequence(result.item, availableDays, [...items, result.item]);
      const proposal = proposedItems.length ? { sourceItem: result.item, items: proposedItems } : null;
      setSequenceProposal(proposal);
      setNotice(proposal ? null : `${result.item.title} added to ${formatDay(result.item.scheduledDate)}.`);
      form.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Klio could not add that work.");
    }
  }

  async function scheduleSequence() {
    if (!sequenceProposal || sequenceBusy) return;
    setSequenceBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/schedule/series", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyId, studentId, sourceItemId: sequenceProposal.sourceItem.id, items: sequenceProposal.items }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Klio could not schedule the next lessons.");
      setItems((current) => [...current, ...result.items]);
      setNotice(result.items.length ? `Klio scheduled ${result.items.length} next lessons.` : "Those lessons are already on the schedule.");
      setSequenceProposal(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Klio could not schedule the next lessons.");
    } finally { setSequenceBusy(false); }
  }

  async function addNextLesson(subject: string) {
    if (nextLessonBusy) return;
    setNextLessonBusy(subject); setNotice(null);
    try {
      const response = await fetch("/api/schedule/next", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyId, studentId, subject, scheduledDate: selectedDate }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Klio could not schedule the next lesson.");
      setItems((current) => [...current, result.item]);
      setNotice(`${result.item.title} added to ${formatDay(result.item.scheduledDate)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Klio could not schedule the next lesson.");
    } finally { setNextLessonBusy(null); }
  }

  return (
    <div className="parent-week-workspace">
      <header className="week-header">
        <div><span>This week</span><h1>{learner?.displayName}’s learning plan</h1><p>{weekItems.length} planned · {completedThisWeek} finished</p></div>
        <label><span>Learner</span><select value={studentId} onChange={(event) => chooseStudent(event.target.value)}>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
      </header>

      <div className="week-layout">
        <section className="week-board" aria-labelledby="week-board-title">
          <header className="week-board-header">
            <div><button type="button" onClick={() => moveWeek(-1)} aria-label="Previous week"><ChevronLeft size={16} /></button><h2 id="week-board-title">{formatWeek(days)}</h2><button type="button" onClick={() => moveWeek(1)} aria-label="Next week"><ChevronRight size={16} /></button></div>
            <button type="button" className="add-work-button secondary" onClick={() => { setAdding(true); setSequenceProposal(null); }}><Plus size={15} />New subject</button>
          </header>

          <nav className="week-days" aria-label="Learning days">{days.map((day) => {
            const dayItems = studentItems.filter((item) => item.scheduledDate === day.date);
            const done = dayItems.filter((item) => item.completedAt).length;
            return <button type="button" className={`${selectedDate === day.date ? "selected" : ""} ${day.date === today ? "today" : ""}`} onClick={() => { setSelectedDate(day.date); setAdding(false); }} key={day.date}><span>{day.short}</span><strong>{day.dayNumber}</strong><small>{dayItems.length ? `${done}/${dayItems.length}` : "Open"}</small></button>;
          })}</nav>

          <div className="day-heading"><div><span>{selectedDate === today ? "Today" : formatDay(selectedDate)}</span><h3>{selectedItems.length ? `${selectedItems.length} learning ${selectedItems.length === 1 ? "block" : "blocks"}` : "A clear day"}</h3></div>{selectedItems.length ? <small>{selectedItems.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0) || "—"} min planned</small> : null}</div>

          {nextLessonOptions.length && !adding && !sequenceProposal ? <section className="quick-next-lessons" aria-label="Schedule the next curriculum lesson"><div><Sparkles size={14} /><span><strong>Klio knows what comes next</strong><small>One click uses the last lesson’s label, time, and duration.</small></span></div><div>{nextLessonOptions.slice(0, 4).map((option) => <button type="button" onClick={() => void addNextLesson(option.subject)} disabled={Boolean(nextLessonBusy)} aria-label={`Schedule ${option.title}`} key={option.subject}><Plus size={12} /><span>{option.title}</span><small>{option.scheduledTime ? formatTime(option.scheduledTime) : "Add to this day"}</small></button>)}</div></section> : null}

          <AnimatePresence mode="popLayout">
            {adding ? <motion.form className="schedule-add-form" onSubmit={addScheduleItem} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <header><div><span>New curriculum sequence</span><strong>Add the first lesson. Klio can schedule what follows.</strong></div><button type="button" onClick={() => setAdding(false)} aria-label="Close"><X size={15} /></button></header>
              <div className="schedule-form-grid"><label><span>First lesson or assignment</span><input name="title" required maxLength={200} placeholder="Algebra I · Lesson 4" autoFocus /></label><label><span>Subject</span><input name="subject" required maxLength={80} placeholder="Algebra I" /></label><label><span>First date</span><input name="scheduledDate" type="date" required defaultValue={selectedDate} /></label><label><span>Time</span><input name="scheduledTime" type="time" /></label><label><span>Minutes</span><input name="estimatedMinutes" type="number" min={5} max={480} defaultValue={30} /></label><label className="wide"><span>Curriculum link</span><input name="curriculumUrl" type="url" placeholder="Optional link" /></label><label className="wide"><span>Note</span><input name="description" maxLength={1000} placeholder="Pages, materials, or what counts as done" /></label></div>
              <footer><button type="button" onClick={() => setAdding(false)}>Cancel</button><button type="submit">Add first lesson</button></footer>
            </motion.form> : null}
            {sequenceProposal ? <motion.section className="schedule-sequence-proposal" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <span className="sequence-mark"><Sparkles size={15} /></span>
              <div><small>Klio found a sequence</small><h3>Schedule the next {sequenceProposal.items.length} lessons?</h3><p>I’ll keep the time and duration you entered, advance the lesson labels, and use your family’s next learning days.</p>
                <ol>{sequenceProposal.items.map((item) => <li key={`${item.scheduledDate}-${item.title}`}><span>{formatShortDay(item.scheduledDate)}</span><strong>{item.title}</strong></li>)}</ol>
                <footer><button type="button" onClick={() => { setSequenceProposal(null); setNotice(`${sequenceProposal.sourceItem.title} was added by itself.`); }}>Only this lesson</button><button type="button" onClick={() => void scheduleSequence()} disabled={sequenceBusy}>{sequenceBusy ? "Scheduling…" : `Schedule ${sequenceProposal.items.length} lessons`}</button></footer>
              </div>
            </motion.section> : null}
          </AnimatePresence>

          <motion.div className="schedule-list" layout>
            <AnimatePresence initial={false} mode="popLayout">
              {selectedItems.map((item) => <motion.article className={item.completedAt ? "schedule-item completed" : "schedule-item"} layout initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 12 }} key={item.id}>
                <button type="button" className="schedule-check" onClick={() => void updateItem(item, item.completedAt ? "reopen" : "complete")} disabled={workingId === item.id} aria-label={item.completedAt ? `Mark ${item.title} not finished` : `Mark ${item.title} finished`}>{item.completedAt ? <Check size={15} /> : <Circle size={16} />}</button>
                <div className="schedule-copy"><p><span>{item.subject ?? "Learning"}</span>{item.scheduledTime ? <small>{formatTime(item.scheduledTime)}</small> : null}{item.estimatedMinutes ? <small>{item.estimatedMinutes} min</small> : null}</p><strong>{item.title}</strong>{item.description ? <em>{item.description}</em> : null}</div>
                <div className="schedule-actions">{item.curriculumUrl ? <a href={item.curriculumUrl} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a> : item.artifactId ? <Link href={`/app/artifacts/${item.artifactId}`}>Open <ChevronRight size={12} /></Link> : null}{!item.completedAt ? <button type="button" onClick={() => void updateItem(item, "move_forward")} disabled={workingId === item.id}><RotateCcw size={12} />Not done</button> : null}</div>
              </motion.article>)}
            </AnimatePresence>
            {!selectedItems.length && !adding && !sequenceProposal ? <div className="schedule-empty"><CalendarDays size={22} /><p>Nothing planned for this day.</p><button type="button" onClick={() => setAdding(true)}>Add a lesson</button></div> : null}
          </motion.div>
          {notice ? <p className="schedule-notice" role="status">{notice}</p> : null}
        </section>

        <aside className="week-side">
          <section className="week-support"><header><span><Sparkles size={13} />Klio support</span><small>Based on recorded work</small></header>
            {practice ? <Link className="support-action" href={`/app/artifacts/${practice.id}`}><div><small>Practice ready</small><strong>{practice.title}</strong><span>Optional reinforcement—not a replacement for curriculum.</span></div><ChevronRight size={15} /></Link> : <div className="support-empty"><strong>No extra practice needed yet</strong><span>When grades or work show a specific gap, Klio will offer a focused activity here.</span></div>}
            {openReminder ? <div className="week-reminder"><Clock3 size={14} /><div><small>Reminder</small><strong>{openReminder.title}</strong></div></div> : null}
          </section>
          <InboxWorkspace {...captureProps} initialStudentId={studentId} compact key={studentId} />
          <nav className="week-shortcuts" aria-label="Family records"><Link href={`/app/records?student=${studentId}`}>Learning record <ChevronRight size={13} /></Link><Link href="/app/activity">Needs your review <ChevronRight size={13} /></Link></nav>
        </aside>
      </div>
    </div>
  );
}

function startOfWeek(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}

function learningDaysForWeek(start: string, availableDays: string[]) {
  const allowed = new Set(availableDays.map((day) => day.toLowerCase()));
  return Array.from({ length: 7 }, (_, index) => addDays(start, index)).filter((date) => !allowed.size || allowed.has(new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase())).map((date) => ({ date, short: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }), dayNumber: new Date(`${date}T12:00:00Z`).getUTCDate() }));
}

function nextAvailableDate(date: string, availableDays: string[], includeCurrent: boolean) {
  const allowed = new Set(availableDays.map((day) => day.toLowerCase()));
  for (let offset = includeCurrent ? 0 : 1; offset <= 14; offset += 1) {
    const candidate = addDays(date, offset);
    const day = new Date(`${candidate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
    if (!allowed.size || allowed.has(day)) return candidate;
  }
  return date;
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDay(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }); }
function formatShortDay(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }
function formatTime(time: string) { return new Date(`2000-01-01T${time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function formatWeek(days: Array<{ date: string }>) { return days.length ? `${new Date(`${days[0].date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${new Date(`${days.at(-1)?.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "Learning week"; }
function compareScheduleItems(a: ScheduleItemDTO, b: ScheduleItemDTO) { return (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99") || a.position - b.position; }
