"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Lightbulb, LoaderCircle } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";

export function PracticePlayer({ sessionId, learnerName, spec, completed }: {
  sessionId: string; learnerName: string; completed: boolean;
  spec: { instructions: string; mastery_percent: number; questions: Array<{ prompt: string; choices: string[]; hints: string[] }> };
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; masteryMet: boolean } | null>(null);
  const question = spec.questions[index];

  async function next() {
    if (!selected) return;
    const nextAnswers = [...answers, selected];
    if (index < spec.questions.length - 1) { setAnswers(nextAnswers); setIndex(index + 1); setSelected(""); setHint(false); return; }
    setBusy(true);
    const response = await fetch(`/api/practice/${sessionId}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: nextAnswers }) });
    const data = await response.json(); setBusy(false);
    if (response.ok) setResult(data);
  }

  if (completed && !result) return <main className="practice-shell"><KlioWordmark /><div className="practice-complete"><CheckCircle2 size={38} /><h1>This practice is complete.</h1><a className="primary-button" href="/app">Return to Klio</a></div></main>;
  if (result) return <main className="practice-shell"><KlioWordmark /><div className="practice-complete"><CheckCircle2 size={38} /><p className="eyebrow">Practice complete</p><h1>{result.score}%</h1><p>{result.masteryMet ? "You met today’s practice goal." : "Good work. This gives your parent useful information for what comes next."}</p><a className="primary-button" href="/app">Return to Klio</a></div></main>;
  if (!question) return <main className="practice-shell"><p>This activity has no questions.</p></main>;
  return (
    <main className="practice-shell"><header><KlioWordmark /><span>{learnerName} · {index + 1} of {spec.questions.length}</span></header>
      <section className="practice-stage"><p className="practice-instructions">{spec.instructions}</p><h1>{question.prompt}</h1>
        <div className="practice-choices">{question.choices.map((choice) => <button className={selected === choice ? "selected" : ""} key={choice} onClick={() => setSelected(choice)}>{choice}</button>)}</div>
        {hint && question.hints.length ? <p className="practice-hint"><Lightbulb size={16} /> {question.hints[0]}</p> : null}
        <footer><button className="hint-button" onClick={() => setHint(true)}><Lightbulb size={16} /> Hint</button><button className="primary-button" onClick={next} aria-disabled={!selected}>{busy ? <LoaderCircle className="spin" size={17} /> : <>Continue <ArrowRight size={17} /></>}</button></footer>
      </section>
    </main>
  );
}
