"use client";

import { useActionState, useState } from "react";
import { updateStudentSetupAction, type LearnerSetupState } from "@/app/app/actions";
import { SubjectSetupFields, type FamilySubjectSuggestion, type SubjectSetupValue } from "@/components/subject-setup-fields";

type LearnerSetup = {
  id: string;
  displayName: string;
  gradeBand: string | null;
  learningPreferences: string | null;
  dailyCapacityMinutes: number;
  learningDays: string[];
  subjects: SubjectSetupValue[];
};

const initialState: LearnerSetupState = { error: null, success: null };

export function LearnerSetupForm({ familyId, learner, familySubjects = [] }: { familyId: string; learner: LearnerSetup; familySubjects?: FamilySubjectSuggestion[] }) {
  const [state, action, pending] = useActionState(updateStudentSetupAction, initialState);
  const [subjects, setSubjects] = useState<SubjectSetupValue[]>(learner.subjects);
  const prefix = `learner-${learner.id}`;
  const learningDays = learner.learningDays.length ? learner.learningDays : ["Mon", "Tue", "Wed", "Thu", "Fri"];

  return <form action={action} className="learner-setup-form">
    <input type="hidden" name="familyId" value={familyId} />
    <input type="hidden" name="studentId" value={learner.id} />
    <div className="learner-details-grid">
      <div className="field"><label htmlFor={`${prefix}-name`}>First name</label><input id={`${prefix}-name`} name="displayName" defaultValue={learner.displayName} required /></div>
      <div className="field"><label htmlFor={`${prefix}-grade`}>Learning stage</label><select id={`${prefix}-grade`} name="gradeBand" defaultValue={learner.gradeBand ?? "k-2"}><option value="pre-k">Pre-K</option><option value="k-2">K–2</option><option value="3-5">Grades 3–5</option><option value="6-8">Grades 6–8</option><option value="9-12">Grades 9–12</option><option value="other">Other / mixed</option></select></div>
      <div className="field full"><label htmlFor={`${prefix}-context`}>Helpful context <span className="form-note">(optional)</span></label><textarea id={`${prefix}-context`} name="learningPreferences" rows={3} defaultValue={learner.learningPreferences ?? ""} placeholder="Interests, strengths, routines, or accommodations…" /></div>
    </div>

    <div className="learner-setup-block">
      <header><span>Subjects & curriculum</span><p>These belong only to this learner.</p></header>
      <SubjectSetupFields subjects={subjects} onChange={setSubjects} idPrefix={prefix} familySubjects={familySubjects} />
    </div>

    <div className="learner-setup-block learner-rhythm-block">
      <header><span>Weekly rhythm</span><p>Klio uses these limits when planning and moving work.</p></header>
      <div className="rhythm-fields">
        <fieldset><legend>Learning days</legend><div className="day-picker">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <label key={day}><input type="checkbox" name="learningDays" value={day} defaultChecked={learningDays.includes(day)} /><span>{day.slice(0, 1)}</span></label>)}</div></fieldset>
        <div className="field capacity-field"><label htmlFor={`${prefix}-capacity`}>Typical learning time</label><select id={`${prefix}-capacity`} name="dailyCapacityMinutes" defaultValue={learner.dailyCapacityMinutes}><option value="90">About 1½ hours a day</option><option value="120">About 2 hours a day</option><option value="180">About 3 hours a day</option><option value="240">About 4 hours a day</option><option value="300">About 5 hours a day</option></select></div>
      </div>
    </div>

    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <footer><p><strong>{subjects.length || "No"} subjects</strong> in this learner’s setup.</p><button className="outline-button" disabled={pending || subjects.length === 0}>{pending ? "Saving…" : "Save learning setup"}</button></footer>
  </form>;
}
