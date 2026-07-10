"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp, BookOpen, Camera, Check, FileText, Image as ImageIcon, LoaderCircle,
  Mic, Paperclip, Sparkles, Square, Volume2, X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ArtifactDTO, EvidenceDTO, StudentDTO } from "@/lib/data/workspace";

const intents = [
  { value: "understand", label: "Understand this" },
  { value: "next_step", label: "What next?" },
  { value: "weekly_plan", label: "Plan the week" },
  { value: "lesson", label: "Create a lesson" },
  { value: "practice", label: "Create practice" },
  { value: "summary", label: "Summarize records" },
] as const;

export function InboxWorkspace({
  familyId, familyName, students, initialEvidence, initialArtifacts,
}: {
  familyId: string;
  familyName: string;
  students: StudentDTO[];
  initialEvidence: EvidenceDTO[];
  initialArtifacts: ArtifactDTO[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [captureKind, setCaptureKind] = useState<"note" | "grade" | "book" | "activity">("note");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedCount = selected.length;
  const today = useMemo(() => new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()), []);

  async function submitCapture() {
    if ((!text.trim() && !file) || !studentId) return;
    setBusy(true); setMessage(null);
    const body = new FormData();
    body.set("familyId", familyId);
    body.set("studentId", studentId);
    body.set("kind", captureKind);
    if (text.trim()) body.set("text", text.trim());
    if (file) body.set("file", file);
    const response = await fetch("/api/evidence", { method: "POST", body });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error ?? "Klio could not save that capture."); return; }
    setText(""); setFile(null); setCaptureKind("note"); setSelected([result.id]); setAgentOpen(true); router.refresh();
  }

  async function toggleRecording() {
    if (recording) { recorder.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => chunks.current.push(event.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        setFile(new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type }));
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.current = mediaRecorder; mediaRecorder.start(); setRecording(true);
    } catch { setMessage("Microphone access is needed to record a voice note."); }
  }

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files)[0];
    if (next) setFile(next);
  }

  async function runAgent(intent: string) {
    if (!selected.length) return;
    setAgentBusy(true); setMessage(null);
    const response = await fetch("/api/agent", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyId, studentId, evidenceIds: selected, intent }),
    });
    const result = await response.json();
    setAgentBusy(false);
    if (!response.ok) { setMessage(result.error ?? "The Klio agent could not complete that."); return; }
    setAgentOpen(false); setSelected([]); router.refresh();
  }

  return (
    <div className="inbox-page">
      <header className="workspace-header">
        <div><p className="eyebrow">{today}</p><h1>What happened today?</h1></div>
        <p>{familyName}</p>
      </header>

      <section
        className={`drop-composer ${file ? "has-file" : ""}`}
        onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }}
        onDragLeave={(event) => event.currentTarget.classList.remove("dragging")}
        onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); addFiles(event.dataTransfer.files); }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Drop in a note, a question, or something you noticed…"
          rows={4}
        />
        <AnimatePresence>
          {file ? (
            <motion.div className="attached-file" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {file.type.startsWith("image/") ? <ImageIcon size={17} /> : file.type.startsWith("audio/") ? <Volume2 size={17} /> : <FileText size={17} />}
              <span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
              <button onClick={() => setFile(null)} aria-label="Remove attachment"><X size={15} /></button>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="composer-footer">
          <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => event.target.files && addFiles(event.target.files)} />
          <div className="composer-tools">
            <button onClick={() => fileInput.current?.click()} title="Attach a photo or file"><Paperclip size={18} /></button>
            <button onClick={() => fileInput.current?.click()} title="Add a photo"><Camera size={18} /></button>
            <button className={recording ? "recording" : ""} onClick={toggleRecording} title="Record a voice note">
              {recording ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
            </button>
          </div>
          <select value={studentId} onChange={(event) => setStudentId(event.target.value)} aria-label="Learner">
            {students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}
          </select>
          <select value={captureKind} onChange={(event) => setCaptureKind(event.target.value as typeof captureKind)} aria-label="Capture type">
            <option value="note">Note</option><option value="grade">Grade</option><option value="book">Book</option><option value="activity">Activity</option>
          </select>
          <button className="capture-submit" onClick={submitCapture} disabled={busy || (!text.trim() && !file)}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={18} />}
          </button>
        </div>
      </section>
      {message ? <p className="workspace-message" role="alert">{message}</p> : null}

      <div className="inbox-columns">
        <section className="inbox-stream">
          <div className="section-heading"><h2>Inbox</h2><span>{initialEvidence.length} captured</span></div>
          {initialEvidence.length ? (
            <div className="evidence-list">
              {initialEvidence.map((item) => {
                const checked = selected.includes(item.id);
                return (
                  <button key={item.id} className={`evidence-row ${checked ? "selected" : ""}`} onClick={() => setSelected((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id])}>
                    <span className="evidence-check">{checked ? <Check size={14} /> : kindIcon(item.kind)}</span>
                    <span className="evidence-copy">
                      <strong>{item.title || item.rawText?.slice(0, 84) || kindLabel(item.kind)}</strong>
                      <small>{kindLabel(item.kind)} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</small>
                    </span>
                    <span className={`status-dot status-${item.status}`} title={item.status} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-state"><BookOpen size={25} /><p>Your inbox is ready.</p><span>Add the first piece of your homeschool day above.</span></div>
          )}
        </section>

        <aside className="artifact-rail">
          <div className="section-heading"><h2>Made by Klio</h2><span>Review before it becomes part of the record</span></div>
          {initialArtifacts.length ? initialArtifacts.slice(0, 5).map((artifact) => (
            <a href={`/app/artifacts/${artifact.id}`} className="artifact-row" key={artifact.id}>
              <span><Sparkles size={15} /></span><div><strong>{artifact.title}</strong><small>{artifact.type.replaceAll("_", " ")} · {artifact.status}</small></div>
            </a>
          )) : <p className="rail-empty">Select an inbox item and ask Klio to make something useful.</p>}
        </aside>
      </div>

      <AnimatePresence>
        {selectedCount > 0 ? (
          <motion.div className="agent-dock" initial={{ opacity: 0, y: 30, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 20, x: "-50%" }}>
            <button className="selection-count" onClick={() => setSelected([])}>{selectedCount} selected <X size={14} /></button>
            <button className="ask-klio" onClick={() => setAgentOpen(!agentOpen)}><Sparkles size={16} /> Use Klio</button>
            <AnimatePresence>
              {agentOpen ? (
                <motion.div className="intent-menu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                  <p>What should Klio do?</p>
                  {intents.map((intent) => <button key={intent.value} onClick={() => runAgent(intent.value)} disabled={agentBusy}>{intent.label}<ArrowUp size={14} /></button>)}
                </motion.div>
              ) : null}
            </AnimatePresence>
            {agentBusy ? <span className="agent-working"><LoaderCircle className="spin" size={15} /> Working…</span> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function kindIcon(kind: string) {
  if (kind === "photo") return <ImageIcon size={15} />;
  if (kind === "voice") return <Mic size={15} />;
  if (kind === "document" || kind === "csv_import") return <FileText size={15} />;
  return <BookOpen size={15} />;
}

function kindLabel(kind: string) {
  return ({ photo: "Photo", voice: "Voice note", document: "Document", note: "Note", csv_import: "CSV import" } as Record<string, string>)[kind] ?? kind.replaceAll("_", " ");
}
