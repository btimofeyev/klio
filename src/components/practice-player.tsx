"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Lightbulb, LoaderCircle, RotateCcw } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";
import { evaluateActivityAnswer } from "@/lib/practice/score";
import type { DynamicActivity, DynamicPracticeSpec, PracticeAnswer } from "@/lib/practice/spec";

export function PracticePlayer({ sessionId, learnerName, spec, completed }: {
  sessionId: string; learnerName: string; completed: boolean; spec: DynamicPracticeSpec;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<PracticeAnswer[]>([]);
  const [draft, setDraft] = useState<PracticeAnswer>(() => emptyAnswer(spec.activities[0]));
  const [hint, setHint] = useState(false);
  const [feedback, setFeedback] = useState<boolean | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ score: number; masteryMet: boolean; reviewNeeded?: boolean } | null>(null);
  const activity = spec.activities[index];

  async function continuePractice() {
    if (!activity || !answerReady(draft)) return;
    if (feedback === undefined) {
      setFeedback(evaluateActivityAnswer(activity, draft));
      return;
    }
    const nextAnswers = [...answers, draft];
    if (index < spec.activities.length - 1) {
      const nextIndex = index + 1;
      setAnswers(nextAnswers); setIndex(nextIndex); setDraft(emptyAnswer(spec.activities[nextIndex])); setHint(false); setFeedback(undefined); setError(null);
      return;
    }
    setBusy(true); setError(null);
    const response = await fetch(`/api/practice/${sessionId}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: nextAnswers }) });
    const data = await response.json(); setBusy(false);
    if (response.ok) setResult(data);
    else setError(data.error ?? "Klio could not save this practice yet.");
  }

  if (completed && !result) return <main className="practice-shell"><KlioWordmark /><div className="practice-complete"><CheckCircle2 size={38} /><h1>This practice is complete.</h1><a className="primary-button" href="/app">Return to Klio</a></div></main>;
  if (result) return <main className="practice-shell"><KlioWordmark /><div className="practice-complete"><CheckCircle2 size={38} /><p className="eyebrow">Practice complete</p><h1>{result.score}%</h1><p>{result.masteryMet ? "You met today’s practice goal." : "Good work. This gives your parent useful information for what comes next."}{result.reviewNeeded ? " Your written response is ready for parent review." : ""}</p><a className="primary-button" href="/app">Return to Klio</a></div></main>;
  if (!activity) return <main className="practice-shell"><p>This activity has no practice steps.</p></main>;

  return (
    <main className="practice-shell"><header><KlioWordmark /><span>{learnerName} · {index + 1} of {spec.activities.length}</span></header>
      <section className={`practice-stage activity-${activity.type}`}>
        <p className="practice-subject">{spec.subject} · {humanActivityType(activity.type)}</p>
        <p className="practice-instructions">{spec.instructions}</p>
        <h1>{activity.prompt}</h1>
        <ActivityInput activity={activity} answer={draft} onChange={(answer) => { setDraft(answer); setFeedback(undefined); }} />
        {hint && activity.hints.length ? <p className="practice-hint"><Lightbulb size={16} /> {activity.hints[0]}</p> : null}
        {feedback !== undefined ? <div className={`practice-feedback ${feedback === false ? "incorrect" : "correct"}`}><strong>{feedback === null ? "Saved for review" : feedback ? "That works" : "Check this step"}</strong><p>{activity.explanation}</p></div> : null}
        {error ? <p className="practice-error" role="alert">{error}</p> : null}
        <footer><button className="hint-button" onClick={() => setHint(true)} disabled={!activity.hints.length}><Lightbulb size={16} /> Hint</button><button className="primary-button" onClick={continuePractice} aria-disabled={!answerReady(draft) || busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <>{feedback === undefined ? activity.type === "written_response" ? "Save response" : "Check answer" : index === spec.activities.length - 1 ? "Finish" : "Next"} <ArrowRight size={17} /></>}</button></footer>
      </section>
    </main>
  );
}

function ActivityInput({ activity, answer, onChange }: { activity: DynamicActivity; answer: PracticeAnswer; onChange: (answer: PracticeAnswer) => void }) {
  if (activity.type === "multiple_choice" && answer.type === "multiple_choice") return <div className="practice-choices">{activity.choices.map((choice) => <button type="button" className={answer.value === choice ? "selected" : ""} key={choice} onClick={() => onChange({ ...answer, value: choice })}>{choice}</button>)}</div>;
  if (activity.type === "short_answer" && answer.type === "short_answer") return <label className="practice-text-answer"><span>Your answer</span><input value={answer.value} placeholder={activity.placeholder ?? "Type your answer"} onChange={(event) => onChange({ ...answer, value: event.target.value })} autoComplete="off" /></label>;
  if (activity.type === "written_response" && answer.type === "written_response") return <div className="practice-written"><label><span>Your response</span><textarea value={answer.value} maxLength={activity.max_length} placeholder={activity.placeholder ?? "Explain your thinking"} onChange={(event) => onChange({ ...answer, value: event.target.value })} /></label><aside><strong>Include:</strong><ul>{activity.success_criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></aside></div>;
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
  </svg><div className="graph-controls"><p>{!finiteFirst ? "Choose the first point." : !finiteSecond ? "Choose a second point." : "Two points define your line."}</p><div>{([first, second] as const).map((point, pointIndex) => <fieldset key={pointIndex}><legend>Point {pointIndex + 1}</legend><label>x<input type="number" min={activity.x_min} max={activity.x_max} value={Number.isFinite(point.x) ? point.x : ""} onChange={(event) => updatePoint(pointIndex as 0 | 1, "x", event.target.value === "" ? Number.NaN : Number(event.target.value))} /></label><label>y<input type="number" min={activity.y_min} max={activity.y_max} value={Number.isFinite(point.y) ? point.y : ""} onChange={(event) => updatePoint(pointIndex as 0 | 1, "y", event.target.value === "" ? Number.NaN : Number(event.target.value))} /></label></fieldset>)}</div><button type="button" onClick={reset}><RotateCcw size={13} /> Reset graph</button></div></div>;
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
