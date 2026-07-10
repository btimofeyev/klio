"use client";

import { useRef, useState } from "react";
import { Check, FileUp, LoaderCircle } from "lucide-react";
import type { StudentDTO } from "@/lib/data/workspace";

type Preview = { importId: string; headers: string[]; rows: Record<string, string>[]; totalRows: number };

export function GradeImport({ familyId, students }: { familyId: string; students: StudentDTO[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState({ title: "", subject: "", score: "", date: "" });
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");

  async function upload(file: File) {
    setBusy(true); setError(null);
    const body = new FormData(); body.set("file", file); body.set("familyId", familyId);
    const response = await fetch("/api/import/preview", { method: "POST", body });
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setError(data.error ?? "Could not preview this file.");
    setPreview(data);
    setMapping({ title: guess(data.headers, ["assignment", "title", "name"]), subject: guess(data.headers, ["subject", "course", "class"]), score: guess(data.headers, ["score", "grade", "percent"]), date: guess(data.headers, ["date", "completed", "submitted"]) });
  }

  async function confirm() {
    if (!preview || !mapping.score || !studentId) return;
    setBusy(true); setError(null);
    const response = await fetch("/api/import/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, importId: preview.importId, studentId, mapping }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setError(data.error ?? "Could not confirm this import.");
    setDone(data.created);
  }

  if (done !== null) return <div className="import-success"><Check size={28} /><h2>Import complete</h2><p>{done} grade records were added as evidence.</p><a className="primary-button" href="/app/records">View records</a></div>;
  return <section className="import-workspace">
    {!preview ? <button className="csv-drop" onClick={() => input.current?.click()}><input ref={input} hidden type="file" accept="text/csv,.csv" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />{busy ? <LoaderCircle className="spin" size={28} /> : <FileUp size={28} />}<strong>Choose a grade CSV</strong><span>The original file stays in private family storage.</span></button> : <>
      <div className="mapping-grid"><div className="field"><label>Learner</label><select value={studentId} onChange={(e) => setStudentId(e.target.value)}>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></div>{(["title", "subject", "score", "date"] as const).map((key) => <div className="field" key={key}><label>{key === "score" ? "Score / grade *" : key}</label><select value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}><option value="">Not mapped</option>{preview.headers.map((header) => <option key={header}>{header}</option>)}</select></div>)}</div>
      <div className="csv-preview"><header><strong>Preview</strong><span>{preview.totalRows} rows</span></header><div className="table-scroll"><table><thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index}>{preview.headers.map((header) => <td key={header}>{row[header]}</td>)}</tr>)}</tbody></table></div></div>
      <button className="primary-button" onClick={confirm} aria-disabled={busy || !mapping.score}>{busy ? <LoaderCircle className="spin" size={17} /> : <>Confirm {preview.totalRows} records <Check size={16} /></>}</button>
    </>}
    {error ? <p className="form-error">{error}</p> : null}
  </section>;
}

function guess(headers: string[], candidates: string[]) { return headers.find((header) => candidates.some((candidate) => header.toLowerCase().includes(candidate))) ?? ""; }
