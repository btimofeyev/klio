"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Folder, FolderOpen, LoaderCircle, MoreHorizontal, Sparkles, X } from "lucide-react";
import type { CategoryDTO, EvidenceDTO } from "@/lib/data/workspace";

type FolderMode = "rename" | "merge" | "delete" | null;

export function OrganizationWorkspace({ familyId, initialCategories, initialEvidence }: {
  familyId: string;
  initialCategories: CategoryDTO[];
  initialEvidence: EvidenceDTO[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [evidence, setEvidence] = useState(initialEvidence);
  const [activeId, setActiveId] = useState<string>(initialCategories[0]?.id ?? "unfiled");
  const [mode, setMode] = useState<FolderMode>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const unfiled = useMemo(() => evidence.filter((item) => !item.categories.length), [evidence]);
  const activeCategory = categories.find((category) => category.id === activeId) ?? null;
  const visibleEvidence = activeId === "unfiled"
    ? unfiled
    : evidence.filter((item) => item.categories.some((category) => category.id === activeId));

  async function renameFolder() {
    if (!activeCategory || !renameValue.trim()) return;
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/categories/${activeCategory.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, name: renameValue.trim() }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Could not rename that folder."); return; }
    setCategories((current) => current.map((category) => category.id === activeCategory.id ? { ...category, ...result.category } : category));
    setEvidence((current) => current.map((item) => ({ ...item, categories: item.categories.map((category) => category.id === activeCategory.id ? { ...category, name: result.category.name, slug: result.category.slug } : category) })));
    setMode(null); setRenameValue(""); router.refresh();
  }

  async function mergeFolder() {
    if (!activeCategory || !mergeTarget) return;
    setBusy(true); setMessage(null);
    const response = await fetch("/api/categories/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, sourceId: activeCategory.id, targetId: mergeTarget }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Could not merge those folders."); return; }
    const target = categories.find((category) => category.id === mergeTarget)!;
    setEvidence((current) => current.map((item) => item.categories.some((category) => category.id === activeCategory.id)
      ? { ...item, categories: [{ ...(item.categories[0] ?? { documentType: "Record", tags: [], confidence: null }), id: target.id, name: target.name, slug: target.slug }] }
      : item));
    setCategories((current) => current.filter((category) => category.id !== activeCategory.id).map((category) => category.id === target.id ? { ...category, evidenceCount: category.evidenceCount + activeCategory.evidenceCount } : category));
    setActiveId(target.id); setMode(null); setMergeTarget(""); router.refresh();
  }

  async function deleteFolder() {
    if (!activeCategory) return;
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/categories/${activeCategory.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Could not delete that folder."); return; }
    setEvidence((current) => current.map((item) => ({ ...item, categories: item.categories.filter((category) => category.id !== activeCategory.id) })));
    setCategories((current) => current.filter((category) => category.id !== activeCategory.id));
    setActiveId("unfiled"); setMode(null); router.refresh();
  }

  async function moveEvidence(item: EvidenceDTO, categoryId: string) {
    const target = categories.find((category) => category.id === categoryId);
    if (!target) return;
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/evidence/${item.id}/category`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, categoryId }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Could not move that record."); return; }
    const filing = item.categories[0];
    setEvidence((current) => current.map((record) => record.id === item.id ? { ...record, categories: [{ id: target.id, name: target.name, slug: target.slug, documentType: filing?.documentType ?? "Record", tags: filing?.tags ?? [], confidence: filing?.confidence ?? null }] } : record));
    setCategories((current) => current.map((category) => category.id === target.id ? { ...category, evidenceCount: category.evidenceCount + (filing?.id === target.id ? 0 : 1) } : filing && category.id === filing.id ? { ...category, evidenceCount: Math.max(0, category.evidenceCount - 1) } : category));
    setMessage(`Moved to ${target.name}. Klio will remember this correction.`);
    router.refresh();
  }

  async function organizeUnfiled() {
    if (!unfiled.length) return;
    setBusy(true); setMessage(null);
    const response = await fetch("/api/agent/jobs/bulk-organize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, evidenceIds: unfiled.map((item) => item.id) }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Could not organize those records."); return; }
    setMessage(`${result.queued} ${result.queued === 1 ? "record is" : "records are"} queued for organization. You can leave this page.`);
    router.refresh();
  }

  return (
    <div className="records-browser organization-browser">
      <nav className="folder-rail" aria-label="Evidence folders">
        {categories.map((category) => <button className={activeId === category.id ? "active" : ""} onClick={() => { setActiveId(category.id); setMode(null); }} key={category.id}><Folder size={14} /><span>{category.name}</span><b>{category.evidenceCount}</b></button>)}
        <button className={activeId === "unfiled" ? "active" : ""} onClick={() => { setActiveId("unfiled"); setMode(null); }}><Folder size={14} /><span>Unfiled</span><b>{unfiled.length}</b></button>
      </nav>
      <div className="folder-contents">
        <section className="folder-section active-folder-section">
          <header><FolderOpen size={17} /><div><h3>{activeCategory?.name ?? "Unfiled"}</h3><p>{activeCategory?.description ?? "Saved records Klio has not organized yet."}</p></div><span>{visibleEvidence.length}</span>{activeCategory ? <button className="folder-more" onClick={() => setMode(mode ? null : "rename")} aria-label="Folder actions"><MoreHorizontal size={17} /></button> : null}</header>
          {activeCategory && mode ? <div className="folder-action-panel">
            <div className="folder-action-tabs"><button className={mode === "rename" ? "active" : ""} onClick={() => setMode("rename")}>Rename</button><button className={mode === "merge" ? "active" : ""} onClick={() => setMode("merge")}>Merge</button><button className={mode === "delete" ? "active danger" : "danger"} onClick={() => setMode("delete")}>Delete</button><button onClick={() => setMode(null)} aria-label="Close folder actions"><X size={14} /></button></div>
            {mode === "rename" ? <div className="inline-folder-form"><label>Folder name<input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder={activeCategory.name} /></label><button onClick={renameFolder} disabled={busy || !renameValue.trim()}>Save name</button></div> : null}
            {mode === "merge" ? <div className="inline-folder-form"><label>Merge into<select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Choose a folder</option>{categories.filter((category) => category.id !== activeCategory.id).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><button onClick={mergeFolder} disabled={busy || !mergeTarget}>Merge records</button></div> : null}
            {mode === "delete" ? <div className="inline-folder-form delete-confirm"><p>Records will become unfiled. Their original files stay safe.</p><button onClick={deleteFolder} disabled={busy}>Delete folder</button></div> : null}
          </div> : null}
          {!activeCategory && unfiled.length ? <button className="bulk-organize-button" onClick={organizeUnfiled} disabled={busy}><Sparkles size={14} /> Organize all {unfiled.length}</button> : null}
          {message ? <p className="organization-message" role="status">{message}</p> : null}
          {busy ? <p className="organization-working"><LoaderCircle className="spin" size={14} /> Updating records…</p> : null}
          {visibleEvidence.length ? visibleEvidence.map((item) => <div className="archive-row organization-row" key={item.id}><FileText size={15} /><div><strong>{item.title || item.rawText?.slice(0, 70) || item.kind}</strong><span>{new Date(item.sourceAt).toLocaleDateString()} · {item.categories[0]?.documentType ?? item.kind}{item.categories[0]?.tags.length ? ` · ${item.categories[0].tags.slice(0, 3).join(" · ")}` : ""}</span></div><label>Move to<select value={item.categories[0]?.id ?? ""} onChange={(event) => moveEvidence(item, event.target.value)} disabled={busy}><option value="" disabled>Choose</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>{item.storagePath ? <a className="text-link" href={`/api/evidence/${item.id}/download`}>Original</a> : null}</div>) : <p className="section-empty">No records in this folder.</p>}
        </section>
      </div>
    </div>
  );
}
