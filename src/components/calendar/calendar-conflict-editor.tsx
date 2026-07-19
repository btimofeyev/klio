"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { CalendarConflictDTO } from "@/lib/data/operations";

export type ConflictAffectedWork = {
  directOverlapCount: number;
  overCapacity: boolean;
  affectedLearnerNames: string[];
  affectedLessonNames: string[];
  learners: Array<{ id: string; name: string; directOverlapLessonNames: string[]; overCapacity: boolean; plannedMinutes: number; availableMinutes: number }>;
};

export function CalendarConflictEditor(props: {
  familyId: string;
  conflict: CalendarConflictDTO | null;
  date: string;
  scopeStudentId: string | null;
  students: Array<{ id: string; displayName: string }>;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onSaved: (conflict: CalendarConflictDTO, affectedWork: ConflictAffectedWork, mode: "created" | "updated") => void;
  onDeleted: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(props.conflict?.title ?? "");
  const [date, setDate] = useState(props.conflict?.conflictDate ?? props.date);
  const [studentId, setStudentId] = useState(props.conflict ? props.conflict.studentId ?? "everyone" : props.scopeStudentId ?? "everyone");
  const initialMode = useMemo(() => conflictTimeMode(props.conflict), [props.conflict]);
  const [timeMode, setTimeMode] = useState<"all_day" | "morning" | "afternoon" | "custom">(initialMode);
  const [startsAt, setStartsAt] = useState(props.conflict?.startsAt ?? presetTimes(initialMode).start);
  const [endsAt, setEndsAt] = useState(props.conflict?.endsAt ?? presetTimes(initialMode).end);
  const [note, setNote] = useState(props.conflict?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => { if (element.open) element.close(); props.returnFocus?.focus({ preventScroll: true }); };
  }, [props.returnFocus]);

  function changeTimeMode(mode: typeof timeMode) {
    setTimeMode(mode);
    if (mode !== "custom") { const preset = presetTimes(mode); setStartsAt(preset.start); setEndsAt(preset.end); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (!title.trim()) return setError("Add a short label for this conflict.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Choose a date for this conflict.");
    if (timeMode !== "all_day" && (!startsAt || !endsAt || endsAt <= startsAt)) return setError("Choose an end time later than the start time.");
    setBusy(true);
    try {
      const response = await fetch(`${props.conflict ? `/api/calendar-conflicts/${props.conflict.id}` : "/api/calendar-conflicts"}?family=${encodeURIComponent(props.familyId)}`, {
        method: props.conflict ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId: studentId === "everyone" ? null : studentId, conflictDate: date, allDay: timeMode === "all_day", startsAt: timeMode === "all_day" ? null : startsAt, endsAt: timeMode === "all_day" ? null : endsAt, title: title.trim(), note: note.trim() || null }),
      });
      const body = await response.json() as { conflict?: CalendarConflictDTO; affectedWork?: ConflictAffectedWork; error?: string };
      if (!response.ok || !body.conflict || !body.affectedWork) return setError(body.error ?? "Klio could not save that conflict.");
      props.onSaved(body.conflict, body.affectedWork, props.conflict ? "updated" : "created");
    } catch { setError("Klio lost the connection before the conflict was saved."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!props.conflict) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/calendar-conflicts/${props.conflict.id}?family=${encodeURIComponent(props.familyId)}`, { method: "DELETE" });
      const body = await response.json() as { deletedId?: string; error?: string };
      if (!response.ok || !body.deletedId) return setError(body.error ?? "Klio could not delete that conflict.");
      props.onDeleted(body.deletedId);
    } catch { setError("Klio lost the connection before the conflict was deleted."); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="calendar-conflict-dialog" aria-labelledby="calendar-conflict-title" onCancel={(event) => { event.preventDefault(); props.onClose(); }}>
    <form onSubmit={submit} noValidate>
      <header><div><span>Calendar constraint</span><h2 id="calendar-conflict-title">{props.conflict ? "Edit conflict" : "Add a conflict"}</h2><p>Lessons stay where they are until you choose to reorganize them.</p></div><button type="button" onClick={props.onClose} aria-label="Close conflict editor"><X size={17} /></button></header>
      <div className="calendar-conflict-fields">
        <label><span>Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Dentist, co-op, family day…" required /></label>
        <label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label><span>Applies to</span><select value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="everyone">Everyone</option>{props.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
        <fieldset><legend>Time</legend><div className="conflict-time-presets">{([['all_day','All day'],['morning','Morning'],['afternoon','Afternoon'],['custom','Custom']] as const).map(([value, label]) => <label key={value}><input type="radio" name="conflictTimeMode" value={value} checked={timeMode === value} onChange={() => changeTimeMode(value)} /><span>{label}</span></label>)}</div></fieldset>
        {timeMode !== "all_day" ? <div className="conflict-time-fields"><label><span>Start</span><input type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label><span>End</span><input type="time" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label></div> : null}
        <label><span>Note <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} /></label>
      </div>
      <div className="calendar-conflict-live" aria-live="polite">{error ? <p role="alert">{error}</p> : null}</div>
      <footer>{props.conflict ? confirmDelete ? <div className="conflict-delete-confirm"><span>Delete this conflict?</span><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep it</button><button type="button" onClick={() => void remove()} disabled={busy}>{busy ? "Deleting…" : "Delete"}</button></div> : <button className="conflict-delete" type="button" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={13} />Delete</button> : <span />}<div><button type="button" onClick={props.onClose} disabled={busy}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving…" : props.conflict ? "Save changes" : "Add conflict"}</button></div></footer>
    </form>
  </dialog>;
}

function conflictTimeMode(conflict: CalendarConflictDTO | null) {
  if (!conflict || conflict.allDay) return "all_day" as const;
  if (conflict.startsAt === "09:00" && conflict.endsAt === "12:00") return "morning" as const;
  if (conflict.startsAt === "12:00" && conflict.endsAt === "16:00") return "afternoon" as const;
  return "custom" as const;
}
function presetTimes(mode: "all_day" | "morning" | "afternoon" | "custom") { if (mode === "afternoon") return { start: "12:00", end: "16:00" }; return { start: "09:00", end: "12:00" }; }
