"use client";

import { useActionState, useState } from "react";
import { BookOpenText, CalendarDays, Check, UserRound } from "lucide-react";
import { updateStudentSetupAction, type LearnerSetupState } from "@/app/app/actions";
import { SubjectSetupFields, type FamilySubjectSuggestion, type SubjectSetupValue } from "@/components/subject-setup-fields";
import { WEEKDAYS, wallClockMinutes, type TeachingWindows, type Weekday } from "@/lib/schedule/availability";

type LearnerSetup = {
  id: string;
  displayName: string;
  gradeBand: string | null;
  learningPreferences: string | null;
  dailyCapacityMinutes: number;
  learningDays: string[];
  teachingWindows: TeachingWindows;
  subjects: SubjectSetupValue[];
};

const initialState: LearnerSetupState = { error: null, success: null };
type SetupView = "profile" | "schedule" | "subjects";

export function LearnerSetupForm({ familyId, learner, familySubjects = [] }: { familyId: string; learner: LearnerSetup; familySubjects?: FamilySubjectSuggestion[] }) {
  const [state, action, pending] = useActionState(updateStudentSetupAction, initialState);
  const [subjects, setSubjects] = useState<SubjectSetupValue[]>(learner.subjects);
  const [selectedDays, setSelectedDays] = useState<Weekday[]>(() => {
    const configured = learner.learningDays.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday));
    return configured.length ? configured : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  });
  const [teachingWindows, setTeachingWindows] = useState<TeachingWindows>(learner.teachingWindows);
  const [capacity, setCapacity] = useState(learner.dailyCapacityMinutes);
  const [view, setView] = useState<SetupView>("profile");
  const prefix = `learner-${learner.id}`;
  const learningDays = selectedDays;

  return <form action={action} className="learner-setup-form">
    <input type="hidden" name="familyId" value={familyId} />
    <input type="hidden" name="studentId" value={learner.id} />
    <input type="hidden" name="teachingWindows" value={JSON.stringify(teachingWindows)} />
    <nav className="learner-editor-tabs" aria-label="Learning setup sections" role="tablist">
      <button type="button" role="tab" aria-selected={view === "profile"} aria-controls={`${prefix}-profile`} onClick={() => setView("profile")}><UserRound size={17} /><span><strong>Profile</strong><small>Name and learning stage</small></span></button>
      <button type="button" role="tab" aria-selected={view === "schedule"} aria-controls={`${prefix}-schedule`} onClick={() => setView("schedule")}><CalendarDays size={17} /><span><strong>Schedule</strong><small>{learningDays.length} days · {capacity} min</small></span></button>
      <button type="button" role="tab" aria-selected={view === "subjects"} aria-controls={`${prefix}-subjects`} onClick={() => setView("subjects")}><BookOpenText size={17} /><span><strong>Subjects</strong><small>{subjects.length} active</small></span></button>
    </nav>

    <section className="learner-editor-pane learner-profile-pane" id={`${prefix}-profile`} role="tabpanel" hidden={view !== "profile"}>
      <header><span>About this learner</span><h2>Keep Klio’s planning grounded in who they are.</h2><p>Use only the context that meaningfully changes teaching, pacing, or support.</p></header>
      <div className="learner-details-grid">
        <div className="field"><label htmlFor={`${prefix}-name`}>First name</label><input id={`${prefix}-name`} name="displayName" defaultValue={learner.displayName} required /></div>
        <div className="field"><label htmlFor={`${prefix}-grade`}>Learning stage</label><select id={`${prefix}-grade`} name="gradeBand" defaultValue={learner.gradeBand ?? "k-2"}><option value="pre-k">Pre-K</option><option value="k-2">K–2</option><option value="3-5">Grades 3–5</option><option value="6-8">Grades 6–8</option><option value="9-12">Grades 9–12</option><option value="other">Other / mixed</option></select></div>
        <div className="field full"><label htmlFor={`${prefix}-context`}>Helpful context <span className="form-note">Optional</span></label><textarea id={`${prefix}-context`} name="learningPreferences" rows={5} defaultValue={learner.learningPreferences ?? ""} placeholder="Interests, strengths, routines, or accommodations that should shape the plan…" /></div>
      </div>
      <aside className="learner-profile-note"><Check size={17} /><div><strong>What belongs here</strong><p>Concrete teaching context—like needing shorter reading blocks or doing best with hands-on examples. Klio will not treat this as a diagnosis.</p></div></aside>
    </section>

    <section className="learner-editor-pane learner-subjects-pane" id={`${prefix}-subjects`} role="tabpanel" hidden={view !== "subjects"}>
    <div className="learner-setup-block">
      <header><span>Subjects & curriculum</span><p>These belong only to this learner.</p></header>
      <SubjectSetupFields subjects={subjects} onChange={setSubjects} idPrefix={prefix} familySubjects={familySubjects} />
    </div>
    </section>

    <section className="learner-editor-pane learner-schedule-pane" id={`${prefix}-schedule`} role="tabpanel" hidden={view !== "schedule"}>
    <div className="learner-setup-block learner-rhythm-block">
      <header><span>Weekly rhythm</span><p>Klio uses these limits when planning and moving work.</p></header>
      <div className="rhythm-fields">
        <fieldset><legend>Learning days</legend><div className="day-picker">{WEEKDAYS.map((day) => <label key={day}><input type="checkbox" name="learningDays" value={day} checked={learningDays.includes(day)} onChange={(event) => setSelectedDays((current) => event.target.checked ? WEEKDAYS.filter((candidate) => current.includes(candidate) || candidate === day) : current.filter((candidate) => candidate !== day))} /><span>{day.slice(0, 1)}</span></label>)}</div></fieldset>
        <div className="field capacity-field"><label htmlFor={`${prefix}-capacity`}>Typical learning time</label><select id={`${prefix}-capacity`} name="dailyCapacityMinutes" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))}><option value="90">About 1½ hours a day</option><option value="120">About 2 hours a day</option><option value="180">About 3 hours a day</option><option value="240">About 4 hours a day</option><option value="300">About 5 hours a day</option></select></div>
      </div>
      <div className="teaching-hours-editor">
        <div className="teaching-hours-intro"><div><strong>Teaching hours</strong><p>Set a normal time window, or leave a day flexible.</p></div><p>Klio uses these hours when planning new work. Existing lessons stay where they are until you choose to reorganize them.</p></div>
        <div className="teaching-hours-rows">{learningDays.map((day) => {
          const window = teachingWindows[day];
          const windowMinutes = window ? wallClockMinutes(window.end)! - wallClockMinutes(window.start)! : null;
          return <div className="teaching-hours-row" key={day}>
            <strong>{longWeekday(day)}</strong>
            <label className="teaching-flexible"><input type="checkbox" checked={!window} onChange={(event) => setTeachingWindows((current) => {
              const next = { ...current };
              if (event.target.checked) delete next[day];
              else next[day] = { start: "09:00", end: "12:00" };
              return next;
            })} /><span>Flexible</span></label>
            {window ? <><label><span>Start</span><input aria-label={`${longWeekday(day)} teaching start`} type="time" value={window.start} onChange={(event) => setTeachingWindows((current) => ({ ...current, [day]: { ...window, start: event.target.value } }))} required /></label><label><span>End</span><input aria-label={`${longWeekday(day)} teaching end`} type="time" value={window.end} min={window.start} onChange={(event) => setTeachingWindows((current) => ({ ...current, [day]: { ...window, end: event.target.value } }))} required /></label></> : <p className="teaching-flexible-copy">Any local teaching time, within the daily limit.</p>}
            {windowMinutes !== null && windowMinutes > 0 && windowMinutes < capacity ? <small>{formatWindowMinutes(windowMinutes)} becomes this day’s effective limit.</small> : null}
          </div>;
        })}</div>
      </div>
    </div>
    </section>

    <footer>
      <div className="learner-save-status">
        {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
        {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
        {!state.error && !state.success ? <p><strong>{subjects.length || "No"} subjects</strong><span>Changes apply only after you save.</span></p> : null}
      </div>
      <button className="outline-button" disabled={pending || subjects.length === 0}>{pending ? "Saving…" : "Save learning setup"}</button>
    </footer>
  </form>;
}

function longWeekday(day: Weekday) { return ({ Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" } as const)[day]; }
function formatWindowMinutes(minutes: number) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return `${hours ? `${hours} hr` : ""}${hours && rest ? " " : ""}${rest ? `${rest} min` : ""}`; }
