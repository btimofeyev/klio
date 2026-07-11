"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, ChevronDown, FilePenLine, FileText, Image as ImageIcon, LoaderCircle, Mic, Sparkles, X } from "lucide-react";
import { reviewConfidenceLabel, reviewStatusLabel, type ReviewGroup, type ReviewHistoryItem, type ReviewSource, type ReviewSuggestion } from "@/lib/review/presentation";

export type { ReviewGroup, ReviewHistoryItem, ReviewSource, ReviewSuggestion } from "@/lib/review/presentation";

type Result = { requestId: string; entityType: ReviewSuggestion["entityType"]; entityId: string; status: "completed" | "not_found_or_already_decided" | "failed"; error?: string };
type CorrectionCode = "wrong_learner" | "wrong_subject" | "misunderstood_work" | "parent_or_sibling_helped" | "not_enough_information" | "something_else";
const correctionOptions: Array<{ code: CorrectionCode; label: string }> = [
  { code: "wrong_learner", label: "Wrong learner" }, { code: "wrong_subject", label: "Wrong subject" },
  { code: "misunderstood_work", label: "Misunderstood the work" }, { code: "parent_or_sibling_helped", label: "A parent or sibling helped" },
  { code: "not_enough_information", label: "Not enough information" }, { code: "something_else", label: "Something else" },
];

export function ReviewWorkspace({ familyId, initialGroups, initialHistory, staleCount }: { familyId: string; initialGroups: ReviewGroup[]; initialHistory: ReviewHistoryItem[]; staleCount: number }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [activeGroup, setActiveGroup] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const totalSuggestions = useMemo(() => groups.reduce((count, group) => count + group.suggestions.length, 0), [groups]);

  function key(item: ReviewSuggestion) { return `${item.entityType}:${item.id}`; }
  function removeCompleted(results: Result[]) {
    const completed = new Set(results.filter((result) => result.status === "completed").map((result) => `${result.entityType}:${result.entityId}`));
    const failed = results.filter((result) => result.status !== "completed");
    setErrors((current) => ({ ...current, ...Object.fromEntries(failed.map((result) => [`${result.entityType}:${result.entityId}`, result.status === "not_found_or_already_decided" ? "This suggestion was already handled. Refresh to continue." : result.error ?? "Klio could not save this decision. Try again."])) }));
    setGroups((current) => current.map((group) => ({ ...group, suggestions: group.suggestions.filter((item) => !completed.has(key(item))) })).filter((group) => group.suggestions.length));
    setActiveGroup((current) => Math.min(current, Math.max(0, groups.length - 2)));
  }

  async function post(items: unknown[]): Promise<Result[] | null> {
    const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, items }) });
    const body = await response.json();
    if (!response.ok) return null;
    return body.results as Result[];
  }

  async function approve(item: ReviewSuggestion) {
    const itemKey = key(item); setBusy(itemKey); setErrors((current) => ({ ...current, [itemKey]: "" }));
    const results = await post([{ requestId: item.requestId, entityType: item.entityType, entityId: item.id, decision: "approved" }]);
    setBusy(null);
    if (!results) { setErrors((current) => ({ ...current, [itemKey]: "Klio could not save this decision. Try again." })); return; }
    removeCompleted(results); router.refresh();
  }

  async function approveGroup(group: ReviewGroup) {
    const busyKey = `group:${group.id}`; setBusy(busyKey);
    const results = await post(group.suggestions.map((item) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.id, decision: "approved" })));
    setBusy(null);
    if (!results) { setErrors((current) => ({ ...current, [busyKey]: "Klio could not save these decisions. Try again." })); return; }
    removeCompleted(results); router.refresh();
  }

  async function reject(item: ReviewSuggestion, form: HTMLFormElement) {
    const data = new FormData(form); const code = String(data.get("reasonCode")); const detail = String(data.get("detail") ?? "").trim();
    const itemKey = key(item); setBusy(itemKey);
    const results = await post([{ requestId: item.requestId, entityType: item.entityType, entityId: item.id, decision: "rejected", reason: { code, detail: detail || undefined } }]);
    setBusy(null);
    if (!results) { setErrors((current) => ({ ...current, [itemKey]: "Choose a reason and try again." })); return; }
    removeCompleted(results); setCorrecting(null); router.refresh();
  }

  async function saveEdit(item: ReviewSuggestion, form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form)); const itemKey = key(item); setBusy(itemKey);
    const updates = item.entityType === "artifact"
      ? { title: values.title, summary: values.summary }
      : { subject: values.subject, skillLabel: values.skillLabel, status: values.status, rationale: values.rationale };
    const results = await post([{ requestId: item.requestId, entityType: item.entityType, entityId: item.id, updates }]);
    setBusy(null);
    if (!results?.some((result) => result.status === "completed")) { setErrors((current) => ({ ...current, [itemKey]: "Klio could not save these edits. Try again." })); return; }
    setGroups((current) => current.map((group) => ({ ...group, suggestions: group.suggestions.map((currentItem) => key(currentItem) !== itemKey ? currentItem : item.entityType === "artifact" ? { ...currentItem, conclusion: String(values.title), artifact: { ...currentItem.artifact!, summary: String(values.summary) } } : { ...currentItem, subject: String(values.subject), conclusion: String(values.skillLabel), status: String(values.status) as ReviewSuggestion["status"], explanation: String(values.rationale) }) })));
    setEditing(null); router.refresh();
  }

  if (!groups.length) return <><div className="review-empty"><Check size={24} /><h2>You’re all caught up</h2><p>New suggestions will appear here when Klio needs your input.</p></div><History items={initialHistory} /></>;

  return (
    <>
      <div className="review-overview"><strong>{totalSuggestions} {totalSuggestions === 1 ? "suggestion" : "suggestions"}</strong><span>Nothing becomes part of Klio’s understanding until you confirm it.</span></div>
      {staleCount ? <p className="review-diagnostic" role="status">{staleCount} older {staleCount === 1 ? "suggestion is" : "suggestions are"} no longer available and will not be shown.</p> : null}
      <div className="review-mobile-progress"><button type="button" onClick={() => setActiveGroup((value) => Math.max(0, value - 1))} disabled={activeGroup === 0}><ArrowLeft size={17} /> Back</button><span>{activeGroup + 1} of {groups.length}</span></div>
      <div className="review-groups">
        {groups.map((group, index) => <section className={`review-group ${index === activeGroup ? "mobile-current" : ""}`} key={group.id}>
          <header className="review-group-header"><div><p className="eyebrow">Work Klio reviewed</p><h2>{sourceHeading(group.sources)}</h2><p>{group.studentName} · {relativeDate(group.createdAt)}</p></div>{group.suggestions.length > 1 ? <button type="button" onClick={() => approveGroup(group)} disabled={Boolean(busy)}>{busy === `group:${group.id}` ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Looks right for all</button> : null}</header>
          <SourcePreview sources={group.sources} />
          <div className="review-suggestions">
            {group.suggestions.map((item) => {
              const itemKey = key(item); const isEditing = editing === itemKey; const isCorrecting = correcting === itemKey;
              return <article className="review-suggestion" key={itemKey}>
                <div className="review-suggestion-heading"><span>{item.entityType === "artifact" ? <Sparkles size={16} /> : item.subject?.slice(0, 1)}</span><div><p>{item.label}</p><h3>{item.conclusion}</h3></div></div>
                {item.entityType === "skill_observation" ? <div className="review-facts"><span>{item.subject}</span><span>{reviewStatusLabel(item.status)}</span>{item.confidence != null ? <span>{reviewConfidenceLabel(item.confidence)}</span> : null}</div> : item.artifact?.summary ? <p className="review-artifact-summary">{item.artifact.summary}</p> : null}
                <dl className="review-why"><div><dt>Why Klio thinks this</dt><dd>{item.explanation}</dd></div><div><dt>If this looks right</dt><dd>{item.consequence}</dd></div></dl>
                {item.uncertainty.length ? <div className="review-uncertainty"><AlertCircle size={15} /><div><strong>Klio isn’t completely sure</strong>{item.uncertainty.map((flag) => <p key={flag}>{flag}</p>)}</div></div> : null}
                {item.entityType === "artifact" ? <Link className="review-open-draft" href={`/app/artifacts/${item.id}`}><FileText size={14} /> Open full draft</Link> : null}
                {errors[itemKey] ? <p className="review-error" role="alert">{errors[itemKey]}</p> : null}
                {isEditing ? <EditForm item={item} busy={busy === itemKey} onCancel={() => setEditing(null)} onSubmit={(form) => saveEdit(item, form)} /> : null}
                {isCorrecting ? <CorrectionForm busy={busy === itemKey} onCancel={() => setCorrecting(null)} onSubmit={(form) => reject(item, form)} /> : null}
                <div className="review-actions" aria-label={`Decide about ${item.conclusion}`}>
                  <button type="button" className="not-quite" onClick={() => { setCorrecting(isCorrecting ? null : itemKey); setEditing(null); }}><X size={15} /> Not quite</button>
                  <button type="button" onClick={() => { setEditing(isEditing ? null : itemKey); setCorrecting(null); }}><FilePenLine size={15} /> {item.entityType === "artifact" ? "Edit summary" : "Edit"}</button>
                  <button type="button" className="looks-right" onClick={() => approve(item)} disabled={Boolean(busy)}>{busy === itemKey ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Looks right</button>
                </div>
              </article>;
            })}
          </div>
        </section>)}
      </div>
      <History items={initialHistory} />
    </>
  );
}

function SourcePreview({ sources }: { sources: ReviewSource[] }) {
  if (!sources.length) return <div className="review-source-unavailable"><AlertCircle size={16} /><div><strong>Source unavailable</strong><p>This suggestion can still be corrected, but the original work is no longer linked.</p></div></div>;
  return <div className="review-sources">{sources.map((source) => <article key={source.id}><span className="review-source-icon">{source.kind === "voice" ? <Mic size={17} /> : source.mimeType?.startsWith("image/") ? <ImageIcon size={17} /> : <FileText size={17} />}</span><div><strong>{source.title || sourceKind(source.kind)}</strong><p>{source.rawText ? excerpt(source.rawText) : mediaLabel(source)}</p></div><Link href={source.mimeType ? `/api/evidence/${source.id}/download` : `/app/records?q=${encodeURIComponent(source.title || source.rawText?.slice(0, 60) || "")}`}>View original</Link></article>)}</div>;
}

function EditForm({ item, busy, onCancel, onSubmit }: { item: ReviewSuggestion; busy: boolean; onCancel: () => void; onSubmit: (form: HTMLFormElement) => void }) {
  return <form className="review-inline-editor" onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget); }}>
    {item.entityType === "artifact" ? <><label>Title<input name="title" defaultValue={item.conclusion} required maxLength={200} /></label><label>Summary only<textarea name="summary" defaultValue={item.artifact?.summary ?? ""} rows={3} maxLength={5000} /></label><p>Use “Open full draft” to review the complete material.</p></> : <><div className="review-editor-grid"><label>Subject<input name="subject" defaultValue={item.subject} required maxLength={80} /></label><label>Learning stage<select name="status" defaultValue={item.status}><option value="emerging">Just getting started</option><option value="developing">Still practicing</option><option value="secure">Doing this independently</option><option value="needs-review">Needs another look</option></select></label></div><label>What Klio noticed<input name="skillLabel" defaultValue={item.conclusion} required maxLength={200} /></label><label>Why<textarea name="rationale" defaultValue={item.explanation} rows={3} required maxLength={5000} /></label></>}
    <div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : null} Save changes</button></div>
  </form>;
}

function CorrectionForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (form: HTMLFormElement) => void }) {
  return <form className="review-correction" onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget); }}><h4>Help Klio understand what was off</h4><label>What needs correcting?<select name="reasonCode" required defaultValue=""><option value="" disabled>Choose a reason</option>{correctionOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label><label>Anything else? <span>Optional</span><textarea name="detail" maxLength={1000} rows={3} placeholder="Add a short correction without copying the child’s work." /></label><div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : null} Submit correction</button></div></form>;
}

function History({ items }: { items: ReviewHistoryItem[] }) {
  return <details className="review-history"><summary>Recent decisions <ChevronDown size={15} /></summary>{items.length ? <div>{items.map((item) => <article key={item.id}><p>{item.sentence}</p><span>{item.learner ? `${item.learner} · ` : ""}{relativeDate(item.createdAt)}</span></article>)}</div> : <p>No decisions yet.</p>}</details>;
}

function sourceHeading(sources: ReviewSource[]) { return sources[0]?.title || (sources[0]?.rawText ? excerpt(sources[0].rawText, 54) : sources.length ? sourceKind(sources[0].kind) : "Original work unavailable"); }
function sourceKind(kind: string) { return kind === "voice" ? "Voice note" : kind === "photo" || kind === "image" ? "Photo" : kind === "note" ? "Parent note" : "Shared file"; }
function mediaLabel(source: ReviewSource) { return source.mimeType?.startsWith("image/") ? "Image from the original work" : source.kind === "voice" ? "Voice note from the original work" : "Original file"; }
function excerpt(value: string, limit = 170) { const clean = value.replace(/\s+/g, " ").trim(); return clean.length > limit ? `${clean.slice(0, limit).trim()}…` : clean; }
function relativeDate(value: string) { const date = new Date(value); const days = Math.floor((Date.now() - date.getTime()) / 86_400_000); if (days <= 0) return "Today"; if (days === 1) return "Yesterday"; if (days < 7) return `${days} days ago`; return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
