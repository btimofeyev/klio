"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FilePenLine, LoaderCircle, Sparkles, X } from "lucide-react";

export type ReviewArtifact = { id: string; title: string; summary: string | null; type: string; createdAt: string; studentName: string | null };
export type ReviewObservation = { id: string; subject: string; skillLabel: string; status: "emerging" | "developing" | "secure" | "needs-review"; rationale: string; confidence: number | null; createdAt: string; studentName: string | null };

type ReviewItem = ({ entityType: "artifact" } & ReviewArtifact) | ({ entityType: "skill_observation" } & ReviewObservation);

export function ReviewWorkspace({ familyId, initialArtifacts, initialObservations }: { familyId: string; initialArtifacts: ReviewArtifact[]; initialObservations: ReviewObservation[] }) {
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[]>([
    ...initialArtifacts.map((item): ReviewItem => ({ ...item, entityType: "artifact" })),
    ...initialObservations.map((item): ReviewItem => ({ ...item, entityType: "skill_observation" })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function key(item: ReviewItem) { return `${item.entityType}:${item.id}`; }
  function toggle(item: ReviewItem) { const value = key(item); setSelected((current) => current.includes(value) ? current.filter((itemKey) => itemKey !== value) : [...current, value]); }
  function selectAll() { setSelected(selected.length === items.length ? [] : items.map(key)); }

  async function decide(decision: "approved" | "rejected") {
    const chosen = items.filter((item) => selected.includes(key(item)));
    if (!chosen.length) return;
    setBusy(true); setMessage(null);
    const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, items: chosen.map((item) => ({ entityType: item.entityType, entityId: item.id, decision })) }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Could not update those drafts."); return; }
    const done = new Set(result.completed as string[]);
    setItems((current) => current.filter((item) => !done.has(item.id)));
    setSelected([]);
    setMessage(`${done.size} ${done.size === 1 ? "draft" : "drafts"} ${decision}.`);
    router.refresh();
  }

  async function saveEdit(item: ReviewItem, form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form));
    const updates = item.entityType === "artifact"
      ? { title: values.title, summary: values.summary }
      : { subject: values.subject, skillLabel: values.skillLabel, status: values.status, rationale: values.rationale };
    setBusy(true); setMessage(null);
    const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, items: [{ entityType: item.entityType, entityId: item.id, updates }] }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Could not save that edit."); return; }
    setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, ...(item.entityType === "artifact" ? { title: String(values.title), summary: String(values.summary) } : { subject: String(values.subject), skillLabel: String(values.skillLabel), status: String(values.status) as ReviewObservation["status"], rationale: String(values.rationale) }) } as ReviewItem : currentItem));
    setEditing(null); setMessage("Edits saved. The draft is still waiting for your decision."); router.refresh();
  }

  return (
    <div className="review-workspace">
      <div className="review-toolbar"><button onClick={selectAll} className="review-select-all"><span className={selected.length === items.length && items.length ? "checked" : ""}>{selected.length === items.length && items.length ? <Check size={12} /> : null}</span>{selected.length === items.length && items.length ? "Clear all" : "Select all"}</button><small>{items.length} waiting</small></div>
      {message ? <p className="review-message" role="status">{message}</p> : null}
      {items.length ? <div className="review-list">{items.map((item) => {
        const itemKey = key(item);
        const checked = selected.includes(itemKey);
        const isEditing = editing === itemKey;
        return <article className={`review-item ${checked ? "selected" : ""}`} key={itemKey}>
          <button className={`review-checkbox ${checked ? "checked" : ""}`} onClick={() => toggle(item)} aria-label={`${checked ? "Deselect" : "Select"} ${item.entityType === "artifact" ? item.title : item.skillLabel}`}>{checked ? <Check size={13} /> : null}</button>
          <span className="review-item-mark">{item.entityType === "artifact" ? <Sparkles size={15} /> : item.subject.slice(0, 1)}</span>
          <div className="review-item-copy"><strong>{item.entityType === "artifact" ? item.title : item.skillLabel}</strong><small>{item.entityType === "artifact" ? `${item.type.replaceAll("_", " ")} draft` : `${item.subject} · ${item.status}`} · {item.studentName ?? "Family"}</small><p>{item.entityType === "artifact" ? item.summary : item.rationale}</p></div>
          <button className="review-edit-button" onClick={() => setEditing(isEditing ? null : itemKey)}><FilePenLine size={14} /> Edit <ChevronDown size={12} /></button>
          {isEditing ? <form className="review-inline-editor" onSubmit={(event) => { event.preventDefault(); saveEdit(item, event.currentTarget); }}>
            {item.entityType === "artifact" ? <><label>Title<input name="title" defaultValue={item.title} required maxLength={200} /></label><label>Summary<textarea name="summary" defaultValue={item.summary ?? ""} rows={3} /></label></> : <><div className="review-editor-grid"><label>Subject<input name="subject" defaultValue={item.subject} required /></label><label>Status<select name="status" defaultValue={item.status}><option value="emerging">Emerging</option><option value="developing">Developing</option><option value="secure">Secure</option><option value="needs-review">Needs review</option></select></label></div><label>Skill<input name="skillLabel" defaultValue={item.skillLabel} required /></label><label>Rationale<textarea name="rationale" defaultValue={item.rationale} rows={3} required /></label></>}
            <div><button type="button" onClick={() => setEditing(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={13} /> : null} Save edits</button></div>
          </form> : null}
        </article>;
      })}</div> : <div className="review-empty"><Check size={22} /><h3>Review is clear</h3><p>New Klio drafts and learning observations will appear here.</p></div>}
      {selected.length ? <div className="review-bulk-bar"><span>{selected.length} selected</span><button onClick={() => setSelected([])}><X size={14} /> Clear</button><button className="bulk-reject" onClick={() => decide("rejected")} disabled={busy}>Reject</button><button className="bulk-approve" onClick={() => decide("approved")} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Approve</button></div> : null}
    </div>
  );
}
