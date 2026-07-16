"use client";

import { useActionState, useState } from "react";
import { SubjectSetupFields, type SubjectSetupValue } from "@/components/subject-setup-fields";
import { createWorkspaceAction, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null };

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, initialState);
  const [subjects, setSubjects] = useState<SubjectSetupValue[]>([]);
  const [autonomyPreset, setAutonomyPreset] = useState("");

  return (
    <form action={action} className="onboarding-form">
      <header className="onboarding-heading">
        <div><p className="eyebrow">Your private workspace</p><h1>Set up your first learner</h1></div>
        <p>Klio uses this starting point to organize work, plan a realistic week, and suggest practice that matches what they are learning.</p>
      </header>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}

      <section className="onboarding-section" aria-labelledby="learner-details-heading">
        <div className="onboarding-section-title">
          <span>01</span>
          <div><h2 id="learner-details-heading">Who are we learning with?</h2><p>Start with one learner. Add the rest of the family later.</p></div>
        </div>
        <div className="onboarding-grid">
          <div className="field"><label htmlFor="familyName">Workspace name</label><input id="familyName" name="familyName" placeholder="The Rivera family" required /></div>
          <div className="field"><label htmlFor="studentName">Learner’s first name</label><input id="studentName" name="studentName" autoComplete="off" required /></div>
          <div className="field">
            <label htmlFor="gradeBand">Learning stage</label>
            <select id="gradeBand" name="gradeBand" defaultValue="k-2">
              <option value="pre-k">Pre-K</option><option value="k-2">K–2</option><option value="3-5">Grades 3–5</option>
              <option value="6-8">Grades 6–8</option><option value="9-12">Grades 9–12</option><option value="other">Other / mixed</option>
            </select>
          </div>
          <div className="field"><label htmlFor="learningPreferences">Helpful context <span className="form-note">(optional)</span></label><textarea id="learningPreferences" name="learningPreferences" rows={3} placeholder="Interests, strengths, routines, or accommodations…" /></div>
        </div>
      </section>

      <section className="onboarding-section" aria-labelledby="subjects-heading">
        <div className="onboarding-section-title">
          <span>02</span>
          <div><h2 id="subjects-heading">What are they learning?</h2><p>Add only the subjects in this learner’s current week. Curriculum names are optional.</p></div>
        </div>
        <SubjectSetupFields subjects={subjects} onChange={setSubjects} idPrefix="onboarding" />
      </section>

      <section className="onboarding-section onboarding-rhythm" aria-labelledby="rhythm-heading">
        <div className="onboarding-section-title"><span>03</span><div><h2 id="rhythm-heading">What does a normal week look like?</h2><p>Weekends stay off unless you enable them here. Klio only schedules on checked days.</p></div></div>
        <div className="rhythm-fields">
          <fieldset><legend>Learning days</legend><div className="day-picker">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <label key={day}><input type="checkbox" name="learningDays" value={day} defaultChecked={["Mon", "Tue", "Wed", "Thu", "Fri"].includes(day)} /><span>{day.slice(0, 1)}</span></label>)}</div></fieldset>
          <div className="field capacity-field">
            <label htmlFor="dailyCapacityMinutes">Typical learning time</label>
            <select id="dailyCapacityMinutes" name="dailyCapacityMinutes" defaultValue="180">
              <option value="90">About 1½ hours a day</option><option value="120">About 2 hours a day</option><option value="180">About 3 hours a day</option>
              <option value="240">About 4 hours a day</option><option value="300">About 5 hours a day</option>
            </select>
          </div>
        </div>
      </section>

      <section className="onboarding-section" aria-labelledby="autonomy-heading">
        <div className="onboarding-section-title"><span>04</span><div><h2 id="autonomy-heading">How should Klio handle changes?</h2><p>Choose the operating style you want. You can change it later in Settings.</p></div></div>
        <fieldset className="autonomy-choice"><legend className="sr-only">Choose how Klio handles changes</legend>
          {[
            { value: "helpful", title: "Suggest, then ask", detail: "Klio can prepare practice and plans, but asks before changing the schedule.", note: "A calm place to start" },
            { value: "proactive", title: "Autopilot", detail: "Klio may schedule practice and move unfinished work automatically, with an undo option.", note: "More automatic" },
            { value: "ask_first", title: "Ask before everything", detail: "Klio explains proposed actions and waits for approval before making changes.", note: "Most control" },
          ].map((option) => <label className={autonomyPreset === option.value ? "selected" : ""} key={option.value}><input required type="radio" name="autonomyPreset" value={option.value} checked={autonomyPreset === option.value} onChange={(event) => setAutonomyPreset(event.target.value)} /><span><small>{option.note}</small><strong>{option.title}</strong><em>{option.detail}</em></span></label>)}
        </fieldset>
      </section>

      <footer className="onboarding-submit">
        <p><strong>{subjects.length || "No"} subjects selected.</strong> You can change this setup anytime.</p>
        <button className="form-button" disabled={pending || subjects.length === 0 || !autonomyPreset}>{pending ? "Preparing Klio…" : "Enter Klio"}</button>
      </footer>
      <p className="form-note onboarding-privacy">Learner information stays inside your family workspace and is never public.</p>
    </form>
  );
}
