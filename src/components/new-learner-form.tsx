"use client";

import { useActionState } from "react";
import { createStudentProfileAction, type NewLearnerState } from "@/app/app/actions";

const initialState: NewLearnerState = { error: null };

export function NewLearnerForm({ familyId }: { familyId: string }) {
  const [state, action, pending] = useActionState(createStudentProfileAction, initialState);

  return <form action={action} className="new-learner-form">
    <input type="hidden" name="familyId" value={familyId} />
    <div className="learner-details-grid">
      <div className="field"><label htmlFor="new-learner-name">First name</label><input id="new-learner-name" name="displayName" autoFocus required /></div>
      <div className="field"><label htmlFor="new-learner-stage">Learning stage</label><select id="new-learner-stage" name="gradeBand" defaultValue="k-2"><option value="pre-k">Pre-K</option><option value="k-2">K–2</option><option value="3-5">Grades 3–5</option><option value="6-8">Grades 6–8</option><option value="9-12">Grades 9–12</option><option value="other">Other / mixed</option></select></div>
      <div className="field full"><label htmlFor="new-learner-context">Helpful context <span className="form-note">(optional)</span></label><textarea id="new-learner-context" name="learningPreferences" rows={3} placeholder="Interests, strengths, routines, or accommodations…" /></div>
    </div>
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    <footer><p>Subjects and curriculum come next.</p><button className="primary-button" disabled={pending}>{pending ? "Adding learner…" : "Continue to learning setup"}</button></footer>
  </form>;
}
