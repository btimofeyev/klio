"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, LoaderCircle, Target } from "lucide-react";

type Term = { id: string; name: string; startsOn: string; endsOn: string; status: string };
type Learner = { id: string; name: string };
type Curriculum = { id: string; studentId: string; subject: string; title: string; nextSequence: number; defaultMinutes: number };

export function AcademicPlanningSettings({ familyId, enabledWeekdays, terms, learners, curricula }: { familyId: string; enabledWeekdays: number[]; terms: Term[]; learners: Learner[]; curricula: Curriculum[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"term" | "goal" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [studentId, setStudentId] = useState(learners[0]?.id ?? "");
  const learnerCurricula = useMemo(() => curricula.filter((item) => item.studentId === studentId), [curricula, studentId]);
  const activeTerm = terms.find((term) => term.status === "active") ?? terms[0];

  async function saveTerm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("term"); setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/academic-terms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      familyId, name: form.get("name"), startsOn: form.get("startsOn"), endsOn: form.get("endsOn"),
      instructionalWeekdays: form.getAll("instructionalWeekdays").map(Number), status: "active",
    }) });
    const result = await response.json();
    setBusy(null); setMessage(response.ok ? "Academic term saved." : result.error ?? "Klio could not save the term.");
    if (response.ok) router.refresh();
  }

  async function saveGoal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("goal"); setMessage(null);
    const form = new FormData(event.currentTarget);
    const curriculum = learnerCurricula.find((item) => item.id === form.get("curriculumUnitId"));
    const term = terms.find((item) => item.id === form.get("termId"));
    if (!curriculum || !term) { setBusy(null); setMessage("Add an academic term and curriculum first."); return; }
    const weeklyCadence = Number(form.get("weeklyCadence"));
    const weeklyEffortMinutes = Number(form.get("weeklyEffortMinutes"));
    const response = await fetch("/api/learning-goals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      familyId, studentId, termId: term.id, title: form.get("title"), subject: curriculum.subject,
      goalKind: "curriculum_progress", targetDate: form.get("targetCompletionDate"), weeklyCadence, weeklyEffortMinutes, priority: 60,
      pacing: { curriculumUnitId: curriculum.id, startsOn: term.startsOn, targetCompletionDate: form.get("targetCompletionDate"), startSequence: 1, targetSequence: Number(form.get("targetSequence")), weeklyCadence, weeklyEffortMinutes },
    }) });
    const result = await response.json();
    setBusy(null); setMessage(response.ok ? "Subject pacing goal saved." : result.error ?? "Klio could not save the goal.");
    if (response.ok) router.refresh();
  }

  return <section className="academic-planning-settings">
    <header><div><h2><CalendarRange size={17} /> Academic plan</h2><p className="settings-copy">Set your family’s dates and pace. Klio uses these records to calculate on-track status; they are not legal-compliance advice.</p></div>{message ? <span role="status"><Check size={13} />{message}</span> : null}</header>
    <div className="academic-planning-grid">
      <form onSubmit={saveTerm}><h3>Academic term</h3><label><span>Name</span><input name="name" required maxLength={120} placeholder="2026–27 school year" /></label><div><label><span>Starts</span><input name="startsOn" type="date" required /></label><label><span>Ends</span><input name="endsOn" type="date" required /></label></div><fieldset className="term-weekdays"><legend>Learning days</legend>{[[1,"M"],[2,"T"],[3,"W"],[4,"T"],[5,"F"],[6,"S"],[0,"S"]].map(([day,label]) => <label key={day}><input type="checkbox" name="instructionalWeekdays" value={day} defaultChecked={enabledWeekdays.includes(Number(day))} disabled={!enabledWeekdays.includes(Number(day))} /><span>{label}</span></label>)}</fieldset><small>Weekend days appear only after they are enabled in family learning settings.</small><button type="submit" disabled={busy !== null}>{busy === "term" ? <LoaderCircle className="spin" size={14} /> : null}Save term</button></form>
      <form onSubmit={saveGoal}><h3><Target size={15} /> Subject pace</h3><div><label><span>Learner</span><select value={studentId} onChange={(event) => setStudentId(event.target.value)}>{learners.map((learner) => <option value={learner.id} key={learner.id}>{learner.name}</option>)}</select></label><label><span>Term</span><select name="termId" defaultValue={activeTerm?.id}>{terms.map((term) => <option value={term.id} key={term.id}>{term.name}</option>)}</select></label></div><label><span>Curriculum</span><select name="curriculumUnitId" required>{learnerCurricula.map((item) => <option value={item.id} key={item.id}>{item.subject} · {item.title}</option>)}</select></label><label><span>Goal</span><input name="title" required maxLength={200} placeholder="Complete Biology by the end of the term" /></label><div><label><span>Target lesson</span><input name="targetSequence" type="number" min={1} max={100000} defaultValue={Math.max(learnerCurricula[0]?.nextSequence ?? 20, 20)} required /></label><label><span>Complete by</span><input name="targetCompletionDate" type="date" defaultValue={activeTerm?.endsOn} required /></label></div><div><label><span>Times each week</span><input name="weeklyCadence" type="number" min={1} max={14} defaultValue={5} required /></label><label><span>Minutes each week</span><input name="weeklyEffortMinutes" type="number" min={5} max={10080} defaultValue={200} required /></label></div><button type="submit" disabled={busy !== null || !activeTerm || !learnerCurricula.length}>{busy === "goal" ? <LoaderCircle className="spin" size={14} /> : null}Save pacing goal</button></form>
    </div>
    {terms.length ? <p className="academic-plan-summary">{terms.map((term) => `${term.name}: ${term.startsOn}–${term.endsOn}`).join(" · ")}</p> : null}
  </section>;
}
