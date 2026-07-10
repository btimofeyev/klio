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
  { value: "understand", label: "Organize & understand" },
  { value: "next_step", label: "What next?" },
  { value: "weekly_plan", label: "Plan the week" },
  { value: "lesson", label: "Create a lesson" },
  { value: "practice", label: "Create practice" },
  { value: "summary", label: "Summarize records" },
] as const;

type IntentValue = (typeof intents)[number]["value"];

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
  const [files, setFiles] = useState<File[]>([]);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [captureKind, setCaptureKind] = useState<"note" | "grade" | "book" | "activity">("note");
  const [busy, setBusy] = useState(false);
  const [captureIntents, setCaptureIntents] = useState<IntentValue[]>(["understand"]);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedCount = selected.length;
  const today = useMemo(() => new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()), []);

  async function submitCapture() {
    if ((!text.trim() && !files.length) || !studentId) return;
    setBusy(true); setMessage(null);
    const body = new FormData();
    body.set("familyId", familyId);
    body.set("studentId", studentId);
    body.set("kind", captureKind);
    if (text.trim()) body.set("text", text.trim());
    files.forEach((file) => body.append("file", file));
    setCaptureStatus("Saving your record…");
    const response = await fetch("/api/evidence", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) { setBusy(false); setCaptureStatus(null); setMessage(result.error ?? "Klio could not save that capture."); return; }
    const evidenceIds: string[] = result.ids ?? [result.id];
    setText(""); setFiles([]); setCaptureKind("note"); setSelected(evidenceIds); setAgentOpen(false);
    setCaptureStatus(`Klio is organizing this and running ${captureIntents.length} ${captureIntents.length === 1 ? "action" : "actions"}…`);
    router.refresh();

    const outcomes = await Promise.allSettled(captureIntents.map((intent) => requestAgent(intent, evidenceIds)));
    const completed = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const failed = outcomes.length - completed.length;
    const firstResult = completed[0]?.status === "fulfilled" ? completed[0].value : null;
    setBusy(false); setCaptureStatus(null);
    if (completed.length) {
      setSelected([]);
      setMessage(`${firstResult?.categoryName ? `Filed in ${firstResult.categoryName}. ` : ""}${completed.length} Klio ${completed.length === 1 ? "draft is" : "drafts are"} ready to review${failed ? `; ${failed} could not be completed` : ""}.`);
    } else {
      setMessage("Your record is safe, but Klio could not organize it yet. Select it below to try again.");
    }
    router.refresh();
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
        addFiles([new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type })]);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.current = mediaRecorder; mediaRecorder.start(); setRecording(true);
    } catch { setMessage("Microphone access is needed to record a voice note."); }
  }

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length) return;
    setFiles((current) => {
      const available = Math.max(0, 10 - current.length);
      if (incoming.length > available) setMessage("You can attach up to 10 files at once.");
      else setMessage(null);
      return [...current, ...incoming.slice(0, available)];
    });
  }

  function pasteScreenshot(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((image): image is File => Boolean(image));
    if (!images.length) return;

    event.preventDefault();
    const timestamp = Date.now();
    addFiles(images.map((image, index) => {
      const extension = image.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return new File([image], `screenshot-${timestamp}-${index + 1}.${extension}`, { type: image.type });
    }));
  }

  async function runAgent(intent: string) {
    if (!selected.length) return;
    setAgentBusy(true); setMessage(null);
    try {
      await requestAgent(intent as IntentValue, selected);
      setAgentOpen(false); setSelected([]); router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Klio agent could not complete that.");
    } finally {
      setAgentBusy(false);
    }
  }

  async function requestAgent(intent: IntentValue, evidenceIds: string[]) {
    const response = await fetch("/api/agent", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyId, studentId, evidenceIds, intent }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "The Klio agent could not complete that.");
    return result as { artifactId: string; categoryName?: string };
  }

  function toggleCaptureIntent(intent: IntentValue) {
    setCaptureIntents((current) => {
      if (current.includes(intent)) {
        if (current.length === 1) { setMessage("Keep at least one Klio action selected so the record can be organized."); return current; }
        setMessage(null);
        return current.filter((value) => value !== intent);
      }
      if (current.length >= 3) { setMessage("Choose up to three actions for one capture."); return current; }
      setMessage(null);
      return [...current, intent];
    });
  }

  return (
    <div className="inbox-page">
      <header className="workspace-header">
        <div><p className="eyebrow">{today}</p><h1>What happened today?</h1></div>
        <p>{familyName}</p>
      </header>

      <section
        className={`drop-composer ${files.length ? "has-file" : ""}`}
        onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }}
        onDragLeave={(event) => event.currentTarget.classList.remove("dragging")}
        onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); addFiles(event.dataTransfer.files); }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={pasteScreenshot}
          placeholder="Drop in a note, a question, or something you noticed…"
          aria-describedby="composer-paste-hint"
          rows={4}
        />
        <AnimatePresence>
          {files.map((file, index) => (
            <motion.div key={`${file.name}-${file.size}-${index}`} className="attached-file" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {file.type.startsWith("image/") ? <ImageIcon size={17} /> : file.type.startsWith("audio/") ? <Volume2 size={17} /> : <FileText size={17} />}
              <span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
              <button onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remove ${file.name}`}><X size={15} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="composer-actions">
          <div className="composer-actions-intro">
            <Sparkles size={15} />
            <span><strong>What should Klio do?</strong><small>Choose up to 3. Klio will also file this into the right folder.</small></span>
          </div>
          <div className="composer-action-options" role="group" aria-label="Actions to run after capture">
            {intents.map((intent) => (
              <button
                type="button"
                key={intent.value}
                className={captureIntents.includes(intent.value) ? "active" : ""}
                aria-pressed={captureIntents.includes(intent.value)}
                disabled={busy}
                onClick={() => toggleCaptureIntent(intent.value)}
              >
                {captureIntents.includes(intent.value) ? <Check size={12} /> : null}{intent.label}
              </button>
            ))}
          </div>
          {captureStatus ? <p className="capture-status"><LoaderCircle className="spin" size={14} />{captureStatus}</p> : null}
        </div>
        <div className="composer-footer">
          <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <div className="composer-tools">
            <button onClick={() => fileInput.current?.click()} title="Attach a photo or file"><Paperclip size={18} /></button>
            <button onClick={() => fileInput.current?.click()} title="Add a photo"><Camera size={18} /></button>
            <button className={recording ? "recording" : ""} onClick={toggleRecording} title="Record a voice note">
              {recording ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
            </button>
            <span id="composer-paste-hint" className="sr-only">You can paste a screenshot here.</span>
          </div>
          <select value={studentId} onChange={(event) => setStudentId(event.target.value)} aria-label="Learner">
            {students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}
          </select>
          <select value={captureKind} onChange={(event) => setCaptureKind(event.target.value as typeof captureKind)} aria-label="Capture type">
            <option value="note">Note</option><option value="grade">Grade</option><option value="book">Book</option><option value="activity">Activity</option>
          </select>
          <button className="capture-submit" onClick={submitCapture} disabled={busy || (!text.trim() && !files.length)} title={`Save and run ${captureIntents.length} Klio ${captureIntents.length === 1 ? "action" : "actions"}`}>
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
                      <small>{item.categories[0] ? `${item.categories[0].name} / ${item.categories[0].documentType ?? kindLabel(item.kind)}` : kindLabel(item.kind)} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</small>
                      {item.categories[0]?.tags.length ? <span className="evidence-tags">{item.categories[0].tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}</span> : null}
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
