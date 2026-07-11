"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight, ArrowUp, Bell, BookOpen, Camera, Check, ChevronRight, FileText,
  Image as ImageIcon, Lightbulb, LoaderCircle, Mic, MoreHorizontal, Paperclip,
  Sparkles, Square, Upload, Volume2, X,
} from "lucide-react";
import type { AgentJobDTO, ArtifactDTO, EvidenceDTO, StudentDTO } from "@/lib/data/workspace";

const intents = [
  { value: "understand", label: "Organize & understand" },
  { value: "next_step", label: "What next?" },
  { value: "weekly_plan", label: "Plan the week" },
  { value: "lesson", label: "Create a lesson" },
  { value: "practice", label: "Create practice" },
  { value: "summary", label: "Summarize records" },
] as const;

type IntentValue = (typeof intents)[number]["value"];
type EvidenceFilter = "today" | "week" | "review" | "recent";

export function InboxWorkspace({
  familyId, familyName, students, initialEvidence, initialArtifacts, initialJobs,
}: {
  familyId: string;
  familyName: string;
  students: StudentDTO[];
  initialEvidence: EvidenceDTO[];
  initialArtifacts: ArtifactDTO[];
  initialJobs: AgentJobDTO[];
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
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("today");
  const [jobs, setJobs] = useState<AgentJobDTO[]>(initialJobs);

  const selectedCount = selected.length;
  const hasActiveJobs = jobs.some((job) => job.status === "queued" || job.status === "processing");
  const today = useMemo(() => new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()), []);
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, []);
  const selectedStudent = students.find((student) => student.id === studentId) ?? students[0];
  const activeJob = jobs.find((job) => job.status === "queued" || job.status === "processing");
  const visibleEvidence = initialEvidence.filter((item) => {
    const created = new Date(item.createdAt);
    const age = Date.now() - created.getTime();
    if (evidenceFilter === "today") return created.toDateString() === new Date().toDateString();
    if (evidenceFilter === "week") return age < 7 * 24 * 60 * 60 * 1000;
    if (evidenceFilter === "review") return item.status === "needs_review" || item.status === "failed";
    return true;
  });

  useEffect(() => {
    if (!hasActiveJobs) return;
    let cancelled = false;
    async function refreshJobs() {
      const response = await fetch(`/api/agent/jobs?familyId=${familyId}`, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const result = await response.json();
      const nextJobs = result.jobs as AgentJobDTO[];
      setJobs(nextJobs);
      if (!nextJobs.some((job) => job.status === "queued" || job.status === "processing")) router.refresh();
    }
    const interval = window.setInterval(refreshJobs, 1800);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [familyId, hasActiveJobs, router]);

  async function submitCapture() {
    if ((!text.trim() && !files.length) || !studentId) return;
    setBusy(true); setMessage(null);
    const body = new FormData();
    body.set("familyId", familyId);
    body.set("studentId", studentId);
    body.set("kind", captureKind);
    body.set("intents", JSON.stringify(captureIntents));
    if (text.trim()) body.set("text", text.trim());
    files.forEach((file) => body.append("file", file));
    setCaptureStatus("Saving your record…");
    const response = await fetch("/api/evidence", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) { setBusy(false); setCaptureStatus(null); setMessage(result.error ?? "Klio could not save that capture."); return; }
    setBusy(false); setCaptureStatus(null);
    setText(""); setFiles([]); setCaptureKind("note"); setSelected([]); setAgentOpen(false);
    setJobs((current) => [normalizeJob(result.job), ...current].slice(0, 12));
    setMessage("Saved. Klio is working in the background—you can keep capturing or leave this page.");
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
      const result = await requestAgent(intent as IntentValue, selected);
      setJobs((current) => [normalizeJob(result.job), ...current].slice(0, 12));
      setMessage("Queued. Klio will keep working if you leave this page.");
      setAgentOpen(false); setSelected([]);
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
    return result as { job: Record<string, unknown> };
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
      <main className="inbox-workbench">
        <header className="workspace-header">
          <div><h1>{greeting}</h1><p>{today}</p></div>
          <button className="notification-button" aria-label="Notifications"><Bell size={20} strokeWidth={1.6} /></button>
        </header>

        <section
          className={`drop-composer ${files.length ? "has-file" : ""}`}
          onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }}
          onDragLeave={(event) => event.currentTarget.classList.remove("dragging")}
          onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); addFiles(event.dataTransfer.files); }}
        >
          <div className="composer-paper">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={pasteScreenshot}
              placeholder="Drop in anything from today—work, a photo, a thought, an activity…"
              aria-describedby="composer-paste-hint"
              rows={4}
            />
            <AnimatePresence>
              {files.map((file, index) => (
                <motion.div layout key={`${file.name}-${file.size}-${index}`} className="attached-file" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .98 }}>
                  {file.type.startsWith("image/") ? <ImageIcon size={17} /> : file.type.startsWith("audio/") ? <Volume2 size={17} /> : <FileText size={17} />}
                  <span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                  <button onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remove ${file.name}`}><X size={15} /></button>
                </motion.div>
              ))}
            </AnimatePresence>
            <div className="composer-primary-actions">
              <select value={studentId} onChange={(event) => setStudentId(event.target.value)} aria-label="Learner">
                {students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}
              </select>
              <button className="capture-submit" onClick={submitCapture} disabled={busy || (!text.trim() && !files.length)}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <>Save <ArrowRight size={16} /></>}
              </button>
            </div>
          </div>

          <div className="composer-tools-row">
            <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
            <button onClick={() => fileInput.current?.click()}><Camera size={18} />Photo</button>
            <button className={recording ? "recording" : ""} onClick={toggleRecording}>{recording ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}Voice note</button>
            <button onClick={() => fileInput.current?.click()}><Paperclip size={18} />File</button>
            <button onClick={() => fileInput.current?.click()}><Upload size={18} />Import</button>
            <select value={captureKind} onChange={(event) => setCaptureKind(event.target.value as typeof captureKind)} aria-label="Capture type">
              <option value="note">Note</option><option value="grade">Grade</option><option value="book">Book</option><option value="activity">Activity</option>
            </select>
            <span id="composer-paste-hint" className="sr-only">You can paste up to ten screenshots here.</span>
          </div>

          <div className="composer-actions">
            <div className="composer-actions-intro"><Sparkles size={14} /><span><strong>After saving</strong><small>Choose up to three Klio actions</small></span></div>
            <div className="composer-action-options" role="group" aria-label="Actions to run after capture">
              {intents.map((intent) => <button type="button" key={intent.value} className={captureIntents.includes(intent.value) ? "active" : ""} aria-pressed={captureIntents.includes(intent.value)} disabled={busy} onClick={() => toggleCaptureIntent(intent.value)}>{captureIntents.includes(intent.value) ? <Check size={12} /> : null}{intent.label}</button>)}
            </div>
            {captureStatus ? <p className="capture-status"><LoaderCircle className="spin" size={14} />{captureStatus}</p> : null}
          </div>
        </section>
        {message ? <p className="workspace-message" role="alert">{message}</p> : null}

        <section className="inbox-stream">
          <div className="evidence-tabs" role="tablist" aria-label="Filter evidence">
            {([['today', 'Today'], ['week', 'This week'], ['review', 'Needs review'], ['recent', 'Recently added']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={evidenceFilter === value} className={evidenceFilter === value ? "active" : ""} onClick={() => setEvidenceFilter(value)}>{label}{value === "review" && initialEvidence.some((item) => item.status === "needs_review") ? <i /> : null}</button>)}
          </div>
          <div className="stream-label"><span>{evidenceFilter === "today" ? "Today" : evidenceFilter === "week" ? "This week" : evidenceFilter === "review" ? "Needs review" : "Recent records"}</span><small>{visibleEvidence.length} records</small></div>
          {visibleEvidence.length ? <motion.div className="evidence-list" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .045 } } }}>
            {visibleEvidence.map((item) => {
              const checked = selected.includes(item.id);
              return <motion.button variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} key={item.id} className={`evidence-row ${checked ? "selected" : ""}`} onClick={() => setSelected((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id])}>
                <time>{new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(item.createdAt))}</time>
                <span className={`evidence-thumb kind-${item.kind}`}>{checked ? <Check size={18} /> : kindIcon(item.kind)}</span>
                <span className="evidence-copy"><strong>{item.title || item.rawText?.slice(0, 84) || kindLabel(item.kind)}</strong>{item.rawText ? <span>{item.rawText.slice(0, 100)}</span> : null}<small>{item.categories[0]?.name ?? kindLabel(item.kind)}</small></span>
                <MoreHorizontal size={18} className="row-menu" />
              </motion.button>;
            })}
          </motion.div> : <div className="empty-state"><BookOpen size={24} /><p>Nothing here yet.</p><span>New records will appear here as you capture them.</span></div>}
        </section>
      </main>

      <aside className="learning-rail">
        <p className="rail-family">{familyName}</p>
        {activeJob ? <div className="rail-job"><LoaderCircle className="spin" size={14} /><span>{activeJob.status === "queued" ? "Klio is queued" : "Klio is working"}</span><small>{activeJob.completedActions + activeJob.failedActions} of {activeJob.totalActions} finished</small></div> : null}
        {jobs.length ? <div className="rail-job-history" aria-label="Recent Klio processing status" aria-live="polite">{jobs.slice(0, 3).map((job) => <div key={job.id} className={`job-${job.status}`}><span>{job.status === "queued" || job.status === "processing" ? <LoaderCircle className="spin" size={12} /> : job.status === "completed" ? <Check size={12} /> : <X size={12} />}</span><div><strong>{job.status === "processing" ? "Processing" : job.status === "partial" ? "Completed with an issue" : job.status}</strong><small>{job.actions.map((action) => actionLabel(action.intent)).join(" · ") || `${job.totalActions} actions`}</small></div><b>{job.completedActions + job.failedActions}/{job.totalActions}</b></div>)}</div> : null}
        <div className="rail-student"><span>{selectedStudent?.displayName.charAt(0) ?? "K"}</span><div><small>Learner</small><h2>{selectedStudent?.displayName ?? "Your learner"}</h2><p>{selectedStudent?.gradeBand ? `Grade ${selectedStudent.gradeBand}` : "Learning profile"}</p></div></div>
        <section><p className="rail-label">Current focus</p><div className="focus-note"><i /> <div><strong>{initialEvidence.find((item) => item.studentIds.includes(studentId))?.categories[0]?.name ?? "Building a learning rhythm"}</strong><p>{selectedStudent?.learningPreferences ?? "Capture a few moments this week and Klio will surface patterns here."}</p></div></div></section>
        <section><p className="rail-label">Suggested next step</p><div className="suggestion"><Lightbulb size={19} /><p>{initialArtifacts[0]?.summary ?? `Add one observation about ${selectedStudent?.displayName ?? "today"} and let Klio turn it into a useful next step.`}</p></div>{initialArtifacts[0] ? <a href={`/app/artifacts/${initialArtifacts[0].id}`}>View suggestion <ArrowRight size={14} /></a> : null}</section>
        <section><p className="rail-label">Made by Klio</p>{initialArtifacts.length ? initialArtifacts.slice(0, 4).map((artifact) => <a href={`/app/artifacts/${artifact.id}`} className="rail-artifact" key={artifact.id}><span><Sparkles size={14} /></span><div><strong>{artifact.title}</strong><small>{artifact.type.replaceAll("_", " ")} · {artifact.status}</small></div><ChevronRight size={14} /></a>) : <p className="rail-empty">Klio’s drafts and suggestions will collect here.</p>}</section>
      </aside>

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

function normalizeJob(job: Record<string, unknown>): AgentJobDTO {
  return {
    id: String(job.id),
    status: String(job.status),
    totalActions: Number(job.totalActions ?? job.total_actions ?? 0),
    completedActions: Number(job.completedActions ?? job.completed_actions ?? 0),
    failedActions: Number(job.failedActions ?? job.failed_actions ?? 0),
    errorMessage: (job.errorMessage ?? job.error_message ?? null) as string | null,
    createdAt: String(job.createdAt ?? job.created_at ?? new Date().toISOString()),
    completedAt: (job.completedAt ?? job.completed_at ?? null) as string | null,
    actions: Array.isArray(job.actions) ? job.actions as AgentJobDTO["actions"] : [],
  };
}

function actionLabel(intent: string) {
  return intents.find((item) => item.value === intent)?.label ?? (intent === "organize" ? "Organize" : intent.replaceAll("_", " "));
}
