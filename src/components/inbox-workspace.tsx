"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp, BookOpen, CalendarDays, Camera, Check, ChevronLeft, ChevronRight,
  FileText, Image as ImageIcon, Link2, LoaderCircle, Mic, Square,
  Upload, Volume2, X,
} from "lucide-react";
import type { AgentJobDTO, ArtifactDTO, EvidenceDTO, ReminderDTO, StudentDTO } from "@/lib/data/workspace";

type Props = {
  familyId: string;
  familyName: string;
  students: StudentDTO[];
  initialEvidence: EvidenceDTO[];
  initialArtifacts: ArtifactDTO[];
  initialJobs: AgentJobDTO[];
  initialReminders: ReminderDTO[];
};

type RecentFilter = "today" | "week" | "review" | "recent";

export function InboxWorkspace({ familyId, students, initialEvidence, initialArtifacts, initialReminders }: Props) {
  const router = useRouter();
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recentFilter, setRecentFilter] = useState<RecentFilter>("today");
  const [contextOpen, setContextOpen] = useState(true);
  const [reminders, setReminders] = useState(initialReminders);
  const [now] = useState(() => new Date());

  const learner = students.find((student) => student.id === studentId) ?? students[0];
  const learnerEvidence = initialEvidence.filter((item) => item.studentIds.includes(studentId));
  const visibleEvidence = learnerEvidence.filter((item) => {
    const created = new Date(item.createdAt);
    const age = now.getTime() - created.getTime();
    if (recentFilter === "today") return created.toDateString() === now.toDateString();
    if (recentFilter === "week") return age < 7 * 24 * 60 * 60 * 1000;
    if (recentFilter === "review") return item.status === "needs_review" || item.status === "failed";
    return true;
  }).slice(0, 5);
  const pending = reminders.filter((item) => item.status === "pending" && (!item.studentId || item.studentId === studentId));
  const scheduled = pending.filter((item) => item.dueAt).sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
  const latestPlan = initialArtifacts.find((artifact) => artifact.type === "weekly_plan" && (!artifact.studentId || artifact.studentId === studentId));
  const currentFocus = learnerEvidence.find((item) => item.categories[0])?.categories[0]?.name ?? "Building a learning rhythm";
  const captureText = [text.trim(), linkUrl.trim() ? `Link: ${linkUrl.trim()}` : ""].filter(Boolean).join("\n");

  async function submitCapture() {
    if ((!captureText && !files.length) || !studentId || busy) return;
    setBusy(true); setMessage(null);
    const body = new FormData();
    body.set("familyId", familyId); body.set("studentId", studentId); body.set("kind", "note");
    body.set("intents", JSON.stringify(["understand"]));
    if (captureText) body.set("text", captureText);
    files.forEach((file) => body.append("file", file));
    try {
      const response = await fetch("/api/evidence", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error ?? "Klio could not save that capture."); return; }
      setText(""); setLinkUrl(""); setLinkOpen(false); setFiles([]);
      setMessage("Saved. Klio is organizing it in the background.");
      router.refresh();
    } catch { setMessage("Klio could not save that capture. Try again."); }
    finally { setBusy(false); }
  }

  function addFiles(values: FileList | File[]) {
    const incoming = Array.from(values); if (!incoming.length) return;
    setFiles((current) => {
      const available = Math.max(0, 10 - current.length);
      if (incoming.length > available) setMessage("You can attach up to 10 files at once.");
      return [...current, ...incoming.slice(0, available)];
    });
  }

  function pasteImages(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!images.length) return;
    event.preventDefault();
    const timestamp = Date.now();
    addFiles(images.map((image, index) => new File([image], `screenshot-${timestamp}-${index + 1}.${image.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`, { type: image.type })));
  }

  async function toggleRecording() {
    if (recording) { recorder.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream); chunks.current = [];
      mediaRecorder.ondataavailable = (event) => chunks.current.push(event.data);
      mediaRecorder.onstop = () => { const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" }); addFiles([new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type })]); stream.getTracks().forEach((track) => track.stop()); };
      recorder.current = mediaRecorder; mediaRecorder.start(); setRecording(true);
    } catch { setMessage("Microphone access is needed to record a voice note."); }
  }

  async function completeReminder(id: string) {
    const previous = reminders;
    setReminders((current) => current.map((item) => item.id === id ? { ...item, status: "completed" } : item));
    const response = await fetch(`/api/reminders/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
    if (!response.ok) { setReminders(previous); setMessage("Klio could not update that reminder."); }
  }

  return (
    <div className={`home-command ${contextOpen ? "context-open" : "context-closed"}`}>
      <main className="home-command-main">
        <header className="home-command-header"><div><strong>Home</strong><span>{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(now)}</span></div><select value={studentId} onChange={(event) => setStudentId(event.target.value)} aria-label="Selected learner">{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></header>

        <section className="universal-capture" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }} onDragLeave={(event) => event.currentTarget.classList.remove("dragging")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); addFiles(event.dataTransfer.files); }}>
          <textarea value={text} onChange={(event) => setText(event.target.value)} onPaste={pasteImages} placeholder="What happened in learning today?" aria-label="What happened in learning today?" />
          <div className="universal-attachments"><AnimatePresence>{files.map((file, index) => <motion.div layout key={`${file.name}-${file.size}-${index}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><span>{file.type.startsWith("image/") ? <ImageIcon size={14} /> : file.type.startsWith("audio/") ? <Volume2 size={14} /> : <FileText size={14} />}{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small><button onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></motion.div>)}</AnimatePresence></div>
          <AnimatePresence>{linkOpen ? <motion.label className="capture-link-field" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Link2 size={15} /><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="Paste a link…" type="url" autoFocus /><button onClick={() => { setLinkOpen(false); setLinkUrl(""); }} aria-label="Remove link"><X size={14} /></button></motion.label> : null}</AnimatePresence>
          <footer>
            <input ref={imageInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
            <input ref={fileInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
            <div className="universal-tools"><button onClick={() => imageInput.current?.click()}><Camera size={17} />Photo</button><button className={recording ? "recording" : ""} onClick={toggleRecording}>{recording ? <Square size={14} fill="currentColor" /> : <Mic size={17} />}{recording ? "Stop" : "Voice"}</button><button onClick={() => fileInput.current?.click()}><Upload size={17} />Files</button><button onClick={() => setLinkOpen((open) => !open)}><Link2 size={17} />Link</button></div>
            <button className="universal-save" aria-label="Save to Klio" onClick={submitCapture} disabled={busy || (!captureText && !files.length)}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={18} />}</button>
          </footer>
        </section>
        {message ? <p className="home-message" role="status">{message}</p> : null}

        <section className="recent-workspace">
          <nav aria-label="Recent work filters">{([['today','Today'],['week','This week'],['review','Needs your attention'],['recent','All recent']] as const).map(([value,label]) => <button className={recentFilter === value ? "active" : ""} key={value} onClick={() => setRecentFilter(value)}>{label}{value === "review" && learnerEvidence.some((item) => item.status === "needs_review") ? <i /> : null}</button>)}</nav>
          <div className="recent-heading"><span>{visibleEvidence.length} items</span><Link href="/app/records">See all work <ChevronRight size={14} /></Link></div>
          {visibleEvidence.length ? <div className="home-evidence-list">{visibleEvidence.map((item) => <Link href="/app/records" key={item.id}><span>{evidenceIcon(item.kind)}</span><div><strong>{item.title || item.rawText?.slice(0, 78) || kindLabel(item.kind)}</strong><small>{item.categories[0]?.name ?? kindLabel(item.kind)} · {relativeDay(item.createdAt)}</small></div><ChevronRight size={14} /></Link>)}</div> : <div className="home-recent-empty"><BookOpen size={20} /><span>No work in this view yet.</span></div>}
        </section>
      </main>

      <aside className="learner-context">
        <button className="context-toggle" onClick={() => setContextOpen((open) => !open)} aria-label={contextOpen ? "Collapse learner context" : "Open learner context"}>{contextOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
        {contextOpen ? <><header><span>{learner?.displayName.charAt(0) ?? "K"}</span><div><small>Learner overview</small><select value={studentId} onChange={(event) => setStudentId(event.target.value)} aria-label="Learner overview">{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select><p>{learner?.gradeBand ?? "Learning profile"}</p></div></header>
          <section><label>Current focus</label><strong>{currentFocus}</strong><p>{learner?.learningPreferences ?? "Klio will surface patterns as you capture learning."}</p></section>
          <section><div className="context-section-title"><label>Reminders</label><span>{pending.length}</span></div>{pending.length ? pending.slice(0, 4).map((item) => <div className="context-reminder" key={item.id}><button onClick={() => completeReminder(item.id)} aria-label={`Complete ${item.title}`}><Check size={12} /></button><div><strong>{item.title}</strong><small>{item.dueAt ? formatDue(item.dueAt) : "No due date"}</small></div></div>) : <p className="context-empty">Nothing waiting.</p>}</section>
          <section><div className="context-section-title"><label>Schedule</label><Link href="/app/plans">Plans</Link></div>{scheduled.length ? scheduled.slice(0, 3).map((item) => <div className="context-schedule" key={item.id}><CalendarDays size={15} /><div><strong>{item.title}</strong><small>{formatDue(item.dueAt!)}</small></div></div>) : latestPlan ? <Link className="context-schedule" href={`/app/artifacts/${latestPlan.id}`}><BookOpen size={15} /><div><strong>{latestPlan.title}</strong><small>Weekly plan</small></div></Link> : <p className="context-empty">Nothing scheduled.</p>}</section></> : null}
      </aside>
    </div>
  );
}

function evidenceIcon(kind: string) { if (kind === "photo") return <ImageIcon size={16} />; if (kind === "voice") return <Mic size={16} />; return <FileText size={16} />; }
function kindLabel(kind: string) { return ({ photo: "Photo", voice: "Voice note", document: "Document", note: "Note", grade: "Grade", book: "Book", activity: "Activity" } as Record<string,string>)[kind] ?? kind.replaceAll("_"," "); }
function relativeDay(value: string) { const date = new Date(value); const today = new Date(); if (date.toDateString() === today.toDateString()) return new Intl.DateTimeFormat("en",{hour:"numeric",minute:"2-digit"}).format(date); const yesterday = new Date(today); yesterday.setDate(today.getDate()-1); if (date.toDateString() === yesterday.toDateString()) return "Yesterday"; return new Intl.DateTimeFormat("en",{month:"short",day:"numeric"}).format(date); }
function formatDue(value: string) { const date = new Date(value); const today = new Date(); if (date.toDateString() === today.toDateString()) return `Today · ${new Intl.DateTimeFormat("en",{hour:"numeric",minute:"2-digit"}).format(date)}`; return new Intl.DateTimeFormat("en",{weekday:"short",month:"short",day:"numeric"}).format(date); }
