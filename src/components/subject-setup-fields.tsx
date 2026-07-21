"use client";

import { useState } from "react";
import { COMMON_SUBJECTS } from "@/lib/onboarding/subjects";
import { createClientUuid } from "@/lib/client/uuid";
import type { AttentionMode } from "@/lib/schedule/parent-attention";

export type SubjectSetupValue = {
  id: string;
  name: string;
  courseName: string;
  weeklyFrequency: number;
  targetLessonCount?: number;
  estimatedMinutes?: number;
  attentionMode: AttentionMode;
  parentAttentionMinutes: number | null;
  publisher?: string;
  productName?: string;
  gradeLabel?: string;
  editionLabel?: string;
  isbn?: string;
};

export type FamilySubjectSuggestion = {
  name: string;
  weeklyFrequency: number;
  usedBy: string[];
};

export function SubjectSetupFields({
  subjects,
  onChange,
  idPrefix,
  familySubjects = [],
}: {
  subjects: SubjectSetupValue[];
  onChange: (subjects: SubjectSetupValue[]) => void;
  idPrefix: string;
  familySubjects?: FamilySubjectSuggestion[];
}) {
  const [customDraft, setCustomDraft] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const availableSubjects = COMMON_SUBJECTS.filter((name) => !subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase()));
  const availableFamilySubjects = familySubjects.filter((suggestion) => !subjects.some((subject) => subject.name.toLowerCase() === suggestion.name.toLowerCase()));
  const familyNames = new Set(familySubjects.map((subject) => subject.name.toLowerCase()));
  const otherCommonSubjects = availableSubjects.filter((name) => !familyNames.has(name.toLowerCase()));

  function addSubject(name: string, weeklyFrequency = 5) {
    const id = createClientUuid();
    onChange([...subjects, { id, name, courseName: "", weeklyFrequency, targetLessonCount: 100, estimatedMinutes: 40, attentionMode: "unspecified", parentAttentionMinutes: null, publisher: "", productName: "", gradeLabel: "", editionLabel: "", isbn: "" }]);
  }

  function chooseSubject(value: string) {
    if (value === "custom") setAddingCustom(true);
    else if (value) addSubject(value, familySubjects.find((subject) => subject.name === value)?.weeklyFrequency ?? 5);
  }

  function addCustomSubject() {
    const name = customDraft.trim();
    if (!name || subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())) return;
    addSubject(name);
    setCustomDraft("");
    setAddingCustom(false);
  }

  function update(id: string, values: Partial<SubjectSetupValue>) {
    onChange(subjects.map((subject) => subject.id === id ? { ...subject, ...values } : subject));
  }

  return <>
    <input type="hidden" name="subjectSetup" value={JSON.stringify(subjects.map(({ name, courseName, weeklyFrequency, targetLessonCount, estimatedMinutes, attentionMode, parentAttentionMinutes, publisher, productName, gradeLabel, editionLabel, isbn }) => ({ name, courseName, weeklyFrequency, targetLessonCount, estimatedMinutes, attentionMode, parentAttentionMinutes, publisher, productName, gradeLabel, editionLabel, isbn })))} />
    {availableFamilySubjects.length ? <div className="family-subject-suggestions">
      <div><strong>Already in your family</strong><span>One click adds the subject—not the other learner’s curriculum.</span></div>
      <div>{availableFamilySubjects.map((suggestion) => <button type="button" onClick={() => addSubject(suggestion.name, suggestion.weeklyFrequency)} aria-label={`Add ${suggestion.name}, used by ${suggestion.usedBy.join(" and ")}`} key={suggestion.name}><span>{suggestion.name}</span><small>{suggestion.usedBy.join(", ")}</small></button>)}</div>
    </div> : null}
    <div className="subject-add-control">
      <label htmlFor={`${idPrefix}-subject-choice`}>Add a subject</label>
      <select id={`${idPrefix}-subject-choice`} value="" onChange={(event) => chooseSubject(event.target.value)} disabled={subjects.length >= 16}>
        <option value="">Choose a subject…</option>
        {availableFamilySubjects.length ? <optgroup label="Used by your family">{availableFamilySubjects.map((subject) => <option value={subject.name} key={subject.name}>{subject.name}</option>)}</optgroup> : null}
        {otherCommonSubjects.length ? <optgroup label="More subjects">{otherCommonSubjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</optgroup> : null}
        <option value="custom">Other subject…</option>
      </select>
      <small>{subjects.length === 0 ? "Start with the subjects this learner is studying now." : `${subjects.length} of 16 subjects added`}</small>
    </div>
    {addingCustom ? <div className="custom-subject-adder">
      <label htmlFor={`${idPrefix}-custom-subject`}>Subject name</label>
      <input id={`${idPrefix}-custom-subject`} value={customDraft} onChange={(event) => setCustomDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomSubject(); } }} placeholder="e.g. Phonics or Latin" maxLength={80} autoFocus />
      <button type="button" onClick={addCustomSubject} disabled={!customDraft.trim()}>Add subject</button>
      <button type="button" onClick={() => { setAddingCustom(false); setCustomDraft(""); }}>Cancel</button>
    </div> : null}
    {subjects.length ? <div className="selected-subjects" aria-label="Selected subjects">
      {subjects.map((subject, index) => <article key={subject.id}>
        <span className="subject-order">{String(index + 1).padStart(2, "0")}</span>
        <div><strong>{subject.name}</strong><label htmlFor={`${idPrefix}-course-${subject.id}`}>Course or curriculum <span>(optional)</span></label></div>
        <input id={`${idPrefix}-course-${subject.id}`} aria-label={`${subject.name} course or curriculum`} value={subject.courseName} onChange={(event) => update(subject.id, { courseName: event.target.value })} onBlur={() => update(subject.id, inferredCourseDetails(subject))} placeholder={subject.name === "Math" ? "e.g. Math With Confidence 1" : `Optional — Klio can use ${subject.name}`} maxLength={120} />
        <label className="subject-frequency" htmlFor={`${idPrefix}-frequency-${subject.id}`}><span>Times / week</span><select id={`${idPrefix}-frequency-${subject.id}`} aria-label={`${subject.name} times per week`} value={subject.weeklyFrequency} onChange={(event) => update(subject.id, { weeklyFrequency: Number(event.target.value) })}>{[1,2,3,4,5,6,7].map((frequency) => <option value={frequency} key={frequency}>{frequency}×</option>)}</select></label>
        <div className="subject-attention"><label htmlFor={`${idPrefix}-attention-${subject.id}`}><span>Parent support</span><select id={`${idPrefix}-attention-${subject.id}`} aria-label={`${subject.name} parent support`} value={subject.attentionMode} onChange={(event) => { const attentionMode = event.target.value as AttentionMode; update(subject.id, { attentionMode, parentAttentionMinutes: attentionMode === "flexible" ? subject.parentAttentionMinutes ?? 10 : null }); }}><option value="unspecified">Not decided</option><option value="parent_led">Needs me</option><option value="independent">Independent</option><option value="flexible">Start together</option></select></label>{subject.attentionMode === "flexible" ? <><label className="subject-parent-minutes" htmlFor={`${idPrefix}-attention-minutes-${subject.id}`}><span>Minutes together</span><input id={`${idPrefix}-attention-minutes-${subject.id}`} type="number" min="1" max="40" value={subject.parentAttentionMinutes ?? 10} onChange={(event) => update(subject.id, { parentAttentionMinutes: Number(event.target.value) })} required /></label><small>You help them begin, then they continue independently.</small></> : <small>{attentionDescription(subject.attentionMode)}</small>}</div>
        <details className="subject-course-details"><summary>Course details</summary><div>
          <label htmlFor={`${idPrefix}-target-${subject.id}`}>Lessons this school year<input id={`${idPrefix}-target-${subject.id}`} aria-label={`${subject.name} lessons this school year`} type="number" min="1" max="500" value={subject.targetLessonCount ?? 100} onChange={(event) => update(subject.id, { targetLessonCount: Number(event.target.value) })} /></label>
          <label htmlFor={`${idPrefix}-duration-${subject.id}`}>Typical minutes<input id={`${idPrefix}-duration-${subject.id}`} aria-label={`${subject.name} typical minutes`} type="number" min="5" max="480" value={subject.estimatedMinutes ?? 40} onChange={(event) => update(subject.id, { estimatedMinutes: Number(event.target.value) })} /></label>
          <label htmlFor={`${idPrefix}-publisher-${subject.id}`}>Publisher<input id={`${idPrefix}-publisher-${subject.id}`} value={subject.publisher ?? ""} onChange={(event) => update(subject.id, { publisher: event.target.value })} maxLength={120} placeholder="Optional" /></label>
          <label htmlFor={`${idPrefix}-product-${subject.id}`}>Product<input id={`${idPrefix}-product-${subject.id}`} value={subject.productName ?? ""} onChange={(event) => update(subject.id, { productName: event.target.value })} maxLength={200} placeholder="Optional" /></label>
          <label htmlFor={`${idPrefix}-grade-label-${subject.id}`}>Grade / level<input id={`${idPrefix}-grade-label-${subject.id}`} value={subject.gradeLabel ?? ""} onChange={(event) => update(subject.id, { gradeLabel: event.target.value })} maxLength={80} placeholder="Optional" /></label>
          <label htmlFor={`${idPrefix}-edition-${subject.id}`}>Edition or year<input id={`${idPrefix}-edition-${subject.id}`} value={subject.editionLabel ?? ""} onChange={(event) => update(subject.id, { editionLabel: event.target.value })} maxLength={120} placeholder="Optional" /></label>
          <label htmlFor={`${idPrefix}-isbn-${subject.id}`}>ISBN<input id={`${idPrefix}-isbn-${subject.id}`} value={subject.isbn ?? ""} onChange={(event) => update(subject.id, { isbn: event.target.value })} maxLength={32} placeholder="Optional" /></label>
        </div></details>
        <button type="button" onClick={() => onChange(subjects.filter((item) => item.id !== subject.id))} aria-label={`Remove ${subject.name}`}>Remove</button>
      </article>)}
    </div> : <div className="subjects-empty"><span>Nothing added yet</span><p>This learner’s active subjects will appear here.</p></div>}
  </>;
}

function inferredCourseDetails(subject: SubjectSetupValue): Partial<SubjectSetupValue> {
  const courseName = subject.courseName.trim();
  if (!courseName) return {};
  const bju = /\b(?:bju|bob jones university)\s*press\b/i.test(courseName);
  const grade = courseName.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+grade\b/i)?.[1];
  return {
    publisher: subject.publisher || (bju ? "BJU Press" : ""),
    productName: subject.productName || (bju ? subject.name : ""),
    gradeLabel: subject.gradeLabel || (grade ? `Grade ${Number(grade)}` : ""),
  };
}

function attentionDescription(mode: AttentionMode) {
  if (mode === "parent_led") return "You plan to teach this lesson directly.";
  if (mode === "independent") return "This learner can work while you help someone else.";
  if (mode === "flexible") return "You help them begin, then they continue independently.";
  return "Klio will schedule this conservatively until you choose.";
}
