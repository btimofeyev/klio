"use client";

import { useActionState } from "react";
import { createWorkspaceAction, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null };

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, initialState);
  return (
    <form action={action} className="onboarding-form">
      <p className="eyebrow">Your private workspace</p>
      <h1>Who are we learning with?</h1>
      <p className="form-lede">Start with one learner. You can add the rest of the family later.</p>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <div className="onboarding-grid">
        <div className="field">
          <label htmlFor="familyName">Workspace name</label>
          <input id="familyName" name="familyName" placeholder="The Rivera family" required />
        </div>
        <div className="field">
          <label htmlFor="studentName">Learner’s first name</label>
          <input id="studentName" name="studentName" autoComplete="off" required />
        </div>
        <div className="field">
          <label htmlFor="gradeBand">Learning stage</label>
          <select id="gradeBand" name="gradeBand" defaultValue="k-2">
            <option value="pre-k">Pre-K</option><option value="k-2">K–2</option>
            <option value="3-5">Grades 3–5</option><option value="6-8">Grades 6–8</option>
            <option value="9-12">Grades 9–12</option><option value="other">Other / mixed</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="learningPreferences">Helpful context <span className="form-note">(optional)</span></label>
          <textarea id="learningPreferences" name="learningPreferences" rows={3} placeholder="Interests, strengths, routines, or accommodations…" />
        </div>
      </div>
      <button className="form-button" disabled={pending}>{pending ? "Preparing Klio…" : "Enter Klio"}</button>
      <p className="form-note">Student information stays inside your family workspace and is never public.</p>
    </form>
  );
}
