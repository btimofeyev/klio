"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Lightbulb, LoaderCircle, RotateCcw, X } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";
import { estimatedPracticeMinutes } from "@/lib/practice/presentation";
import { evaluateActivityAnswer } from "@/lib/practice/score";
import type { DynamicActivity, DynamicPracticeSpec, PracticeAnswer } from "@/lib/practice/spec";

export type PracticePlayerResult = {
  score: number;
  masteryMet: boolean;
  reviewNeeded?: boolean;
  feedback?: string;
  outcome?: "understood" | "needs_support" | "checking";
  parentUpdate?: unknown;
};

export function PracticePlayer({ sessionId, learnerName, title, spec, completed, embedded = false, onClose, onCompleted }: {
  sessionId: string; learnerName: string; title?: string; completed: boolean; spec: DynamicPracticeSpec;
  embedded?: boolean; onClose?: () => void; onCompleted?: (result: PracticePlayerResult) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<PracticeAnswer[]>([]);
  const [draft, setDraft] = useState<PracticeAnswer>(() => emptyAnswer(spec.activities[0]));
  const [hint, setHint] = useState(false);
  const [feedback, setFeedback] = useState<boolean | null | undefined>(undefined);
  const [incorrectAttempts, setIncorrectAttempts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PracticePlayerResult | null>(null);
  const activity = spec.activities[index];
  const progress = ((index + 1) / spec.activities.length) * 100;

  async function continuePractice() {
    if (!activity || !answerReady(draft)) return;
    if (feedback === false) {
      setFeedback(undefined);
      setHint(true);
      return;
    }
    if (feedback === undefined) {
      const evaluation = evaluateActivityAnswer(activity, draft);
      if (evaluation === false) {
        setIncorrectAttempts((current) => ({ ...current, [activity.id]: (current[activity.id] ?? 0) + 1 }));
      }
      setFeedback(evaluation);
      return;
    }
    await advancePractice(draft);
  }

  async function advancePractice(answer: PracticeAnswer) {
    const nextAnswers = [...answers, answer];
    if (index < spec.activities.length - 1) {
      const nextIndex = index + 1;
      setAnswers(nextAnswers); setIndex(nextIndex); setDraft(emptyAnswer(spec.activities[nextIndex])); setHint(false); setFeedback(undefined); setError(null);
      return;
    }
    setBusy(true); setError(null);
    const response = await fetch(`/api/practice/${sessionId}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: nextAnswers }) });
    const data = await response.json(); setBusy(false);
    if (response.ok) { setResult(data); onCompleted?.(data); }
    else setError(data.error ?? "Klio could not save this practice yet.");
  }

  async function moveOn() {
    if (!activity || feedback !== false) return;
    await advancePractice(draft);
  }

  if (completed && !result) return <PracticeFrame embedded={embedded}><KlioWordmark /><div className="practice-complete"><CheckCircle2 size={38} /><h1>This practice is complete.</h1>{embedded ? <button className="primary-button" type="button" onClick={onClose}>Back to the schedule</button> : <a className="primary-button" href="/app">Return to Klio</a>}</div></PracticeFrame>;
  if (result) return <PracticeFrame embedded={embedded}><KlioWordmark /><div className="practice-complete"><CheckCircle2 size={38} /><p className="eyebrow">Practice complete</p><h1>{result.score}%</h1><p>{result.feedback ?? (result.masteryMet ? "You met today’s practice goal." : "Good work. Klio has what it needs to choose the next step.")}</p>{embedded ? <button className="primary-button" type="button" onClick={onClose}>Done</button> : <a className="primary-button" href="/app">Return to Klio</a>}</div></PracticeFrame>;
  if (!activity) return <PracticeFrame embedded={embedded}><p>This activity has no practice steps.</p></PracticeFrame>;

  return (
    <PracticeFrame embedded={embedded}><header><KlioWordmark /><div className="practice-player-context">{title ? <strong>{title}</strong> : null}<span>{learnerName} · Activity {index + 1} of {spec.activities.length}</span></div>{embedded ? <button className="practice-close" type="button" aria-label="Close practice" onClick={onClose}><X size={18} /></button> : null}</header>
      <div className="practice-progress" role="progressbar" aria-label="Practice progress" aria-valuemin={1} aria-valuemax={spec.activities.length} aria-valuenow={index + 1}><i style={{ width: `${progress}%` }} /></div>
      <section className={`practice-stage activity-${activity.type}`}>
        <div className="practice-activity-meta"><p className="practice-subject">{spec.subject} · {humanActivityType(activity.type)}</p>{index === 0 ? <span>About {estimatedPracticeMinutes(spec.activities)} minutes</span> : null}</div>
        <p className="practice-instructions">{learnerInstructions(spec.instructions)}</p>
        <h1>{activity.prompt}</h1>
        <ActivityInput activity={activity} answer={draft} onChange={(answer) => { setDraft(answer); setFeedback(undefined); }} />
        {hint ? <p className="practice-hint"><Lightbulb size={16} /> {learnerHint(activity)}</p> : null}
        {feedback !== undefined ? <div className={`practice-feedback ${feedback === false ? "incorrect" : "correct"}`}><strong>{feedback === null ? "Saved for Klio" : feedback ? "That works" : "Not yet"}</strong>{feedback === null ? <p>Klio will check this explanation when you finish.</p> : feedback ? <p>{activity.explanation}</p> : <p>{retryMessage(activity, incorrectAttempts[activity.id] ?? 1)}</p>}</div> : null}
        {error ? <p className="practice-error" role="alert">{error}</p> : null}
        <footer><button className="hint-button" onClick={() => setHint(true)}><Lightbulb size={16} /> Hint</button><div className="practice-stage-actions">{feedback === false && (incorrectAttempts[activity.id] ?? 0) >= 2 ? <button className="practice-move-on" type="button" onClick={moveOn} disabled={busy}>Move on for now</button> : null}<button className="primary-button" onClick={continuePractice} disabled={!answerReady(draft) || busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <>{feedback === false ? "Try again" : feedback === undefined ? activity.type === "written_response" ? "Save response" : "Check answer" : index === spec.activities.length - 1 ? "Finish" : "Next"} <ArrowRight size={17} /></>}</button></div></footer>
      </section>
    </PracticeFrame>
  );
}

function PracticeFrame({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return embedded ? <div className="practice-shell practice-shell-embedded">{children}</div> : <main className="practice-shell">{children}</main>;
}

function ActivityInput({ activity, answer, onChange }: { activity: DynamicActivity; answer: PracticeAnswer; onChange: (answer: PracticeAnswer) => void }) {
  if (activity.type === "multiple_choice" && answer.type === "multiple_choice") return <div className="practice-choices">{activity.choices.map((choice) => <button type="button" className={answer.value === choice ? "selected" : ""} key={choice} onClick={() => onChange({ ...answer, value: choice })}>{choice}</button>)}</div>;
  if (activity.type === "short_answer" && answer.type === "short_answer") return <label className="practice-text-answer"><span>Your answer</span><input value={answer.value} placeholder={activity.placeholder ?? "Type your answer"} onChange={(event) => onChange({ ...answer, value: event.target.value })} autoComplete="off" /></label>;
  if (activity.type === "written_response" && answer.type === "written_response") return <div className="practice-written"><label><span>Your response</span><textarea value={answer.value} maxLength={activity.max_length} placeholder={activity.placeholder ?? "Explain your thinking"} onChange={(event) => onChange({ ...answer, value: event.target.value })} /></label><aside><strong>Build a complete response</strong><ul>{writtenResponseChecklist(activity).map((criterion) => <li key={criterion}>{criterion}</li>)}</ul><p className="practice-response-note">Klio checks your explanation after you finish. The expected answer stays hidden while you work.</p></aside></div>;
  if (activity.type === "graph_line" && answer.type === "graph_line") return <GraphLineInput activity={activity} answer={answer} onChange={onChange} />;
  return null;
}

function GraphLineInput({ activity, answer, onChange }: { activity: Extract<DynamicActivity, { type: "graph_line" }>; answer: Extract<PracticeAnswer, { type: "graph_line" }>; onChange: (answer: PracticeAnswer) => void }) {
  const [first, second] = answer.points;
  const width = 520; const height = 360; const padding = 28;
  const plotWidth = width - padding * 2; const plotHeight = height - padding * 2;
  const toSvg = (point: { x: number; y: number }) => ({ x: padding + ((point.x - activity.x_min) / (activity.x_max - activity.x_min)) * plotWidth, y: padding + ((activity.y_max - point.y) / (activity.y_max - activity.y_min)) * plotHeight });
  const fromSvg = (clientX: number, clientY: number, target: SVGSVGElement) => { const rect = target.getBoundingClientRect(); return { x: Math.round(activity.x_min + (((clientX - rect.left) / rect.width * width - padding) / plotWidth) * (activity.x_max - activity.x_min)), y: Math.round(activity.y_max - (((clientY - rect.top) / rect.height * height - padding) / plotHeight) * (activity.y_max - activity.y_min)) }; };
  const finiteFirst = Number.isFinite(first.x) && Number.isFinite(first.y); const finiteSecond = Number.isFinite(second.x) && Number.isFinite(second.y);
  const line = finiteFirst && finiteSecond && first.x !== second.x ? (() => { const slope = (second.y - first.y) / (second.x - first.x); const intercept = first.y - slope * first.x; return [toSvg({ x: activity.x_min, y: slope * activity.x_min + intercept }), toSvg({ x: activity.x_max, y: slope * activity.x_max + intercept })] as const; })() : null;
  const updatePoint = (pointIndex: 0 | 1, axis: "x" | "y", value: number) => { const points = [{ ...first }, { ...second }] as [{ x: number; y: number }, { x: number; y: number }]; points[pointIndex][axis] = value; onChange({ ...answer, points }); };
  const reset = () => onChange({ ...answer, points: [{ x: Number.NaN, y: Number.NaN }, { x: Number.NaN, y: Number.NaN }] });
  return <div className="practice-graph-wrap"><svg className="practice-graph" viewBox={`0 0 ${width} ${height}`} role="application" aria-label="Coordinate plane. Select two points to graph the line." onPointerDown={(event) => { const point = fromSvg(event.clientX, event.clientY, event.currentTarget); if (!finiteFirst || finiteSecond) onChange({ ...answer, points: [point, { x: Number.NaN, y: Number.NaN }] }); else onChange({ ...answer, points: [first, point] }); }}>
    <rect x={padding} y={padding} width={plotWidth} height={plotHeight} className="graph-background" />
    {range(activity.x_min, activity.x_max).map((x) => { const point = toSvg({ x, y: 0 }); return <g key={`x-${x}`}><line x1={point.x} x2={point.x} y1={padding} y2={height - padding} className={x === 0 ? "graph-axis" : "graph-grid"} />{x !== 0 ? <text x={point.x} y={toSvg({ x: 0, y: 0 }).y + 17}>{x}</text> : null}</g>; })}
    {range(activity.y_min, activity.y_max).map((y) => { const point = toSvg({ x: 0, y }); return <g key={`y-${y}`}><line x1={padding} x2={width - padding} y1={point.y} y2={point.y} className={y === 0 ? "graph-axis" : "graph-grid"} />{y !== 0 ? <text x={toSvg({ x: 0, y: 0 }).x + 7} y={point.y + 4}>{y}</text> : null}</g>; })}
    {line ? <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y} className="graph-user-line" /> : null}
    {finiteFirst ? <circle {...toSvg(first)} r="6" className="graph-point" /> : null}{finiteSecond ? <circle {...toSvg(second)} r="6" className="graph-point" /> : null}
  </svg><aside className="graph-controls"><div className="graph-guide"><strong>Plot two points</strong><ol><li>In <b>y = mx + b</b>, find <b>b</b> and plot the y-intercept where x is 0.</li><li>Read <b>m</b> as rise over run. Use it to find a second point.</li><li>Click the grid or enter both points below. Klio draws the line through them.</li></ol></div><div className="graph-point-fields">{([first, second] as const).map((point, pointIndex) => <fieldset key={pointIndex}><legend>{pointIndex === 0 ? "First point" : "Second point"}</legend><label>x<input aria-label={`${pointIndex === 0 ? "First" : "Second"} point x`} type="number" step="any" min={activity.x_min} max={activity.x_max} value={Number.isFinite(point.x) ? point.x : ""} onChange={(event) => updatePoint(pointIndex as 0 | 1, "x", event.target.value === "" ? Number.NaN : Number(event.target.value))} /></label><label>y<input aria-label={`${pointIndex === 0 ? "First" : "Second"} point y`} type="number" step="any" min={activity.y_min} max={activity.y_max} value={Number.isFinite(point.y) ? point.y : ""} onChange={(event) => updatePoint(pointIndex as 0 | 1, "y", event.target.value === "" ? Number.NaN : Number(event.target.value))} /></label></fieldset>)}</div><div className="graph-control-actions"><button type="button" onClick={reset}><RotateCcw size={13} /> Clear points</button></div><p className="graph-status" aria-live="polite">{!finiteFirst ? "Add the first point to begin." : !finiteSecond ? "Now use the slope to add a second point." : "Your two points are plotted. Check the line when ready."}</p></aside></div>;
}

function emptyAnswer(activity: DynamicActivity | undefined): PracticeAnswer {
  if (!activity || activity.type === "multiple_choice") return { activityId: activity?.id ?? "missing", type: "multiple_choice", value: "" };
  if (activity.type === "short_answer") return { activityId: activity.id, type: "short_answer", value: "" };
  if (activity.type === "written_response") return { activityId: activity.id, type: "written_response", value: "" };
  return { activityId: activity.id, type: "graph_line", points: [{ x: Number.NaN, y: Number.NaN }, { x: Number.NaN, y: Number.NaN }] };
}
function answerReady(answer: PracticeAnswer) { if (answer.type === "graph_line") return answer.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) && answer.points[0].x !== answer.points[1].x; return answer.value.trim().length > 0; }
function humanActivityType(type: DynamicActivity["type"]) { return ({ multiple_choice: "Choose", short_answer: "Solve", graph_line: "Graph", written_response: "Explain" } as const)[type]; }
function range(min: number, max: number) { return Array.from({ length: max - min + 1 }, (_, index) => min + index); }
function learnerInstructions(instructions: string) { return instructions.split(/\bSource context:/i)[0].replace(/\s+/g, " ").trim(); }
function learnerHint(activity: DynamicActivity) {
  if (activity.type === "multiple_choice") return "Rule out choices that do not match the lesson rule, then compare the remaining choices.";
  if (activity.type === "short_answer") return "Write the first operation or step, then work forward one step at a time. Check your result in the original problem.";
  if (activity.type === "graph_line") return "Find m and b in y = mx + b. Plot b on the y-axis, then use rise over run for a second point.";
  return "Answer each part of the prompt, use the lesson vocabulary, and add one sentence explaining how you know.";
}
function retryMessage(activity: DynamicActivity, attempts: number) {
  if (activity.type === "graph_line") return attempts > 1 ? "One or both points do not lie on the line yet. Recheck b, then apply the rise and run from your first point." : "That line does not match the equation yet. Recheck the y-intercept and slope, then adjust one point.";
  if (activity.type === "multiple_choice") return attempts > 1 ? "Compare the remaining choices to the rule in the prompt. Pick the one you can justify." : "Try a different choice and use the hint to explain why it fits.";
  return attempts > 1 ? "Check your operation and test the result in the original problem. Then try once more." : "Check the first step, then try the problem again. The answer stays hidden while you work.";
}
function writtenResponseChecklist(activity: Extract<DynamicActivity, { type: "written_response" }>) {
  const text = `${activity.prompt} ${activity.success_criteria.join(" ")}`.toLowerCase();
  if (/equation|equal|solve|math|number/.test(text)) return ["Show the important steps in order.", "State the result clearly.", "Explain why your operation or reasoning is valid."];
  if (/source|evidence|claim|history|passage|text/.test(text)) return ["State a clear claim or answer.", "Use one specific detail from the source or lesson.", "Explain how that detail supports your answer."];
  if (/science|cell|water|concentration|osmosis|biology|cause/.test(text)) return ["Answer what changes or happens.", "Use the relevant science vocabulary.", "Connect the cause to the result."];
  return ["Answer every part of the prompt.", "Use a specific lesson detail or example.", "Explain how you know."];
}
