"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle } from "lucide-react";
import type { CategoryDTO, EvidenceDTO, StudentDTO } from "@/lib/data/workspace";

export function HelpFilingQueue({ familyId, categories, initialItems, students }: { familyId: string; categories: CategoryDTO[]; initialItems: EvidenceDTO[]; students: StudentDTO[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [activeId, setActiveId] = useState(initialItems[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [learnerIds, setLearnerIds] = useState<Record<string, string>>({});
  const names = new Map(students.map((student) => [student.id, student.displayName]));
  const folders = filingChoices(categories);

  async function file(item: EvidenceDTO, category: { id?: string; name: string }) {
    const targetStudentId = learnerIds[item.id] ?? item.studentIds[0];
    const targets = item.captureSubmissionId ? items.filter((current) => current.captureSubmissionId === item.captureSubmissionId) : [item];
    setBusy(item.id); setError(null);
    const responses = await Promise.all(targets.map((target) => fetch(`/api/evidence/${target.id}/category`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, studentId: targetStudentId, ...(category.id ? { categoryId: category.id } : { categoryName: category.name }) }) })));
    setBusy(null);
    if (responses.some((response) => !response.ok)) { setError("Klio could not file that item. Try again."); return; }
    const targetIds = new Set(targets.map((target) => target.id));
    const remaining = items.filter((current) => !targetIds.has(current.id));
    setItems(remaining); setActiveId(remaining[0]?.id ?? null); router.refresh();
  }

  if (!items.length) return null;
  return <section className="help-filing-queue"><header><div><p className="eyebrow">Needs a folder</p><h2>{items.length} {items.length === 1 ? "capture" : "captures"} to file</h2></div><span>One tap is enough.</span></header>{error ? <p className="help-filing-error" role="alert">{error}</p> : null}<div>{items.map((item) => {
    const active = activeId === item.id;
    const batchSize = item.captureSubmissionId ? items.filter((current) => current.captureSubmissionId === item.captureSubmissionId).length : 1;
    const learnerId = learnerIds[item.id] ?? item.studentIds[0] ?? "";
    return <article className={active ? "active" : ""} key={item.id}><div className="help-filing-row"><span><FileText size={15} /></span><div><strong>{item.title || item.rawText?.slice(0, 90) || "Learning capture"}</strong><small>{names.get(item.studentIds[0]) ?? "Family"} · {kindLabel(item.kind)}</small></div>{!active ? <button type="button" onClick={() => setActiveId(item.id)}>File</button> : null}</div>{active ? <div className="help-folder-choices"><div className="filing-question-head"><p>{batchSize > 1 ? `Where should these ${batchSize} files go?` : "Where should this go?"}</p><label><span>Learner</span><select value={learnerId} onChange={(event) => setLearnerIds((current) => ({ ...current, [item.id]: event.target.value }))}>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div><div>{folders.map((category) => <button type="button" disabled={busy === item.id} onClick={() => file(item, category)} key={category.name}>{busy === item.id ? <LoaderCircle className="spin" size={12} /> : null}{category.name}</button>)}</div>{batchSize > 1 ? <small>One choice updates the whole upload.</small> : null}</div> : null}</article>;
  })}</div></section>;
}

function filingChoices(categories: CategoryDTO[]) {
  const preferred = ["English", "Reading", "Writing", "Math", "Science", "History", "Arts", "Life Skills", "Other"];
  const visibleCategories = categories.filter((category) => category.name.toLowerCase() !== "general");
  return [...visibleCategories, ...preferred.filter((name) => !visibleCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())).map((name) => ({ name }))]
    .sort((a, b) => choiceRank(a.name, preferred) - choiceRank(b.name, preferred) || a.name.localeCompare(b.name));
}
function choiceRank(name: string, preferred: string[]) { const index = preferred.findIndex((item) => item.toLowerCase() === name.toLowerCase()); return index === -1 ? 50 : index; }
function kindLabel(kind: string) { return ({ photo: "Photo", voice: "Voice note", document: "File", note: "Note", book: "Book", activity: "Activity" } as Record<string,string>)[kind] ?? kind.replaceAll("_", " "); }
