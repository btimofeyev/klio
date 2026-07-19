"use client";

import { useRef, useState } from "react";
import type { AssignmentDTO } from "@/lib/data/operations";
import type { AttentionMode } from "@/lib/schedule/parent-attention";

type SavedAttention = Pick<AssignmentDTO, "attentionMode" | "parentAttentionMinutes" | "resolvedAttentionMode" | "resolvedParentMinutes" | "attentionInherited" | "attentionSource">;

export function ParentSupportLabel({ assignment }: { assignment: AssignmentDTO }) {
  return <span className={`parent-support-label support-${assignment.resolvedAttentionMode}`}>{supportLabel(assignment.resolvedAttentionMode, assignment.resolvedParentMinutes)}</span>;
}

export function ParentSupportControl({ assignment, onSaved, onAskKlio }: { assignment: AssignmentDTO; onSaved: (value: SavedAttention) => void; onAskKlio: (request: string) => void }) {
  const [mode, setMode] = useState<AttentionMode | "inherit">(assignment.attentionMode ?? "inherit");
  const [minutes, setMinutes] = useState(assignment.parentAttentionMinutes ?? Math.min(10, assignment.estimatedMinutes ?? 10));
  const [resolvedMode, setResolvedMode] = useState(assignment.resolvedAttentionMode);
  const [resolvedMinutes, setResolvedMinutes] = useState(assignment.resolvedParentMinutes);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ overlap: { start: number; end: number } }>>([]);
  const selectRef = useRef<HTMLSelectElement>(null);

  async function save() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/assignments/${assignment.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ attentionMode: mode === "inherit" ? null : mode, parentAttentionMinutes: mode === "flexible" ? minutes : null }),
      });
      const result = await response.json() as { assignment?: SavedAttention; attentionConflicts?: Array<{ overlap: { start: number; end: number } }>; error?: string };
      if (!response.ok || !result.assignment) return setMessage(result.error ?? "Klio could not save that parent support setting.");
      onSaved(result.assignment);
      setResolvedMode(result.assignment.resolvedAttentionMode);
      setResolvedMinutes(result.assignment.resolvedParentMinutes);
      setConflicts(result.attentionConflicts ?? []);
      setMessage("Saved. Current lessons were not moved.");
    } catch {
      setMessage("Klio lost the connection before the setting was saved.");
    } finally {
      setPending(false);
    }
  }

  const previewMode = mode === "inherit" ? resolvedMode : mode;
  const previewParentMinutes = mode === "inherit" ? resolvedMinutes : mode === "independent" ? 0 : mode === "flexible" ? minutes : assignment.estimatedMinutes ?? 0;
  return <section className="parent-support-control" aria-labelledby={`parent-support-${assignment.id}`}>
    <div className="parent-support-heading"><div><strong id={`parent-support-${assignment.id}`}>Parent support</strong><small>{mode === "inherit" ? `Using subject default: ${supportLabel(resolvedMode, resolvedMinutes)}` : attentionDescription(mode)}</small>{assignment.scheduledTime ? <small className="parent-support-timing">{supportTiming(assignment.scheduledTime, assignment.estimatedMinutes ?? 0, previewParentMinutes)}</small> : null}</div><ParentSupportLabel assignment={{ ...assignment, resolvedAttentionMode: previewMode, resolvedParentMinutes: previewParentMinutes }} /></div>
    <div className="parent-support-fields"><label><span>Lesson support</span><select ref={selectRef} value={mode} onChange={(event) => { const next = event.target.value as AttentionMode | "inherit"; setMode(next); setMessage(null); if (next === "flexible" && minutes < 1) setMinutes(Math.min(10, assignment.estimatedMinutes ?? 10)); }} disabled={pending}><option value="inherit">Use subject default</option><option value="parent_led">Needs me</option><option value="independent">Independent</option><option value="flexible">Start together</option></select></label>{mode === "flexible" ? <label><span>Minutes together</span><input type="number" min="1" max={assignment.estimatedMinutes ?? 480} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} disabled={pending} /></label> : null}<button type="button" onClick={() => void save()} disabled={pending || mode === "flexible" && (minutes < 1 || Boolean(assignment.estimatedMinutes && minutes > assignment.estimatedMinutes))}>{pending ? "Saving…" : "Save"}</button></div>
    {message ? <p className={message.startsWith("Saved") ? "parent-support-success" : "parent-support-error"} role={message.startsWith("Saved") ? "status" : "alert"}>{message}</p> : null}
    {conflicts.length ? <div className="parent-support-warning" role="alert"><strong>{conflictCopy(conflicts[0].overlap.start)}</strong><p>The support type changed, but Klio kept the current schedule.</p><div><button type="button" onClick={() => onAskKlio(`Reorganize ${assignment.title} on ${assignment.scheduledDate ?? "its scheduled day"} so no parent-led time overlaps across learners. Keep curriculum order, teaching hours, calendar conflicts, and learner capacity. Show me the editable proposal before changing anything.`)}>Ask Klio to reorganize</button><button type="button" onClick={() => setConflicts([])}>Keep the current schedule</button><button type="button" onClick={() => selectRef.current?.focus()}>Edit the lesson type</button></div></div> : null}
  </section>;
}

export function supportLabel(mode: AttentionMode, parentMinutes: number) {
  if (mode === "parent_led") return "With you";
  if (mode === "independent") return "Independent";
  if (mode === "flexible") return `${parentMinutes} min together`;
  return "Not set";
}

function attentionDescription(mode: AttentionMode) {
  if (mode === "parent_led") return "You plan to teach this lesson directly.";
  if (mode === "independent") return "This learner can work while you help someone else.";
  if (mode === "flexible") return "You help them begin, then they continue independently.";
  return "Klio schedules this conservatively until you choose.";
}

function conflictCopy(minutes: number) {
  const hour = Math.floor(minutes / 60); const minute = minutes % 60;
  return `Two lessons need you at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)))}.`;
}

function supportTiming(start: string, lessonMinutes: number, parentMinutes: number) {
  const startMinutes = timeMinutes(start);
  if (startMinutes === null) return "";
  const learner = `${displayMinutes(startMinutes)}–${displayMinutes(startMinutes + lessonMinutes)}`;
  const parent = parentMinutes > 0 ? `${displayMinutes(startMinutes)}–${displayMinutes(startMinutes + parentMinutes)} with you` : "No direct parent time";
  return `Learner ${learner} · ${parent}`;
}

function timeMinutes(value: string) { const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
function displayMinutes(value: number) { const hour = Math.floor(value / 60); return `${hour % 12 || 12}:${String(value % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`; }
