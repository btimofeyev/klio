"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp, BookOpen, CalendarDays, Camera, Check, ChevronRight,
  FileCheck2, FileText, Image as ImageIcon, LayoutDashboard, Link2, LoaderCircle,
  Mic, Paperclip, Pencil, Sparkles, SpellCheck2, Square, Volume2, X,
} from "lucide-react";
import type { AgentTurnDTO, ArtifactDTO, CategoryDTO, EvidenceDTO, ReminderDTO, StudentDTO } from "@/lib/data/workspace";
import { DEFAULT_CAPTURE_INTENT } from "@/lib/agent/intents";
import { deriveDailyBrief, type DailyBriefAction } from "@/lib/product/daily-brief";
import { createClientUuid } from "@/lib/client/uuid";

export type InboxWorkspaceProps = {
  familyId: string;
  students: StudentDTO[];
  categories: CategoryDTO[];
  initialEvidence: EvidenceDTO[];
  initialReminders: ReminderDTO[];
  initialArtifacts: ArtifactDTO[];
  pendingApprovals: number;
  initialAgentTurn: AgentTurnDTO | null;
  initialStudentId?: string;
  assignmentContext?: { id: string; studentId: string; title: string; subject: string } | null;
  onAssignmentDrop?: (assignmentId: string) => void;
  onAssignmentContextClear?: () => void;
  compact?: boolean;
  dashboard?: boolean;
};

type CaptureSubmission = { id: string; items: EvidenceDTO[] };
type AgentJob = { intent: "general" | "organize" | "next_step" | "summary" | "weekly_plan" | "lesson" | "practice" | "portfolio"; label: string; prompt: string; icon: typeof LayoutDashboard; evidenceIds?: string[] };
type AgentTurnSummary = AgentTurnDTO;
type SpellingIssue = { word: string; suggestions: string[] };
type SpellingMenu = SpellingIssue & { start: number; end: number; x: number; y: number };

const genericAgentJobs: AgentJob[] = [
  { intent: "next_step", label: "Suggest next steps", prompt: "Suggest three practical next steps for the selected learner. Base them on current assignments and recent approved work, keep each focused, and flag anything uncertain.", icon: Sparkles },
  { intent: "weekly_plan", label: "Plan next week", prompt: "Draft next week’s plan for the selected learner using current assignments, unfinished work, approved results, and reminders. Preserve the existing curriculum order and flag any conflicts or decisions.", icon: CalendarDays },
  { intent: "summary", label: "Review recent learning", prompt: "Prepare a parent-reviewable summary of the selected learner’s recent learning. Separate what the records clearly show from what remains uncertain, cite the strongest sources, and do not infer mastery.", icon: FileText },
];

export function InboxWorkspace({ familyId, students, categories, initialEvidence, initialReminders, initialArtifacts, pendingApprovals, initialAgentTurn, initialStudentId, assignmentContext = null, onAssignmentDrop, onAssignmentContextClear, compact = false, dashboard = false }: InboxWorkspaceProps) {
  const router = useRouter();
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [studentId, setStudentId] = useState(initialStudentId ?? students[0]?.id ?? "");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reminders, setReminders] = useState(initialReminders);
  const [resolved, setResolved] = useState<Record<string, { id: string; name: string }>>({});
  const [learnerOverrides, setLearnerOverrides] = useState<Record<string, string>>({});
  const [filingStudentIds, setFilingStudentIds] = useState<Record<string, string>>({});
  const [filingId, setFilingId] = useState<string | null>(null);
  const [expandedHelpId, setExpandedHelpId] = useState<string | null>(() => {
    const item = initialEvidence.slice(0, 12).find(isUnfiled);
    return item ? item.captureSubmissionId ?? item.id : null;
  });
  const [editingReminder, setEditingReminder] = useState(false);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [agentJob, setAgentJob] = useState<AgentJob | null>(null);
  const [agentTurn, setAgentTurn] = useState<AgentTurnSummary | null>(initialAgentTurn);
  const [spellingIssues, setSpellingIssues] = useState<SpellingIssue[]>([]);
  const [ignoredSpellings, setIgnoredSpellings] = useState<string[]>([]);
  const [spellingMenu, setSpellingMenu] = useState<SpellingMenu | null>(null);

  useEffect(() => {
    if (!assignmentContext) return;
    const frame = requestAnimationFrame(() => {
      captureInput.current?.focus();
      captureInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [assignmentContext]);

  useEffect(() => {
    if (agentJob || text.trim().length < 2) return;
    const words = extractSpellingWords(text);
    if (!words.length) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/spelling", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ words }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = await response.json() as { issues?: SpellingIssue[] };
        setSpellingIssues((result.issues ?? []).filter((issue) => !ignoredSpellings.includes(issue.word.toLocaleLowerCase("en-US"))));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSpellingIssues([]);
      }
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [agentJob, ignoredSpellings, text]);

  useEffect(() => {
    if (!spellingMenu) return;
    const close = () => setSpellingMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [spellingMenu]);

  const captureStudentId = assignmentContext?.studentId ?? studentId;
  const captureText = [text.trim(), linkUrl.trim() ? `Link: ${linkUrl.trim()}` : ""].filter(Boolean).join("\n");
  const studentNames = new Map(students.map((student) => [student.id, student.displayName]));
  const recentEvidence = initialEvidence.filter((item) => item.captureRoute !== "reminder" && ["ready", "needs_review"].includes(item.status)).slice(0, 12);
  const recentSubmissions = groupCaptureSubmissions(recentEvidence);
  const needsHelp = recentSubmissions.filter((submission) => submission.items.some((item) => isUnfiled(item) && !resolved[item.id]));
  const pendingReminder = reminders
    .filter((item) => item.status === "pending")
    .sort((a, b) => reminderTime(a) - reminderTime(b))[0];
  const recentOutputs = initialArtifacts.filter((artifact) => ["dashboard", "weekly_plan", "lesson", "practice", "portfolio", "summary", "analysis"].includes(artifact.type)).slice(0, 3);
  const agentJobs = contextAwareAgentJobs({
    generic: genericAgentJobs,
    needsHelp,
    recentEvidence,
    artifacts: initialArtifacts,
    reminders,
    learnerName: studentNames.get(studentId) ?? "this learner",
  });
  const dailyBrief = deriveDailyBrief({ students, evidence: initialEvidence, artifacts: initialArtifacts, reminders, pendingApprovals, studentId });

  function selectCaptureStudent(nextStudentId: string) {
    setStudentId(nextStudentId);
    document.cookie = `klio-learner=${encodeURIComponent(nextStudentId)}; Path=/app; Max-Age=31536000; SameSite=Lax`;
  }

  function selectAgentJob(job: AgentJob) {
    if (files.length || linkUrl.trim()) { setMessage("Finish or clear the current capture before starting a Klio job."); return; }
    setAgentJob(job); setText(job.prompt); setMessage(null); setAgentTurn(null);
  }

  function startCustomAgentJob() {
    selectAgentJob({ intent: "general", label: "Ask Klio", prompt: "", icon: Sparkles });
  }

  async function runDailyBriefAction(action: DailyBriefAction) {
    if (action.kind !== "agent" || busy) return;
    const icon = action.intent === "weekly_plan" ? CalendarDays : action.intent === "practice" ? BookOpen : Sparkles;
    const job: AgentJob = { intent: action.intent, label: action.label, prompt: action.prompt, evidenceIds: action.evidenceIds, icon };
    setAgentJob(null);
    setText("");
    setMessage(null);
    await runAgentJob(job, action.prompt);
  }

  function cancelAgentJob() {
    setAgentJob(null); setText(""); setMessage(null);
  }

  async function submitCurrent() {
    if (agentJob) await submitAgentJob();
    else await submitCapture();
  }

  async function submitAgentJob() {
    const request = text.trim();
    if (!request || !studentId || busy || !agentJob) return;
    await runAgentJob(agentJob, request);
  }

  async function retryAgentTurn(turn: AgentTurnSummary) {
    const job = jobForGoal(turn.goal, turn.request);
    setAgentJob(job); setText(turn.request);
    await runAgentJob(job, turn.request);
  }

  async function runAgentJob(job: AgentJob, request: string) {
    const requestId = createClientUuid();
    setBusy(true); setMessage(null);
    setAgentTurn({ id: requestId, status: "queued", goal: job.intent, request, result: null, events: [{ sequence: 1, kind: "turn.queued", label: "Added to Klio’s work queue" }], tools: [] });
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, studentId, evidenceIds: job.evidenceIds ?? [], intent: job.intent, request, requestId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Klio could not start that job.");
      setText(""); setAgentJob(null);
      void refreshWhenTurnFinishes(result.turn.id, undefined, true);
    } catch (caught) {
      setAgentTurn(null); setMessage(caught instanceof Error ? caught.message : "Klio could not start that job.");
    } finally { setBusy(false); }
  }

  async function submitCapture() {
    if ((!captureText && !files.length) || !captureStudentId || busy) return;
    setBusy(true); setMessage(null);
    const scheduleInstruction = Boolean(assignmentContext && isIncompleteUpdate(captureText));
    const body = new FormData();
    body.set("familyId", familyId); body.set("studentId", captureStudentId); body.set("kind", "note");
    if (assignmentContext) body.set("assignmentId", assignmentContext.id);
    body.set("intents", JSON.stringify([DEFAULT_CAPTURE_INTENT]));
    // A scheduling instruction is an action, not learning evidence. Only persist source
    // material when the parent also attached actual work.
    if (captureText && !scheduleInstruction) body.set("text", captureText);
    files.forEach((file) => body.append("file", file));
    try {
      let result: { ids?: string[]; id?: string; studentId?: string; job?: { id?: string }; turn?: { id?: string } } = {};
      if (!scheduleInstruction || files.length) {
        const response = await fetch("/api/evidence", { method: "POST", body });
        result = await response.json();
        if (!response.ok) { setMessage((result as { error?: string }).error ?? "Klio could not save that capture."); return; }
      }
      if (assignmentContext) {
        const linkedResponse = await fetch(scheduleInstruction ? "/api/adjustments" : `/api/assignments/${assignmentContext.id}/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(scheduleInstruction
            ? { familyId, studentId: assignmentContext.studentId, assignmentId: assignmentContext.id }
            : { evidenceIds: result.ids ?? [result.id], note: captureText || null }),
        });
        const linkedResult = await linkedResponse.json();
        if (!linkedResponse.ok) { setMessage(linkedResult.error ?? "The work was saved, but Klio could not attach it to the lesson."); return; }
        if (scheduleInstruction) {
          const applyResponse = await fetch(`/api/adjustments/${linkedResult.proposal.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision: "approve" }),
          });
          const applyResult = await applyResponse.json();
          if (!applyResponse.ok) { setMessage(applyResult.error ?? "Klio drafted the change but could not update the week."); return; }
        }
        setText(""); setLinkUrl(""); setLinkOpen(false); setFiles([]); onAssignmentContextClear?.();
        setMessage(scheduleInstruction
          ? `Week updated. ${linkedResult.proposal.summary}`
          : linkedResult.outcome === "completed"
            ? `${assignmentContext.title} marked complete. The note was filed in ${assignmentContext.subject}.`
            : `${assignmentContext.title} is filed and ready for review.`);
        router.refresh();
        return;
      }
      if (result.studentId && result.studentId !== studentId) selectCaptureStudent(result.studentId);
      setText(""); setLinkUrl(""); setLinkOpen(false); setFiles([]);
      setMessage("Saved. Klio is putting it away.");
      router.refresh();
      if (result.job?.id && result.id) void refreshWhenJobFinishes(result.job.id, result.id);
      if (result.turn?.id) void refreshWhenTurnFinishes(result.turn.id, result.id);
    } catch { setMessage("Klio could not save that capture. Try again."); }
    finally { setBusy(false); }
  }

  async function refreshWhenTurnFinishes(turnId: string, evidenceId?: string, showProgress = false) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(1500);
      try {
        const response = await fetch(`/api/agent/turns?familyId=${familyId}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        const turn = body.turns?.find((item: AgentTurnSummary) => item.id === turnId) as AgentTurnSummary | undefined;
        if (turn && showProgress) setAgentTurn(turn);
        if (turn && ["completed", "awaiting_parent", "failed"].includes(turn.status)) {
          if (turn.status === "completed" && evidenceId) {
            const reminderResponse = await fetch(`/api/reminders?familyId=${familyId}&sourceEvidenceId=${evidenceId}`, { cache: "no-store" });
            if (reminderResponse.ok) {
              const { reminder } = await reminderResponse.json();
              if (reminder) {
                setReminders((current) => current.some((item) => item.id === reminder.id) ? current : [reminder, ...current]);
                setMessage(`Reminder added — ${reminder.title}${reminder.dueAt ? ` · ${formatDue(reminder.dueAt)}` : ""}`);
              }
            }
          } else if (turn.status === "awaiting_parent") setMessage("Klio needs one detail before it can finish.");
          else if (turn.status === "failed") setMessage(showProgress ? "Klio couldn’t finish that job. Your family workspace is safe." : "Klio couldn’t finish, but your capture is safe.");
          router.refresh(); return;
        }
      } catch { return; }
    }
  }

  async function refreshWhenJobFinishes(jobId: string, evidenceId: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await delay(1500);
      try {
        const response = await fetch(`/api/agent/jobs?familyId=${familyId}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        const job = body.jobs?.find((item: { id: string }) => item.id === jobId);
        if (job && ["completed", "partial", "failed"].includes(job.status)) {
          if (job.status !== "failed") {
            const reminderResponse = await fetch(`/api/reminders?familyId=${familyId}&sourceEvidenceId=${evidenceId}`, { cache: "no-store" });
            if (reminderResponse.ok) {
              const { reminder } = await reminderResponse.json();
              if (reminder) {
                setReminders((current) => current.some((item) => item.id === reminder.id) ? current : [reminder, ...current]);
                setMessage(`Reminder added — ${reminder.title}${reminder.dueAt ? ` · ${formatDue(reminder.dueAt)}` : ""}`);
              }
            }
          }
          router.refresh(); return;
        }
      } catch { return; }
    }
  }

  function addFiles(values: FileList | File[]) {
    const incoming = Array.from(values); if (!incoming.length) return;
    setFiles((current) => {
      const available = Math.max(0, 10 - current.length);
      if (incoming.length > available) setMessage("You can attach up to 10 files at once.");
      return [...current, ...incoming.slice(0, available)];
    });
  }

  function handleCaptureDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.currentTarget.classList.remove("dragging");
    const assignmentId = event.dataTransfer.getData("application/x-klio-assignment");
    if (assignmentId && onAssignmentDrop) { onAssignmentDrop(assignmentId); return; }
    if (!agentJob) addFiles(event.dataTransfer.files);
  }

  function pasteImages(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!images.length) return;
    event.preventDefault();
    addFiles(images.map((image, index) => new File([image], `screenshot-${Date.now()}-${index + 1}.${image.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`, { type: image.type })));
  }

  function handleTextChange(value: string) {
    setText(value);
    setSpellingMenu(null);
    if (value.trim().length < 2) setSpellingIssues([]);
  }

  function openSpellingMenu(event: React.MouseEvent<HTMLTextAreaElement>) {
    const range = wordRangeAt(event.currentTarget.value, event.currentTarget.selectionStart);
    if (!range) return;
    const issue = spellingIssues.find((candidate) => candidate.word.toLocaleLowerCase("en-US") === range.word.toLocaleLowerCase("en-US"));
    if (!issue) return;
    event.preventDefault();
    setSpellingMenu({ ...issue, ...range, x: event.clientX, y: event.clientY });
  }

  function replaceSpelling(start: number, end: number, replacement: string) {
    const original = text.slice(start, end);
    const corrected = matchWordCase(original, replacement);
    setText(`${text.slice(0, start)}${corrected}${text.slice(end)}`);
    setSpellingMenu(null);
    requestAnimationFrame(() => {
      captureInput.current?.focus();
      captureInput.current?.setSelectionRange(start + corrected.length, start + corrected.length);
    });
  }

  function replaceFirstSpelling(issue: SpellingIssue, replacement: string) {
    const range = findWord(text, issue.word);
    if (range) replaceSpelling(range.start, range.end, replacement);
  }

  function ignoreSpelling(word: string) {
    setIgnoredSpellings((current) => [...new Set([...current, word.toLocaleLowerCase("en-US")])]);
    setSpellingMenu(null);
  }

  async function toggleRecording() {
    if (recording) { recorder.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream); chunks.current = [];
      mediaRecorder.ondataavailable = (event) => chunks.current.push(event.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        addFiles([new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type })]);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.current = mediaRecorder; mediaRecorder.start(); setRecording(true);
    } catch { setMessage("Microphone access is needed to record a voice note."); }
  }

  async function updateReminder(status: "completed" | "dismissed") {
    if (!pendingReminder) return;
    const previous = reminders;
    setReminders((current) => current.map((item) => item.id === pendingReminder.id ? { ...item, status } : item));
    const response = await fetch(`/api/reminders/${pendingReminder.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { setReminders(previous); setMessage("Klio could not update that reminder."); }
  }

  function beginReminderEdit() {
    if (!pendingReminder) return;
    setReminderTitle(pendingReminder.title);
    setReminderDate(pendingReminder.dueAt ? localDateValue(pendingReminder.dueAt) : "");
    setEditingReminder(true);
  }

  async function saveReminderEdit() {
    if (!pendingReminder || !reminderTitle.trim()) return;
    const dueAt = reminderDate ? new Date(`${reminderDate}T09:00:00`).toISOString() : null;
    const response = await fetch(`/api/reminders/${pendingReminder.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: reminderTitle.trim(), dueAt }) });
    if (!response.ok) { setMessage("Klio could not update that reminder."); return; }
    setReminders((current) => current.map((item) => item.id === pendingReminder.id ? { ...item, title: reminderTitle.trim(), dueAt } : item));
    setEditingReminder(false);
  }

  async function fileEvidence(submission: CaptureSubmission, category: { id?: string; name: string }) {
    const representative = submission.items[0];
    const targetStudentId = filingStudentIds[submission.id] ?? representative.studentIds[0] ?? studentId;
    const targets = submission.items;
    setFilingId(submission.id); setMessage(null);
    try {
      const responses = await Promise.all(targets.map((target) => fetch(`/api/evidence/${target.id}/category`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyId, studentId: targetStudentId, ...(category.id ? { categoryId: category.id } : { categoryName: category.name }) }),
      })));
      if (responses.some((response) => !response.ok)) throw new Error("FILING_FAILED");
      const result = await responses[0].json();
      const filedCategory = result.category ?? category;
      const targetIds = new Set(targets.map((target) => target.id));
      setResolved((current) => Object.fromEntries([
        ...Object.entries(current),
        ...targets.map((target) => [target.id, { id: filedCategory.id, name: filedCategory.name }] as const),
      ]));
      setLearnerOverrides((current) => Object.fromEntries([
        ...Object.entries(current),
        ...targets.map((target) => [target.id, targetStudentId] as const),
      ]));
      setExpandedHelpId(needsHelp.find((candidate) => !candidate.items.some((item) => targetIds.has(item.id)))?.id ?? null);
      const learnerName = studentNames.get(targetStudentId) ?? "the learner";
      setMessage(targets.length > 1 ? `Filed ${targets.length} files in ${learnerName}’s ${filedCategory.name} folder.` : `Filed in ${learnerName}’s ${filedCategory.name} folder.`);
      router.refresh();
    } catch {
      setMessage("Klio could not file that yet. Try again.");
    } finally {
      setFilingId(null);
    }
  }

  const visibleSpellingIssue = agentJob ? undefined : spellingIssues.find((issue) => findWord(text, issue.word));
  const spellingAssist = visibleSpellingIssue ? (
    <div className="klio-spelling-hint" aria-label="Spelling suggestions">
      <SpellCheck2 size={14} aria-hidden="true" />
      <span><strong>{visibleSpellingIssue.word}</strong> might be misspelled</span>
      <div>{visibleSpellingIssue.suggestions.slice(0, 3).map((suggestion) => <button type="button" onClick={() => replaceFirstSpelling(visibleSpellingIssue, suggestion)} key={suggestion}>{suggestion}</button>)}</div>
      <button type="button" className="klio-spelling-keep" onClick={() => ignoreSpelling(visibleSpellingIssue.word)}>Keep</button>
    </div>
  ) : null;
  const spellingMenuPortal = spellingMenu && typeof document !== "undefined" ? createPortal(
    <div className="klio-spelling-menu" role="menu" aria-label={`Corrections for ${spellingMenu.word}`} style={{ left: Math.min(spellingMenu.x, window.innerWidth - 210), top: Math.min(spellingMenu.y, window.innerHeight - 220) }} onPointerDown={(event) => event.stopPropagation()}>
      <small>Correct “{spellingMenu.word}”</small>
      {spellingMenu.suggestions.map((suggestion) => <button type="button" role="menuitem" onClick={() => replaceSpelling(spellingMenu.start, spellingMenu.end, suggestion)} key={suggestion}>{suggestion}</button>)}
      <button type="button" role="menuitem" className="keep" onClick={() => ignoreSpelling(spellingMenu.word)}>Keep as typed</button>
    </div>,
    document.body,
  ) : null;

  if (compact) return (
    <section className={`week-capture ${dashboard ? "day-dashboard-capture" : ""}`} aria-labelledby={dashboard ? undefined : "week-capture-title"}>
      {!dashboard ? <header><div><span>Capture</span><h2 id="week-capture-title">What happened?</h2></div><small>Klio files it into the record</small></header> : null}
      <section className={`quiet-capture ${agentJob ? "agent-job-mode" : ""} ${assignmentContext ? "assignment-context-mode" : ""}`} aria-label={agentJob ? "Give Klio a job" : "Capture learning"} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }} onDragLeave={(event) => event.currentTarget.classList.remove("dragging")} onDrop={handleCaptureDrop}>
        {assignmentContext && !agentJob ? <motion.div className="quiet-assignment-context" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}><FileCheck2 size={14} /><span><small>Working with</small><strong>{assignmentContext.title}</strong></span><button type="button" onClick={onAssignmentContextClear} aria-label={`Remove ${assignmentContext.title}`}><X size={13} /></button></motion.div> : null}
        <textarea ref={captureInput} rows={assignmentContext ? 4 : undefined} value={text} onChange={(event) => handleTextChange(event.target.value)} onContextMenu={openSpellingMenu} onPaste={agentJob ? undefined : pasteImages} placeholder={agentJob ? "What should Klio take care of?" : assignmentContext ? "Add a score, note, photo, or tell Klio what changed…" : dashboard ? "Tell Klio what happened today…" : "Add a note, grade, or what got done…"} aria-label={agentJob ? "What should Klio take care of?" : "What happened in learning today?"} lang="en" spellCheck autoCorrect="on" autoCapitalize="sentences" />
        {spellingAssist}
        {agentJob ? <div className="quiet-job-mode"><Sparkles size={13} /><span>{agentJob.label}</span><button type="button" onClick={cancelAgentJob} aria-label="Return to learning capture"><X size={13} /></button></div> : null}
        <div className="quiet-attachments"><AnimatePresence>{files.map((file, index) => <motion.div layout key={`${file.name}-${file.size}-${index}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}><span>{fileIcon(file)}{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></motion.div>)}</AnimatePresence></div>
        <AnimatePresence>{linkOpen ? <motion.label className="quiet-link" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Link2 size={15} /><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="Paste a curriculum or work link" type="url" autoFocus /><button type="button" onClick={() => { setLinkOpen(false); setLinkUrl(""); }} aria-label="Remove link"><X size={14} /></button></motion.label> : null}</AnimatePresence>
        <footer>
          <input ref={imageInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <input ref={fileInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          {agentJob ? <div className="quiet-agent-context"><Sparkles size={14} /><span>Using current family records</span></div> : <div className="quiet-tools"><button type="button" onClick={() => imageInput.current?.click()}><Camera size={17} />Photo</button><button type="button" className={recording ? "recording" : ""} onClick={toggleRecording}>{recording ? <Square size={13} fill="currentColor" /> : <Mic size={17} />}{recording ? "Stop" : "Voice"}</button><button type="button" onClick={() => fileInput.current?.click()}><Paperclip size={17} />File</button>{dashboard ? <button type="button" onClick={() => setText((current) => current || `${studentNames.get(captureStudentId) ?? "The learner"} scored `)}><FileText size={17} />Score</button> : <button type="button" onClick={() => setLinkOpen((open) => !open)}><Link2 size={17} />Link</button>}</div>}
          <button type="button" className="quiet-save" aria-label={agentJob ? "Give this job to Klio" : "Save to Klio"} onClick={() => void submitCurrent()} disabled={busy || (agentJob ? text.trim().length < 3 : (!captureText && !files.length))}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={18} />}</button>
        </footer>
      </section>
      <div className="week-capture-actions"><button type="button" onClick={startCustomAgentJob} disabled={busy || files.length > 0}><Sparkles size={12} />Ask Klio</button>{agentJobs.slice(0, 3).map((job) => <button type="button" onClick={() => selectAgentJob(job)} disabled={busy || files.length > 0} key={`${job.intent}-${job.label}`}>{job.label}</button>)}</div>
      <AnimatePresence>{agentTurn ? <InlineAgentTurn turn={agentTurn} onDismiss={() => setAgentTurn(null)} onRetry={() => void retryAgentTurn(agentTurn)} /> : null}</AnimatePresence>
      <AnimatePresence>{message ? <motion.p className="quiet-message" role="status" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{message}</motion.p> : null}</AnimatePresence>
      {spellingMenuPortal}
    </section>
  );

  return (
    <main className="quiet-home">
      <section className={`quiet-capture ${agentJob ? "agent-job-mode" : ""} ${assignmentContext ? "assignment-context-mode" : ""}`} aria-label={agentJob ? "Give Klio a job" : "Capture learning"} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }} onDragLeave={(event) => event.currentTarget.classList.remove("dragging")} onDrop={handleCaptureDrop}>
        {assignmentContext && !agentJob ? <motion.div className="quiet-assignment-context" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}><FileCheck2 size={14} /><span><small>Working with</small><strong>{assignmentContext.title}</strong></span><button type="button" onClick={onAssignmentContextClear} aria-label={`Remove ${assignmentContext.title}`}><X size={13} /></button></motion.div> : null}
        <textarea ref={captureInput} rows={assignmentContext ? 4 : undefined} value={text} onChange={(event) => handleTextChange(event.target.value)} onContextMenu={openSpellingMenu} onPaste={agentJob ? undefined : pasteImages} placeholder={agentJob ? "What should Klio take care of?" : assignmentContext ? "Add a score, note, photo, or tell Klio what changed…" : "What happened in learning today?"} aria-label={agentJob ? "What should Klio take care of?" : "What happened in learning today?"} lang="en" spellCheck autoCorrect="on" autoCapitalize="sentences" />
        {spellingAssist}
        {agentJob ? <div className="quiet-job-mode"><Sparkles size={13} /><span>{agentJob.label}</span><button type="button" onClick={cancelAgentJob} aria-label="Return to learning capture"><X size={13} /></button></div> : null}
        <div className="quiet-attachments"><AnimatePresence>{files.map((file, index) => <motion.div layout key={`${file.name}-${file.size}-${index}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}><span>{fileIcon(file)}{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></motion.div>)}</AnimatePresence></div>
        <AnimatePresence>{linkOpen ? <motion.label className="quiet-link" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Link2 size={15} /><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="Paste a link" type="url" autoFocus /><button type="button" onClick={() => { setLinkOpen(false); setLinkUrl(""); }} aria-label="Remove link"><X size={14} /></button></motion.label> : null}</AnimatePresence>
        <footer>
          <input ref={imageInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <input ref={fileInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          {agentJob ? <div className="quiet-agent-context"><Sparkles size={14} /><span>Using current family records</span></div> : <div className="quiet-tools"><button type="button" onClick={() => imageInput.current?.click()}><Camera size={17} />Photo</button><button type="button" className={recording ? "recording" : ""} onClick={toggleRecording}>{recording ? <Square size={13} fill="currentColor" /> : <Mic size={17} />}{recording ? "Stop" : "Voice"}</button><button type="button" onClick={() => fileInput.current?.click()}><Paperclip size={17} />File</button><button type="button" onClick={() => setLinkOpen((open) => !open)}><Link2 size={17} />Link</button></div>}
          <label className="capture-for"><span>For</span><select value={studentId} onChange={(event) => selectCaptureStudent(event.target.value)} aria-label="Selected child">{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
          <button type="button" className="quiet-save" aria-label={agentJob ? "Give this job to Klio" : "Save to Klio"} onClick={() => void submitCurrent()} disabled={busy || (agentJob ? text.trim().length < 3 : (!captureText && !files.length))}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={18} />}</button>
        </footer>
      </section>
      <section className="quiet-agent-suggestions" aria-label="Things Klio can do"><button type="button" className="quiet-agent-launch" onClick={startCustomAgentJob} disabled={busy || files.length > 0}><Sparkles size={12} /> Ask Klio to</button><div>{agentJobs.slice(0, 3).map((job) => { const Icon = job.icon; return <button type="button" onClick={() => selectAgentJob(job)} disabled={busy || files.length > 0} key={`${job.intent}-${job.label}`}><Icon size={13} />{job.label}</button>; })}</div></section>
      <section className="quiet-daily-brief" aria-labelledby="daily-brief-title">
        <span className="quiet-daily-mark"><Sparkles size={14} /></span>
        <div>
          <small>Klio noticed</small>
          <h2 id="daily-brief-title">{dailyBrief.title}</h2>
          <p>{dailyBrief.detail}</p>
          <div className="quiet-daily-counts" aria-label="Items needing attention">
            {dailyBrief.counts.needsFiling ? <span>{dailyBrief.counts.needsFiling} to organize</span> : null}
            {dailyBrief.counts.waitingReview ? <span>{dailyBrief.counts.waitingReview} to review</span> : null}
            {dailyBrief.counts.overdue ? <span>{dailyBrief.counts.overdue} overdue</span> : null}
          </div>
        </div>
        {dailyBrief.action.kind === "artifact" ? <Link className="quiet-daily-action" href={`/app/artifacts/${dailyBrief.action.artifactId}`}>{dailyBrief.action.label}<ChevronRight size={13} /></Link> : null}
        {dailyBrief.action.kind === "agent" ? <button type="button" className="quiet-daily-action" onClick={() => void runDailyBriefAction(dailyBrief.action)} disabled={busy || files.length > 0}>{dailyBrief.action.label}<ChevronRight size={13} /></button> : null}
        {dailyBrief.action.kind === "none" ? <span className="quiet-daily-passive">{dailyBrief.action.label}</span> : null}
      </section>
      <AnimatePresence>{agentTurn ? <InlineAgentTurn turn={agentTurn} onDismiss={() => setAgentTurn(null)} onRetry={() => void retryAgentTurn(agentTurn)} /> : null}</AnimatePresence>
      <AnimatePresence>{message ? <motion.p className="quiet-message" role="status" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{message}</motion.p> : null}</AnimatePresence>
      {spellingMenuPortal}

      <AnimatePresence mode="popLayout">{pendingReminder ? <motion.section className={`quiet-reminder ${editingReminder ? "editing" : ""}`} aria-label="Klio reminder" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
        {editingReminder ? <div className="reminder-edit-form"><label><span>Reminder</span><input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} autoFocus /></label><label><span>Due date</span><input type="date" value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} /></label><div><button type="button" onClick={() => setEditingReminder(false)}>Cancel</button><button type="button" onClick={saveReminderEdit} disabled={!reminderTitle.trim()}>Save</button></div></div> : <><div><span>Klio reminder</span><p>{pendingReminder.title}</p>{pendingReminder.dueAt ? <small>{formatDue(pendingReminder.dueAt)}</small> : null}</div><div className="reminder-actions"><button type="button" onClick={() => updateReminder("completed")}><Check size={15} />Done</button><button type="button" onClick={beginReminderEdit}><Pencil size={13} />Edit</button></div></>}
        <button type="button" className="reminder-close" aria-label="Dismiss reminder" onClick={() => updateReminder("dismissed")}><X size={15} /></button>
      </motion.section> : null}</AnimatePresence>

      {recentOutputs.length ? <section className="quiet-outputs" aria-labelledby="klio-outputs-title"><header><h2 id="klio-outputs-title">Made by Klio</h2><span>Ready to review</span></header><div>{recentOutputs.map((artifact) => <Link href={`/app/artifacts/${artifact.id}`} key={artifact.id}><span>{outputIcon(artifact.type)}</span><p><strong>{artifact.title}</strong><small>{artifact.type.replaceAll("_", " ")} · {artifact.status}</small></p><ChevronRight size={13} /></Link>)}</div></section> : null}

      <section className="quiet-recent" aria-labelledby="recent-learning-title">
        <header><h1 id="recent-learning-title">Recent learning</h1><Link href="/app/records">View folders</Link></header>
        {recentEvidence.length ? groupEvidence(recentEvidence).map(([label, submissions]) => <div className="timeline-day" key={label}><h2>{label}</h2><div>{submissions.map((submission) => {
          const item = submission.items[0];
          const learnerId = learnerOverrides[item.id] ?? item.studentIds[0];
          const child = studentNames.get(learnerId) ?? "Family";
          const filing = resolved[item.id] ?? item.categories[0];
          const subject = filing?.name;
          const uncertain = submission.items.some((candidate) => isUnfiled(candidate) && !resolved[candidate.id]);
          const expanded = uncertain && expandedHelpId === submission.id;
          const batchSize = submission.items.length;
          const filingStudentId = filingStudentIds[submission.id] ?? learnerId ?? studentId;
          const suggestedFolders = folderChoices(categories, item, students.find((student) => student.id === filingStudentId)?.subjects);
          const submissionLabel = submissionDescription(submission);
          const showFileCount = batchSize > 1 && !submissionLabel.startsWith(`${batchSize}-file `);
          return <article className={[uncertain ? "needs-help" : "", expanded ? "filing-open" : ""].filter(Boolean).join(" ")} key={submission.id}>
            <Link href={folderHref(learnerId, filing?.id)}><span className="timeline-dot">{kindIcon(item.kind)}</span><p><strong>{child}</strong><i>—</i><span>{subject ?? kindLabel(item.kind)}</span><em>“{submissionLabel}”</em>{showFileCount ? <b>{batchSize} files</b> : null}</p>{expanded ? <small>Needs your help</small> : null}</Link>
            {uncertain && !expanded ? <button type="button" className="timeline-file-action" onClick={() => setExpandedHelpId(submission.id)} aria-label={`File ${submissionLabel}`}><span>Needs your help</span>File</button> : null}
            <AnimatePresence>{expanded ? <motion.div className="filing-question" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
              <div className="filing-question-head"><p>{batchSize > 1 ? `Where should this ${batchSize}-file assignment go?` : "Where should this go?"}</p><label><span>Learner</span><select value={filingStudentId} onChange={(event) => setFilingStudentIds((current) => ({ ...current, [submission.id]: event.target.value }))}>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label></div>
              <div>{suggestedFolders.map((category) => <button type="button" disabled={filingId === submission.id} onClick={() => fileEvidence(submission, category)} key={category.name}>{category.name}</button>)}</div>
              {batchSize > 1 ? <small>One choice files the whole assignment.</small> : null}
            </motion.div> : null}</AnimatePresence>
          </article>;
        })}</div></div>) : <div className="quiet-empty"><FileText size={21} /><p>Your learning record will appear here.</p><span>Drop in a note, photo, voice memo, file, or link to begin.</span></div>}
      </section>
    </main>
  );
}

function InlineAgentTurn({ turn, onDismiss, onRetry }: { turn: AgentTurnSummary; onDismiss: () => void; onRetry: () => void }) {
  const active = ["queued", "running"].includes(turn.status);
  const awaitingParent = turn.status === "awaiting_parent";
  const failed = turn.status === "failed";
  const labels = [...new Map(turn.events.filter((event) => event.kind !== "agent.progress").map((event) => [event.label, event])).values()].slice(-4);
  const artifactId = turn.tools.map((tool) => tool.result as { artifactId?: string } | null).find((result) => result?.artifactId)?.artifactId;
  return <motion.section className={`quiet-agent-turn ${active ? "working" : ""} ${failed ? "failed" : ""}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
    <span className="quiet-agent-mark"><Sparkles size={14} /></span>
    <div><header><strong>{active ? activeAgentLabel(turn.goal, turn.status) : awaitingParent ? "Klio needs one detail" : failed ? "Klio couldn’t finish" : "Klio finished"}</strong>{!active ? <button type="button" onClick={onDismiss} aria-label="Dismiss Klio result"><X size={13} /></button> : null}</header>
      <ol>{labels.map((event, index) => <li key={`${event.sequence}-${event.label}`}>{active && index === labels.length - 1 ? <LoaderCircle className="spin" size={12} /> : <Check size={12} />}<span>{event.label}</span></li>)}</ol>
      {turn.result?.message ? <p>{turn.result.message}</p> : null}
      {artifactId ? <Link href={`/app/artifacts/${artifactId}`}>Open result <ChevronRight size={12} /></Link> : null}
      {failed ? <button type="button" className="quiet-agent-retry" onClick={onRetry}>Try again</button> : null}
    </div>
  </motion.section>;
}

function activeAgentLabel(goal: string, status: string) {
  if (status === "queued") return `Klio queued: ${agentTaskLabel(goal)}`;
  return `Klio is ${agentTaskLabel(goal)}`;
}

function agentTaskLabel(goal: string) {
  return ({
    capture: "organizing a capture",
    dashboard: "building the family dashboard",
    lesson: "drafting a lesson",
    practice: "creating focused practice",
    weekly_plan: "planning the week",
    portfolio: "building a portfolio",
    records: "updating the learning record",
    general: "working on your request",
  } as Record<string, string>)[goal] ?? "working on your request";
}

function contextAwareAgentJobs(input: { generic: AgentJob[]; needsHelp: CaptureSubmission[]; recentEvidence: EvidenceDTO[]; artifacts: ArtifactDTO[]; reminders: ReminderDTO[]; learnerName: string }) {
  const jobs: AgentJob[] = [...input.generic];
  const recentIds = input.recentEvidence.slice(0, 8).map((item) => item.id);
  if (input.needsHelp.length) {
    const evidenceIds = input.needsHelp.flatMap((submission) => submission.items.map((item) => item.id)).slice(0, 20);
    const firstUnfiled = input.needsHelp[0].items[0];
    jobs.push({ intent: "organize", label: filingSuggestionLabel(firstUnfiled, evidenceIds.length), prompt: `File “${description(firstUnfiled)}” for ${input.learnerName}. Use the source content and current family folders. Ask me one concise question only if the subject is genuinely uncertain.`, icon: Sparkles, evidenceIds });
  }
  const outputTypes = new Set(input.artifacts.map((artifact) => artifact.type));
  const practiceSource = input.recentEvidence.find((item) => item.kind === "grade") ?? input.recentEvidence.find((item) => /error|missed|needs|developing/i.test(`${item.title ?? ""} ${item.rawText ?? ""}`));
  if (practiceSource && !outputTypes.has("practice")) {
    const focus = practiceFocus(practiceSource);
    jobs.push({ intent: "practice", label: focus.label, prompt: `Create a short practice activity for ${input.learnerName} focused on ${focus.promptFocus}. Ground it in “${description(practiceSource)}” and its recorded errors; do not introduce unrelated skills.`, icon: BookOpen, evidenceIds: [practiceSource.id] });
  }
  const incomplete = input.recentEvidence.find((item) => /still in progress|unfinished|still needs|incomplete/i.test(`${item.title ?? ""} ${item.rawText ?? ""}`));
  if (incomplete) {
    jobs.push({ intent: "lesson", label: lessonSuggestionLabel(incomplete), prompt: `Create a focused guided lesson that helps ${input.learnerName} complete “${description(incomplete)}”. Use the existing work as the starting point and include only the support needed to finish it.`, icon: BookOpen, evidenceIds: [incomplete.id] });
  }
  const pendingReminders = input.reminders.filter((item) => item.status === "pending").slice(0, 3);
  if (pendingReminders.length) {
    const topics = [...new Set(pendingReminders.map((item) => subjectCue(item.title)).filter(Boolean))];
    const label = topics.length ? `Plan ${topics.slice(0, 2).join(" + ")} follow-ups` : `Plan ${input.learnerName}’s open follow-ups`;
    jobs.push({ intent: "weekly_plan", label, prompt: `Draft the next five learning days for ${input.learnerName} around these current follow-ups: ${pendingReminders.map((item) => item.title).join("; ")}. Use the current records and avoid adding unrelated work.`, icon: CalendarDays });
  }
  if (!outputTypes.has("dashboard")) jobs.push(input.generic[0]);
  if (!outputTypes.has("weekly_plan")) jobs.push(input.generic[1]);
  if (recentIds.length >= 3 && !outputTypes.has("portfolio")) jobs.push({ intent: "portfolio", label: "Build a portfolio draft", prompt: `Build a parent-reviewable portfolio draft for ${input.learnerName} from the strongest current learning evidence.`, icon: FileText, evidenceIds: recentIds });
  jobs.push(input.generic[2], input.generic[1], input.generic[0], input.generic[3]);
  return jobs.filter(Boolean).filter((job, index, all) => all.findIndex((candidate) => candidate.intent === job.intent) === index).slice(0, 4);
}

function filingSuggestionLabel(item: EvidenceDTO, count: number) {
  if (count > 1) return `File ${count} related captures`;
  if (/oral practice/i.test(`${item.title ?? ""} ${item.rawText ?? ""}`)) return "File Friday’s oral-practice note";
  return `File “${description(item).slice(0, 28)}${description(item).length > 28 ? "…" : ""}”`;
}

function practiceFocus(item: EvidenceDTO) {
  const context = `${item.title ?? ""} ${item.rawText ?? ""}`.toLowerCase();
  if (context.includes("negative slope")) return { label: "Practice negative slopes", promptFocus: "graphing negative slopes and converting from standard form" };
  if (context.includes("negative sign") || context.includes("distribut")) return { label: "Practice negative-sign distribution", promptFocus: "distributing negative signs in multi-step equations" };
  if (context.includes("commentary")) return { label: "Practice literary commentary", promptFocus: "explaining how quoted evidence supports a literary claim" };
  const subject = item.categories[0]?.name ?? kindLabel(item.kind);
  return { label: `Practice ${subject}: ${description(item).slice(0, 22)}`, promptFocus: description(item) };
}

function lessonSuggestionLabel(item: EvidenceDTO) {
  const context = `${item.title ?? ""} ${item.rawText ?? ""}`.toLowerCase();
  if (context.includes("osmosis") && context.includes("conclusion")) return "Finish the osmosis conclusion";
  return `Finish “${description(item).slice(0, 25)}${description(item).length > 25 ? "…" : ""}”`;
}

function subjectCue(title: string) {
  return ["Biology", "Algebra", "English", "Spanish", "History", "Science", "Math"].find((subject) => title.toLowerCase().includes(subject.toLowerCase())) ?? "";
}

function jobForGoal(goal: string | undefined, request: string): AgentJob {
  const intents = { capture: "organize", dashboard: "summary", weekly_plan: "weekly_plan", lesson: "lesson", practice: "practice", portfolio: "portfolio" } as const;
  const intent = goal && goal in intents ? intents[goal as keyof typeof intents] : "general";
  return { intent, label: "Retry this job", prompt: request, icon: Sparkles };
}

function folderChoices(categories: CategoryDTO[], item: EvidenceDTO, subjects: StudentDTO["subjects"]) {
  const canonical = ["English", "Reading", "Writing", "Math", "Science", "History", "Arts", "Life Skills", "Other"];
  const subjectNames = new Set((subjects ?? []).map((subject) => subject.name.toLowerCase()));
  const currentNames = new Set(item.categories.map((category) => category.name.toLowerCase()));
  const visibleCategories = categories.filter((category) => category.name.toLowerCase() !== "general" && (!subjectNames.size || subjectNames.has(category.name.toLowerCase()) || currentNames.has(category.name.toLowerCase())));
  const fallbacks = subjects?.length ? subjects.map((subject) => subject.name) : canonical;
  const choices = [...visibleCategories, ...fallbacks.filter((name) => !visibleCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())).map((name) => ({ name }))];
  const context = `${item.title ?? ""} ${item.rawText ?? ""}`.toLowerCase();
  return choices.sort((a, b) => folderRank(a.name, context) - folderRank(b.name, context) || a.name.localeCompare(b.name));
}
function folderRank(name: string, context: string) { const normalized = name.toLowerCase(); if (context.includes(normalized)) return -1; const order = ["english", "reading", "writing", "math", "science", "history", "arts", "life skills", "other"]; const index = order.indexOf(normalized); return index === -1 ? 50 : index; }
function isUnfiled(item: EvidenceDTO) { return item.status === "needs_review" || (item.status === "ready" && item.categories.length === 0); }
function reminderTime(item: ReminderDTO) { return item.dueAt ? new Date(item.dueAt).getTime() : Number.MAX_SAFE_INTEGER; }
function fileIcon(file: File) { if (file.type.startsWith("image/")) return <ImageIcon size={14} />; if (file.type.startsWith("audio/")) return <Volume2 size={14} />; return <FileText size={14} />; }
function outputIcon(type: string) { if (type === "weekly_plan") return <CalendarDays size={14} />; if (type === "lesson" || type === "practice") return <BookOpen size={14} />; return <LayoutDashboard size={14} />; }
function kindIcon(kind: string) { if (kind === "photo") return <ImageIcon size={15} />; if (kind === "voice") return <Mic size={15} />; return <FileText size={15} />; }
function kindLabel(kind: string) { return ({ photo: "Photo", voice: "Voice", document: "File", note: "Note", grade: "Math", book: "Reading", activity: "Activity" } as Record<string,string>)[kind] ?? kind.replaceAll("_", " "); }
function description(item: EvidenceDTO) { return (item.title || item.rawText || kindLabel(item.kind)).replace(/^Link:\s*/i, "").slice(0, 105); }
function submissionDescription(submission: CaptureSubmission) {
  const first = submission.items[0];
  if (first.rawText?.trim()) return description(first);
  if (submission.items.length === 1) return description(first);
  const documentTypes = submission.items.flatMap((item) => item.categories.map((category) => category.documentType?.replace(/\s+(page|works cited page)$/i, "").trim())).filter((value): value is string => Boolean(value));
  const documentType = documentTypes[0];
  return documentType ? `${submission.items.length}-file ${documentType}` : `${submission.items.length} uploaded files`;
}
function dayLabel(value: string) { const date = new Date(value); const today = new Date(); if (date.toDateString() === today.toDateString()) return "Today"; const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1); if (date.toDateString() === yesterday.toDateString()) return "Yesterday"; return new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric" }).format(date); }
function groupCaptureSubmissions(items: EvidenceDTO[]) {
  const groups = new Map<string, CaptureSubmission>();
  for (const item of items) {
    const id = item.captureSubmissionId ?? item.id;
    const group = groups.get(id);
    if (group) group.items.push(item);
    else groups.set(id, { id, items: [item] });
  }
  return [...groups.values()];
}
function groupEvidence(items: EvidenceDTO[]) {
  const days = new Map<string, EvidenceDTO[]>();
  items.forEach((item) => { const label = dayLabel(item.createdAt); days.set(label, [...(days.get(label) ?? []), item]); });
  return [...days.entries()].map(([label, dayItems]) => [label, groupCaptureSubmissions(dayItems)] as const);
}
function formatDue(value: string) { const date = new Date(value); const today = new Date(); if (date.toDateString() === today.toDateString()) return `Today at ${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date)}`; return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(date); }
function folderHref(studentId: string | undefined, categoryId: string | undefined) { const params = new URLSearchParams(); if (studentId) params.set("student", studentId); params.set("folder", categoryId ?? "unfiled"); return `/app/records?${params.toString()}`; }
function localDateValue(value: string) { const date = new Date(value); const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
function delay(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function extractSpellingWords(value: string) {
  return [...new Set((value.match(/[A-Za-z][A-Za-z'’-]{1,39}/g) ?? []).map((word) => word.replace(/[’]/g, "'")).slice(0, 40))];
}
function wordRangeAt(value: string, caret: number) {
  const ranges = [...value.matchAll(/[A-Za-z][A-Za-z'’-]*/g)].map((match) => ({ word: match[0], start: match.index, end: match.index + match[0].length }));
  return ranges.find((range) => caret >= range.start && caret <= range.end) ?? null;
}
function findWord(value: string, word: string) {
  return [...value.matchAll(/[A-Za-z][A-Za-z'’-]*/g)]
    .map((match) => ({ word: match[0], start: match.index, end: match.index + match[0].length }))
    .find((range) => range.word.toLocaleLowerCase("en-US") === word.toLocaleLowerCase("en-US")) ?? null;
}
function matchWordCase(original: string, replacement: string) {
  if (original === original.toLocaleUpperCase("en-US")) return replacement.toLocaleUpperCase("en-US");
  if (original[0] === original[0]?.toLocaleUpperCase("en-US")) return `${replacement[0]?.toLocaleUpperCase("en-US") ?? ""}${replacement.slice(1)}`;
  return replacement;
}
function isIncompleteUpdate(value: string) {
  const incomplete = /\b(?:not finished|not complete|unfinished|incomplete|didn['’]?t (?:finish|complete)|did not (?:finish|complete)|couldn['’]?t finish|needs? (?:more )?time)\b/i.test(value);
  const scheduleVerb = /\b(?:move|push|postpone|reschedule|shift|roll(?:ed)? (?:it|this)? ?(?:over|forward))\b/i.test(value);
  const explicitlyLater = /\b(?:do|finish|complete) (?:it |this )?(?:tomorrow|next (?:day|learning day))\b/i.test(value);
  return incomplete || scheduleVerb || explicitlyLater;
}
