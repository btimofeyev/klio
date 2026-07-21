"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight, ArrowUp, BookOpen, CalendarDays, Camera, Check, ChevronRight, Circle,
  FileCheck2, FileText, Image as ImageIcon, LayoutDashboard, Link2, LoaderCircle,
  MessagesSquare, Mic, Paperclip, Pencil, Plus, RotateCcw, Sparkles, SpellCheck2, Square, Volume2, X,
} from "lucide-react";
import type { AgentConversationDTO, AgentTurnDTO, ArtifactDTO, CategoryDTO, EvidenceDTO, ReminderDTO, StudentDTO } from "@/lib/data/workspace";
import { DEFAULT_CAPTURE_INTENT } from "@/lib/agent/intents";
import { deriveDailyBrief, type DailyBriefAction } from "@/lib/product/daily-brief";
import {
  assistantStarterGroups,
  assistantStarterShortLabel,
  resolveAssistantStarterCatalog,
  resolveTopAssistantStarters,
  type AssistantIntent,
  type AssistantStarterId,
  type ResolvedAssistantStarter,
} from "@/lib/product/assistant-starters";
import { createClientUuid } from "@/lib/client/uuid";
import { deriveReceiptState } from "@/lib/agent/workspace/receipt-state";
import { explicitlyMentionedStudentId, isAssignmentGuidanceRequest } from "@/lib/agent/workspace/request-routing";
import { normalizePracticeSpec } from "@/lib/practice/spec";
import { estimatedPracticeMinutes } from "@/lib/practice/presentation";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { MAX_DICTATION_SECONDS, appendDictationText, dictationFileName, dictationValidationError, formatDictationDuration } from "@/lib/voice/dictation";
import { completedConversationScrollTarget } from "@/lib/product/conversation-scroll";
import { AssistantRichMessage } from "./assistant-rich-message";

export type InboxWorkspaceProps = {
  familyId: string;
  students: StudentDTO[];
  categories: CategoryDTO[];
  initialEvidence: EvidenceDTO[];
  initialReminders: ReminderDTO[];
  initialArtifacts: ArtifactDTO[];
  pendingApprovals: number;
  initialAgentTurn: AgentTurnDTO | null;
  initialAgentConversation?: AgentConversationDTO | null;
  initialStudentId?: string;
  workspaceDate?: string;
  assignmentContext?: { id: string; studentId: string; title: string; subject: string } | null;
  onAssignmentDrop?: (assignmentId: string) => void;
  onAssignmentContextClear?: () => void;
  onPracticeOpen?: (artifactId: string) => void;
  onFocusModeChange?: (focused: boolean) => void;
  onAgentTurnChange?: (turn: AgentTurnDTO | null) => void;
  assistantPrefill?: { key: number; request: string } | null;
  compact?: boolean;
  dashboard?: boolean;
};

type CaptureSubmission = { id: string; items: EvidenceDTO[] };
type AgentJob = { intent: AssistantIntent; label: string; prompt: string; icon: typeof LayoutDashboard; evidenceIds?: string[]; expectedOutput?: string; subject?: string };
type AgentTurnSummary = AgentTurnDTO;
type ConversationMessage = { role: "parent" | "klio"; content: string; turnId?: string | null };
type ConversationSummary = { id: string; title: string; studentId: string | null; updatedAt: string };
type ConversationContext = { studentId: string | null; assignmentId?: string; subject?: string; taskName: string };
type VoicePhase = "idle" | "requesting" | "recording" | "transcribing" | "done" | "error";
type ConversationComposer = {
  text: string; files: File[]; studentId: string; recording: boolean; voicePhase: VoicePhase; voiceSeconds: number; voiceMessage: string;
  onTextChange: (value: string) => void; onStudentChange: (studentId: string) => void;
  onPhoto: () => void; onFile: () => void; onVoice: () => void; onScore: () => void;
  onRemoveFile: (index: number) => void; onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};
type SpellingIssue = { word: string; suggestions: string[] };
type SpellingMenu = SpellingIssue & { start: number; end: number; x: number; y: number };

const CAPABILITY_LIBRARY_ID = "klio-capability-library";

const genericAgentJobs: AgentJob[] = [
  { intent: "next_step", label: "Suggest next steps", prompt: "Suggest three practical next steps for the selected learner. Base them on current assignments and recent approved work, keep each focused, and flag anything uncertain.", icon: Sparkles },
  { intent: "weekly_plan", label: "Plan the rest of this week", prompt: "Draft the rest of this week for the selected learner using current assignments, unfinished work, approved results, and reminders. Preserve the existing curriculum order and flag any conflicts or decisions.", icon: CalendarDays },
  { intent: "summary", label: "Review recent learning", prompt: "Prepare a parent-reviewable summary of the selected learner’s recent learning. Separate what the records clearly show from what remains uncertain, cite the strongest sources, and do not infer mastery.", icon: FileText },
];
const subscribeToClientMount = () => () => {};

export function InboxWorkspace({ familyId, students, categories, initialEvidence, initialReminders, initialArtifacts, pendingApprovals, initialAgentTurn, initialAgentConversation = null, initialStudentId, workspaceDate, assignmentContext = null, onAssignmentDrop, onAssignmentContextClear, onPracticeOpen, onFocusModeChange, onAgentTurnChange, assistantPrefill = null, compact = false, dashboard = false }: InboxWorkspaceProps) {
  const router = useRouter();
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLTextAreaElement>(null);
  const captureShell = useRef<HTMLElement>(null);
  const conversationButton = useRef<HTMLButtonElement>(null);
  const conversationPicker = useRef<HTMLElement>(null);
  const capabilityLibraryButton = useRef<HTMLButtonElement>(null);
  const capabilityLibraryPanel = useRef<HTMLElement>(null);
  const appliedAssistantPrefillKey = useRef<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const recordingDeadline = useRef<number | null>(null);
  const voiceResetTimer = useRef<number | null>(null);
  const transcriptionRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const recordDraft = useRef("");
  const askDraft = useRef("");
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [studentId, setStudentId] = useState(() => initialStudentId !== undefined ? initialStudentId : students.length === 1 ? students[0]?.id ?? "" : "");
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceMessage, setVoiceMessage] = useState("");
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
  const [conversationId, setConversationId] = useState<string | null>(() => initialAgentTurn?.conversationId && initialAgentTurn.conversationId === initialAgentConversation?.id ? initialAgentConversation.id : null);
  const [conversationViewVersion, setConversationViewVersion] = useState(0);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>(() => initialAgentTurn?.conversationId && initialAgentTurn.conversationId === initialAgentConversation?.id
    ? initialAgentConversation.messages.filter((message) => message.turnId !== initialAgentTurn.id).map((message) => ({ role: message.role === "user" ? "parent" : "klio", content: message.content, turnId: message.turnId }))
    : []);
  const [conversationContext, setConversationContext] = useState<ConversationContext | null>(null);
  const [conversationPickerOpen, setConversationPickerOpen] = useState(false);
  const [recentConversations, setRecentConversations] = useState<ConversationSummary[]>([]);
  const [conversationPickerLoading, setConversationPickerLoading] = useState(false);
  const [conversationPickerError, setConversationPickerError] = useState<string | null>(null);
  const [conversationPickerPosition, setConversationPickerPosition] = useState({ left: 12, bottom: 72 });
  const [capabilityLibraryOpen, setCapabilityLibraryOpen] = useState(false);
  const [capabilityLibraryPosition, setCapabilityLibraryPosition] = useState({ left: 12, bottom: 160, width: 620, maxHeight: 560 });
  const [spellingIssues, setSpellingIssues] = useState<SpellingIssue[]>([]);
  const [ignoredSpellings, setIgnoredSpellings] = useState<string[]>([]);
  const [spellingMenu, setSpellingMenu] = useState<SpellingMenu | null>(null);
  const recording = voicePhase === "recording";
  const voicePending = voicePhase === "requesting" || voicePhase === "transcribing";
  const voiceBusy = voicePending || recording;

  useEffect(() => {
    onAgentTurnChange?.(agentTurn);
  }, [agentTurn, onAgentTurnChange]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recordingTimer.current !== null) window.clearInterval(recordingTimer.current);
      if (recordingDeadline.current !== null) window.clearTimeout(recordingDeadline.current);
      if (voiceResetTimer.current !== null) window.clearTimeout(voiceResetTimer.current);
      transcriptionRequest.current?.abort();
      if (recorder.current && recorder.current.state !== "inactive") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      recordingStream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!agentTurn?.id) return;
    const supabase = createSupabaseClient();
    const refreshLiveTurn = async () => {
      const response = await fetch(`/api/agent/turns?familyId=${familyId}${conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : ""}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { turns?: AgentTurnSummary[]; conversation?: { id: string; messages: Array<{ role: string; content: string; turnId?: string | null }> } | null };
      const turn = body.turns?.find((item) => item.id === agentTurn.id);
      if (turn) applyAgentTurn(turn);
      if (body.conversation?.id) {
        setConversationId(body.conversation.id);
        setConversationHistory(body.conversation.messages.filter((item) => item.turnId !== agentTurn.id).map((item) => ({ role: item.role === "user" ? "parent" : "klio", content: item.content, turnId: item.turnId })));
      }
    };
    const channel = supabase.channel(`klio-conversation:${agentTurn.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "agent_turns", filter: `id=eq.${agentTurn.id}` }, () => { void refreshLiveTurn(); });
    if (conversationId) channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_conversation_messages", filter: `conversation_id=eq.${conversationId}` }, () => { void refreshLiveTurn(); });
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [agentTurn?.id, conversationId, familyId]);

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

  useEffect(() => {
    if (!conversationPickerOpen) return;
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (conversationPicker.current?.contains(target) || conversationButton.current?.contains(target))) return;
      setConversationPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConversationPickerOpen(false);
        conversationButton.current?.focus({ preventScroll: true });
      }
    };
    const closeForViewportChange = () => setConversationPickerOpen(false);
    window.addEventListener("pointerdown", closeIfOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeForViewportChange);
    return () => {
      window.removeEventListener("pointerdown", closeIfOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeForViewportChange);
    };
  }, [conversationPickerOpen]);

  useEffect(() => {
    if (!capabilityLibraryOpen) return;
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (capabilityLibraryPanel.current?.contains(target) || capabilityLibraryButton.current?.contains(target))) return;
      setCapabilityLibraryOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCapabilityLibraryOpen(false);
      capabilityLibraryButton.current?.focus({ preventScroll: true });
    };
    const closeForViewportChange = () => setCapabilityLibraryOpen(false);
    const focusFrame = requestAnimationFrame(() => capabilityLibraryPanel.current?.querySelector<HTMLButtonElement>(".assistant-capability-close")?.focus({ preventScroll: true }));
    window.addEventListener("pointerdown", closeIfOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeForViewportChange);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeIfOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeForViewportChange);
    };
  }, [capabilityLibraryOpen]);

  const captureText = text.trim();
  const mentionedStudentId = explicitlyMentionedStudentId(captureText, students);
  const captureStudentId = assignmentContext?.studentId ?? mentionedStudentId ?? studentId;
  const hasCapture = Boolean(captureText || linkUrl.trim() || files.length);
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
  const starterStudentId = assignmentContext?.studentId ?? studentId;
  const starterContext = {
    learnerName: starterStudentId ? studentNames.get(starterStudentId) ?? null : null,
    assignmentTitle: assignmentContext?.title ?? null,
    subject: assignmentContext?.subject ?? null,
    workspaceDate: workspaceDate ?? null,
  };
  const topAssistantStarters = resolveTopAssistantStarters(starterContext);
  const assistantStarters = resolveAssistantStarterCatalog(starterContext);
  const activeAgentTask = Boolean(agentTurn && ["queued", "running", "awaiting_parent"].includes(agentTurn.status));
  const starterBlockReason = files.length || linkOpen || linkUrl.trim() || voiceBusy
    ? "Finish or clear the current capture before starting a Klio job."
    : activeAgentTask || busy
      ? "Finish the current Klio conversation before starting another goal."
      : null;
  const dailyBrief = deriveDailyBrief({ students, evidence: initialEvidence, artifacts: initialArtifacts, reminders, pendingApprovals, studentId });
  const assignmentScheduleChange = Boolean(!agentJob && assignmentContext && isIncompleteUpdate(captureText));
  // Plain language always belongs to Klio. The agent decides whether it is a
  // conversation, a question, or a request for workspace follow-through.
  // Attachments and explicit lesson-state controls retain their deterministic
  // evidence paths because the parent has already supplied the record target.
  const inferredKlioRequest = Boolean(
    !agentJob
    && !assignmentScheduleChange
    && !files.length
    && !linkUrl.trim()
    && captureText,
  );
  const targetName = captureStudentId
    ? studentNames.get(captureStudentId)
    : agentJob || inferredKlioRequest ? "your family" : null;
  const sendInterpretation = !hasCapture
    ? captureStudentId
      ? `Ready for ${studentNames.get(captureStudentId)}`
      : "Ask a family question or choose a learner for records"
    : !targetName
      ? "Choose a learner before saving this record"
    : agentJob
      ? `Ask Klio to help ${targetName}`
    : inferredKlioRequest
        ? assignmentContext && isAssignmentGuidanceRequest(captureText)
          ? `Ask Klio about ${targetName}’s ${assignmentContext.subject} lesson`
          : `Ask Klio using ${targetName === "your family" ? "family" : targetName} records`
        : assignmentScheduleChange
          ? `Save ${targetName}’s update and ask Klio to change this week`
          : files.length || linkUrl.trim()
            ? `Save for ${targetName} and let Klio handle it`
            : `Save as ${targetName}’s ${assignmentContext?.subject ?? "learning"} record`;
  const canSubmit = !busy && !voiceBusy && (agentJob || inferredKlioRequest ? text.trim().length > 0 : Boolean(targetName) && hasCapture);

  function selectCaptureStudent(nextStudentId: string) {
    setStudentId(nextStudentId);
    document.cookie = `klio-learner=${encodeURIComponent(nextStudentId)}; Path=/app; Max-Age=31536000; SameSite=Lax`;
  }

  function selectAgentJob(job: AgentJob) {
    if (starterBlockReason) { setMessage(starterBlockReason); return; }
    if (!agentJob) recordDraft.current = text;
    setAgentJob(job); setText(job.prompt); setMessage(null); onFocusModeChange?.(true);
    captureInput.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!assistantPrefill || appliedAssistantPrefillKey.current === assistantPrefill.key) return;
    appliedAssistantPrefillKey.current = assistantPrefill.key;
    let focusTimer: number | undefined;
    const applyTimer = window.setTimeout(() => {
      if (starterBlockReason) { setMessage(starterBlockReason); return; }
      if (!agentJob) recordDraft.current = text;
      setAgentJob({ intent: "general", label: "Weekly briefing", prompt: assistantPrefill.request, icon: Sparkles });
      setText(assistantPrefill.request);
      setMessage(null);
      onFocusModeChange?.(true);
      focusTimer = window.setTimeout(() => captureInput.current?.focus({ preventScroll: true }), 0);
    }, 0);
    return () => { window.clearTimeout(applyTimer); if (focusTimer !== undefined) window.clearTimeout(focusTimer); };
    // A new key is an explicit external handoff. Composer state is deliberately
    // captured at that moment so Save record can restore the original draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantPrefill?.key]);

  function startCustomAgentJob() {
    if (agentJob) return;
    selectAgentJob({ intent: "general", label: "Ask Klio", prompt: askDraft.current, icon: Sparkles });
  }

  function selectAssistantStarter(starter: ResolvedAssistantStarter) {
    if (starter.disabled || starterBlockReason) return;
    setCapabilityLibraryOpen(false);
    selectAgentJob({
      intent: starter.intent,
      label: starter.label,
      prompt: starter.prompt,
      icon: assistantStarterIcon(starter.id),
      subject: assignmentContext?.subject,
    });
  }

  function openCapabilityLibrary() {
    if (starterBlockReason) { setMessage(starterBlockReason); return; }
    const bounds = captureShell.current?.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(680, viewportWidth - 16, bounds?.width ?? 680);
    const left = viewportWidth <= 620
      ? 8
      : Math.max(12, Math.min((bounds?.left ?? 12) + ((bounds?.width ?? width) - width) / 2, viewportWidth - width - 12));
    const anchorTop = bounds?.top ?? Math.max(200, viewportHeight - 190);
    setCapabilityLibraryPosition({
      left,
      bottom: Math.max(12, viewportHeight - anchorTop + 10),
      width,
      maxHeight: Math.max(280, Math.min(590, anchorTop - 18)),
    });
    setCapabilityLibraryOpen(true);
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

  function applyAgentTurn(turn: AgentTurnSummary) {
    setAgentTurn(turn);
    if (!turn.conversationId || !turn.studentId) return;
    setConversationContext((current) => current
      ? { ...current, studentId: turn.studentId, subject: turn.subject ?? current.subject }
      : { studentId: turn.studentId, subject: turn.subject ?? undefined, taskName: turn.taskName });
  }

  function cancelAgentJob() {
    if (!agentJob) return;
    askDraft.current = text;
    setCapabilityLibraryOpen(false);
    setAgentJob(null); setText(recordDraft.current); setMessage(null); onFocusModeChange?.(false);
  }

  async function submitCurrent() {
    const inferredJob = !agentJob && inferredKlioRequest
      ? { intent: "general", label: isAssignmentGuidanceRequest(captureText) ? "Answering your question" : "Working with Klio", prompt: captureText, icon: Sparkles, expectedOutput: isAssignmentGuidanceRequest(captureText) ? "A clear answer grounded in your family workspace" : "A helpful answer or completed follow-through" } satisfies AgentJob
      : null;
    if (agentJob) await submitAgentJob();
    else if (inferredJob) await runAgentJob(inferredJob, captureText);
    else await submitCapture();
  }

  async function openAgentConversation(nextConversationId: string) {
    const response = await fetch(`/api/agent/turns?familyId=${encodeURIComponent(familyId)}&conversationId=${encodeURIComponent(nextConversationId)}`, { cache: "no-store" });
    const body = await response.json() as { turns?: AgentTurnSummary[]; conversation?: { id: string; studentId?: string | null; messages: Array<{ role: string; content: string; turnId?: string | null }> } | null; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Klio could not open that conversation.");
    const selectedTurn = body.turns?.[0];
    if (!selectedTurn || !body.conversation) throw new Error("That conversation is no longer available.");
    setConversationId(body.conversation.id);
    setConversationHistory(body.conversation.messages
      .filter((item) => item.turnId !== selectedTurn.id)
      .map((item) => ({ role: item.role === "user" ? "parent" : "klio", content: item.content, turnId: item.turnId })));
    setConversationContext({ studentId: selectedTurn.studentId ?? body.conversation.studentId ?? null, subject: selectedTurn.subject ?? undefined, taskName: selectedTurn.taskName });
    setAgentTurn(selectedTurn);
  }

  async function loadRecentConversations() {
    setConversationPickerLoading(true);
    setConversationPickerError(null);
    try {
      const response = await fetch(`/api/agent/turns?familyId=${encodeURIComponent(familyId)}`, { cache: "no-store" });
      const body = await response.json() as { conversations?: ConversationSummary[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Klio could not load your conversations.");
      setRecentConversations((body.conversations ?? []).slice(0, 10));
    } catch (error) {
      setConversationPickerError(error instanceof Error ? error.message : "Klio could not load your conversations.");
    } finally {
      setConversationPickerLoading(false);
    }
  }

  async function toggleConversationPicker() {
    if (conversationPickerOpen) {
      setConversationPickerOpen(false);
      return;
    }
    const button = conversationButton.current;
    if (button) {
      const bounds = button.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      setConversationPickerPosition({
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        bottom: Math.max(12, window.innerHeight - bounds.top + 10),
      });
    }
    setConversationPickerOpen(true);
    await loadRecentConversations();
  }

  async function selectRecentConversation(nextConversationId: string) {
    setConversationPickerOpen(false);
    try {
      await openAgentConversation(nextConversationId);
      // A finished conversation can be minimized while remaining the current
      // thread. Re-selecting it from history should reopen it just as selecting
      // any other thread does, so reset the conversation view's local state.
      setConversationViewVersion((version) => version + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Klio could not open that conversation.");
    }
  }

  function startNewAgentConversation() {
    setConversationPickerOpen(false);
    setConversationId(null);
    setConversationHistory([]);
    setConversationContext(null);
    setAgentTurn(null);
    onFocusModeChange?.(false);
    window.setTimeout(() => captureInput.current?.focus({ preventScroll: true }), 80);
  }

  async function submitAgentJob() {
    const request = text.trim();
    if (!request || busy || !agentJob) return;
    askDraft.current = "";
    await runAgentJob(agentJob, request, { afterStartText: recordDraft.current });
  }

  async function retryAgentTurn(turn: AgentTurnSummary) {
    const response = await fetch(`/api/agent/turns/${turn.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry" }) });
    if (!response.ok) { const result = await response.json(); setMessage(result.error ?? "Klio could not retry that handoff."); return; }
    setAgentTurn({ ...turn, status: "queued", normalizedStep: "waiting", lastHeartbeatAt: null, lastProgressAt: new Date().toISOString() });
    void refreshWhenTurnFinishes(turn.id, undefined, true);
  }

  async function dismissAgentTurn(turn: AgentTurnSummary) {
    setAgentTurn(null);
    const response = await fetch(`/api/agent/turns/${turn.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) });
    if (!response.ok) {
      setAgentTurn(turn);
      setMessage("Klio could not put that conversation away. Try again.");
    }
  }

  async function cancelAgentTurn(turn: AgentTurnSummary) {
    const response = await fetch(`/api/agent/turns/${turn.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
    const result = await response.json().catch(() => ({})) as { status?: string; error?: string };
    if (!response.ok) { setMessage(result.error ?? "Klio could not stop that job safely."); return; }
    setAgentTurn({ ...turn, status: result.status === "cancelled" ? "cancelled" : turn.status, normalizedStep: "paused" });
    setMessage(result.status === "cancelled" ? "Klio stopped the job. Your original handoff is safe." : "Klio is stopping at the next safe point.");
  }

  async function answerAgentTurn(turn: AgentTurnSummary, answer: string) {
    const response = await fetch(`/api/agent/turns/${turn.id}/clarification`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer, requestId: createClientUuid() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Klio could not save that answer.");
    const resumedAt = new Date().toISOString();
    setAgentTurn({ ...turn, id: result.resumedTurnId, status: "queued", clarification: null, result: null, normalizedStep: "waiting", createdAt: resumedAt, startedAt: null, lastHeartbeatAt: null, lastProgressAt: resumedAt });
    void refreshWhenTurnFinishes(result.resumedTurnId, undefined, true);
  }

  async function runAgentJob(job: AgentJob, request: string, options?: { studentId?: string | null; assignmentId?: string; preserveConversation?: boolean; afterStartText?: string }) {
    const requestId = createClientUuid();
    const targetStudentId = options?.studentId ?? captureStudentId;
    const targetAssignmentId = options?.assignmentId ?? assignmentContext?.id;
    if (!options?.preserveConversation) {
      setConversationId(null);
      setConversationHistory([]);
      setConversationContext({ studentId: targetStudentId || null, assignmentId: targetAssignmentId, subject: job.subject ?? assignmentContext?.subject, taskName: job.label || "Working with Klio" });
    }
    setBusy(true); setMessage(null);
    const queuedAt = new Date().toISOString();
    setAgentTurn({ id: requestId, status: "queued", goal: job.intent, request, result: null, clarification: null, events: [{ sequence: 1, kind: "turn.queued", label: "Received the handoff" }], tools: [], taskName: job.label || "Handling a family handoff", studentId: targetStudentId || null, subject: job.subject ?? assignmentContext?.subject ?? null, sourceCount: job.evidenceIds?.length ?? 0, normalizedStep: "waiting", expectedOutput: job.expectedOutput ?? "A useful response from Klio", createdAt: queuedAt, startedAt: null, lastHeartbeatAt: null, lastProgressAt: queuedAt, conversationId: options?.preserveConversation ? conversationId : null, interactionMode: "act", streamedMessage: null });
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, studentId: targetStudentId || null, evidenceIds: job.evidenceIds ?? [], intent: job.intent, request, requestId, contextDate: workspaceDate, assignmentId: targetAssignmentId, conversationId: options?.preserveConversation ? conversationId : undefined }) });
      const result = await response.json() as { turn?: { id: string }; conversationId?: string; interactionMode?: "answer" | "act"; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Klio could not start that job.");
      if (!result.turn?.id || !result.conversationId) throw new Error("Klio could not create a durable conversation.");
      setConversationId(result.conversationId);
      setAgentTurn((current) => current ? { ...current, id: result.turn!.id, conversationId: result.conversationId!, interactionMode: result.interactionMode ?? current.interactionMode } : current);
      setText(options?.afterStartText ?? ""); setAgentJob(null); captureInput.current?.blur(); onAssignmentContextClear?.(); onFocusModeChange?.(false);
      void refreshWhenTurnFinishes(result.turn.id, undefined, true, result.conversationId);
    } catch (caught) {
      setAgentTurn(null); setMessage(caught instanceof Error ? caught.message : "Klio could not start that job.");
    } finally { setBusy(false); }
  }

  async function followUpAgentTurn(turn: AgentTurnSummary, request: string) {
    if (!conversationId) {
      const prior: ConversationMessage[] = [{ role: "parent", content: parentVisibleRequest(turn.request), turnId: turn.id }, ...(turn.result?.message ? [{ role: "klio" as const, content: turn.result.message, turnId: turn.id }] : [])];
      setConversationHistory((current) => [...current, ...prior].slice(-20));
    }
    let evidenceIds: string[] = [];
    const namedStudentId = explicitlyMentionedStudentId(request, students);
    const attachmentStudentId = assignmentContext?.studentId ?? namedStudentId ?? (studentId || conversationContext?.studentId || turn.studentId || null);
    if (files.length) {
      if (!attachmentStudentId) throw new Error("Choose a learner for these attachments.");
      const body = new FormData();
      body.set("familyId", familyId);
      body.set("studentId", attachmentStudentId);
      body.set("kind", "note");
      body.set("intents", JSON.stringify([DEFAULT_CAPTURE_INTENT]));
      body.set("conversationAttachment", "true");
      if (request.trim()) body.set("text", request.trim());
      const targetAssignmentId = conversationContext?.assignmentId ?? assignmentContext?.id;
      if (targetAssignmentId) body.set("assignmentId", targetAssignmentId);
      files.forEach((file) => body.append("file", file));
      const upload = await fetch("/api/evidence", { method: "POST", body });
      const uploaded = await upload.json() as { ids?: string[]; id?: string; error?: string };
      if (!upload.ok) throw new Error(uploaded.error ?? "Klio could not attach those files.");
      evidenceIds = uploaded.ids ?? (uploaded.id ? [uploaded.id] : []);
    }
    await runAgentJob({ intent: "general", label: conversationContext?.taskName ?? "Continuing with Klio", prompt: request, icon: Sparkles, evidenceIds, expectedOutput: "A helpful answer or completed follow-through", subject: conversationContext?.subject ?? turn.subject ?? undefined }, request, { studentId: namedStudentId ?? attachmentStudentId ?? conversationContext?.studentId ?? turn.studentId, assignmentId: conversationContext?.assignmentId, preserveConversation: true });
    if (evidenceIds.length) setFiles([]);
  }

  async function submitCapture() {
    if ((!captureText && !files.length) || !captureStudentId || busy) return;
    setBusy(true); setMessage(null);
    const scheduleInstruction = Boolean(assignmentContext && isIncompleteUpdate(captureText));
    const body = new FormData();
    body.set("familyId", familyId); body.set("studentId", captureStudentId); body.set("kind", "note");
    if (assignmentContext) body.set("assignmentId", assignmentContext.id);
    body.set("intents", JSON.stringify([DEFAULT_CAPTURE_INTENT]));
    if (linkUrl.trim()) body.set("linkUrl", linkUrl.trim());
    // Keep the parent's words with the selected lesson even when the same handoff
    // also asks Klio to move it. The instruction is useful assignment context and
    // must not disappear after the schedule action succeeds.
    if (captureText) body.set("text", captureText);
    files.forEach((file) => body.append("file", file));
    try {
      let result: { ids?: string[]; id?: string; studentId?: string; job?: { id?: string }; turn?: { id?: string } } = {};
      const response = await fetch("/api/evidence", { method: "POST", body });
      result = await response.json();
      if (!response.ok) { setMessage((result as { error?: string }).error ?? "Klio could not save that capture."); return; }
      if (assignmentContext) {
        const linkedResponse = await fetch(scheduleInstruction ? "/api/adjustments" : `/api/assignments/${assignmentContext.id}/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(scheduleInstruction
            ? { familyId, studentId: assignmentContext.studentId, assignmentId: assignmentContext.id, idempotencyKey: `handoff:${createClientUuid()}` }
            : { evidenceIds: result.ids ?? [result.id], note: captureText || null }),
        });
        const linkedResult = await linkedResponse.json();
        if (!linkedResponse.ok) { setMessage(linkedResult.error ?? "The work was saved, but Klio could not attach it to the lesson."); return; }
        if (scheduleInstruction && !linkedResult.applied) {
          const applyResponse = await fetch(`/api/adjustments/${linkedResult.proposal.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision: "approve" }),
          });
          const applyResult = await applyResponse.json();
          if (!applyResponse.ok) { setMessage(applyResult.error ?? "Klio drafted the change but could not update the week."); return; }
        }
        if (linkedResult.turn?.id) {
          const queuedAt = new Date().toISOString();
          setAgentTurn({ id: linkedResult.turn.id, status: "queued", goal: "general", request: captureText, result: null, clarification: null, events: [{ sequence: 1, kind: "turn.queued", label: "Received the handoff" }], tools: [], taskName: `Following up on ${assignmentContext.title}`, studentId: assignmentContext.studentId, subject: assignmentContext.subject, sourceCount: result.ids?.length ?? (result.id ? 1 : files.length), normalizedStep: "waiting", expectedOutput: "Grounded support, a safe workspace change, or one precise question", createdAt: queuedAt, startedAt: null, lastHeartbeatAt: null, lastProgressAt: queuedAt, conversationId: null, interactionMode: "act", streamedMessage: null });
          void refreshWhenTurnFinishes(linkedResult.turn.id, result.id, true);
        }
        recordDraft.current = ""; setText(""); setLinkUrl(""); setLinkOpen(false); setFiles([]); onAssignmentContextClear?.();
        setMessage(linkedResult.turn?.id
          ? linkedResult.outcome === "completed" || linkedResult.completionRecorded
            ? `${assignmentContext.title} is complete. Klio is working through the requested follow-up.`
            : `Saved with ${assignmentContext.title}. Klio is working through the requested follow-up.`
          : scheduleInstruction
          ? `Week updated. ${linkedResult.proposal.summary}`
          : linkedResult.outcome === "comment"
            ? `Note added to ${assignmentContext.title}. Klio will keep it with this lesson.`
            : linkedResult.outcome === "completed"
            ? `${assignmentContext.title} marked complete. The note was filed in ${assignmentContext.subject}.`
            : linkedResult.completionRecorded
              ? `${assignmentContext.title} is complete and the submitted work is ready for review.`
              : `${assignmentContext.title} is filed and ready for review.`);
        router.refresh();
        return;
      }
      if (result.studentId && result.studentId !== studentId) selectCaptureStudent(result.studentId);
      if (result.turn?.id) {
        const queuedAt = new Date().toISOString();
        setAgentTurn({ id: result.turn.id, status: "queued", goal: "capture", request: captureText || "Review submitted work", result: null, clarification: null, events: [{ sequence: 1, kind: "turn.queued", label: "Received the handoff" }], tools: [], taskName: captureText ? `Handling ${studentNames.get(captureStudentId) ?? "learner"}’s learning update` : "Reviewing submitted work", studentId: captureStudentId, subject: null, sourceCount: result.ids?.length ?? (result.id ? 1 : files.length), normalizedStep: "waiting", expectedOutput: "A concise update about what Klio changed", createdAt: queuedAt, startedAt: null, lastHeartbeatAt: null, lastProgressAt: queuedAt, conversationId: null, interactionMode: "act", streamedMessage: null });
      }
      recordDraft.current = ""; setText(""); setLinkUrl(""); setLinkOpen(false); setFiles([]);
      setMessage("Saved. Klio is putting it away.");
      router.refresh();
      if (result.job?.id && result.id) void refreshWhenJobFinishes(result.job.id, result.id);
      if (result.turn?.id) void refreshWhenTurnFinishes(result.turn.id, result.id, true);
    } catch { setMessage("Klio could not save that capture. Try again."); }
    finally { setBusy(false); }
  }

  async function refreshWhenTurnFinishes(turnId: string, evidenceId?: string, showProgress = false, activeConversationId?: string) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      await delay(1500);
      try {
        const response = await fetch(`/api/agent/turns?familyId=${familyId}${activeConversationId ? `&conversationId=${encodeURIComponent(activeConversationId)}` : ""}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        const turn = body.turns?.find((item: AgentTurnSummary) => item.id === turnId) as AgentTurnSummary | undefined;
        if (body.conversation?.id) {
          setConversationId(body.conversation.id);
          setConversationHistory((body.conversation.messages ?? []).filter((item: { turnId?: string | null }) => item.turnId !== turnId).map((item: { role: string; content: string; turnId?: string | null }) => ({ role: item.role === "user" ? "parent" : "klio", content: item.content, turnId: item.turnId })));
        }
        if (turn && showProgress) applyAgentTurn(turn);
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

  function clearRecordingTimers() {
    if (recordingTimer.current !== null) window.clearInterval(recordingTimer.current);
    if (recordingDeadline.current !== null) window.clearTimeout(recordingDeadline.current);
    recordingTimer.current = null;
    recordingDeadline.current = null;
  }

  function stopRecording() {
    const activeRecorder = recorder.current;
    if (!activeRecorder || activeRecorder.state === "inactive") return;
    clearRecordingTimers();
    setVoicePhase("transcribing");
    setVoiceMessage("Turning your recording into text…");
    activeRecorder.stop();
  }

  function showVoiceResult(phase: Extract<VoicePhase, "done" | "error">, status: string) {
    setVoicePhase(phase);
    setVoiceMessage(status);
    if (voiceResetTimer.current !== null) window.clearTimeout(voiceResetTimer.current);
    voiceResetTimer.current = window.setTimeout(() => {
      setVoicePhase("idle");
      setVoiceMessage("");
      voiceResetTimer.current = null;
    }, phase === "done" ? 2_500 : 5_000);
  }

  async function transcribeRecording(blob: Blob) {
    const validationError = dictationValidationError(blob);
    if (validationError) { showVoiceResult("error", validationError); return; }
    const request = new AbortController();
    transcriptionRequest.current = request;
    const body = new FormData();
    body.set("file", new File([blob], dictationFileName(blob.type), { type: blob.type }));
    try {
      const response = await fetch("/api/transcribe", { method: "POST", body, signal: request.signal });
      const result = await response.json() as { text?: string; error?: string };
      if (!response.ok || !result.text) throw new Error(result.error ?? "I couldn’t transcribe that recording.");
      if (!mounted.current) return;
      setText((current) => appendDictationText(current, result.text!));
      showVoiceResult("done", "Added to your draft. You can edit it before sending.");
    } catch (error) {
      if (!mounted.current || request.signal.aborted) return;
      showVoiceResult("error", error instanceof Error ? error.message : "I couldn’t transcribe that recording. Try again.");
    } finally {
      if (transcriptionRequest.current === request) transcriptionRequest.current = null;
    }
  }

  async function toggleRecording() {
    if (voicePhase === "recording") { stopRecording(); return; }
    if (voicePhase === "requesting" || voicePhase === "transcribing") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showVoiceResult("error", "Voice input isn’t supported in this browser.");
      return;
    }
    try {
      if (voiceResetTimer.current !== null) window.clearTimeout(voiceResetTimer.current);
      setVoicePhase("requesting");
      setVoiceMessage("Requesting microphone access…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const mediaRecorder = new MediaRecorder(stream);
      chunks.current = [];
      recordingStream.current = stream;
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
      mediaRecorder.onerror = () => {
        mediaRecorder.onstop = null;
        clearRecordingTimers();
        stream.getTracks().forEach((track) => track.stop());
        recordingStream.current = null;
        recorder.current = null;
        showVoiceResult("error", "Recording stopped unexpectedly. Try again.");
      };
      mediaRecorder.onstop = () => {
        clearRecordingTimers();
        stream.getTracks().forEach((track) => track.stop());
        recordingStream.current = null;
        recorder.current = null;
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        chunks.current = [];
        if (mounted.current) void transcribeRecording(blob);
      };
      recorder.current = mediaRecorder;
      mediaRecorder.start();
      const startedAt = Date.now();
      setVoiceSeconds(0);
      setVoicePhase("recording");
      setVoiceMessage("Listening… tap Stop when you’re done.");
      recordingTimer.current = window.setInterval(() => setVoiceSeconds(Math.floor((Date.now() - startedAt) / 1_000)), 250);
      recordingDeadline.current = window.setTimeout(stopRecording, MAX_DICTATION_SECONDS * 1_000);
    } catch {
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      recordingStream.current = null;
      recorder.current = null;
      showVoiceResult("error", "Allow microphone access to use voice input.");
    }
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
  const conversationComposer: ConversationComposer = {
    text,
    files,
    studentId,
    recording,
    voicePhase,
    voiceSeconds,
    voiceMessage,
    onTextChange: handleTextChange,
    onStudentChange: selectCaptureStudent,
    onPhoto: () => imageInput.current?.click(),
    onFile: () => fileInput.current?.click(),
    onVoice: () => { void toggleRecording(); },
    onScore: () => setText((current) => current || `${studentNames.get(studentId) ?? "The learner"} scored `),
    onRemoveFile: (index) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index)),
    onPaste: pasteImages,
  };
  const conversationPickerPortal = conversationPickerOpen && typeof document !== "undefined" ? createPortal(
    <section
      ref={conversationPicker}
      className="conversation-history-picker"
      role="dialog"
      aria-modal="false"
      aria-labelledby="conversation-history-title"
      style={conversationPickerPosition}
    >
      <header>
        <div><strong id="conversation-history-title">Recent conversations</strong><span>Your last 10 threads with Klio</span></div>
        <button type="button" className="conversation-history-new" onClick={startNewAgentConversation}><Plus size={14} />New</button>
      </header>
      <div className="conversation-history-list">
        {conversationPickerLoading ? <div className="conversation-history-loading" aria-label="Loading conversations"><i /><i /><i /><span>Loading conversations</span></div> : null}
        {!conversationPickerLoading && conversationPickerError ? <div className="conversation-history-state" role="alert"><strong>Couldn’t load conversations</strong><span>{conversationPickerError}</span><button type="button" onClick={() => void loadRecentConversations()}>Try again</button></div> : null}
        {!conversationPickerLoading && !conversationPickerError && !recentConversations.length ? <div className="conversation-history-state"><strong>No conversations yet</strong><span>Tell Klio what you need to start one.</span><button type="button" onClick={startNewAgentConversation}>Start a conversation</button></div> : null}
        {!conversationPickerLoading && !conversationPickerError ? recentConversations.map((conversation) => {
          const learner = conversation.studentId ? studentNames.get(conversation.studentId) ?? "Learner" : "Family";
          const selected = conversation.id === conversationId;
          return <button type="button" className={selected ? "selected" : ""} onClick={() => void selectRecentConversation(conversation.id)} key={conversation.id}>
            <span className="conversation-history-copy"><strong>{conversation.title}</strong><small>{learner} · {formatConversationAge(conversation.updatedAt)}</small></span>
            {selected ? <Check size={15} aria-label="Current conversation" /> : null}
          </button>;
        }) : null}
      </div>
    </section>,
    document.body,
  ) : null;
  const conversationHistoryButton = <button ref={conversationButton} type="button" onClick={() => void toggleConversationPicker()} aria-label="Open conversations" aria-haspopup="dialog" aria-expanded={conversationPickerOpen}><MessagesSquare size={17} />Conversations</button>;
  const capabilityLibraryPortal = capabilityLibraryOpen && typeof document !== "undefined" ? createPortal(
    <section
      ref={capabilityLibraryPanel}
      id={CAPABILITY_LIBRARY_ID}
      className="assistant-capability-library"
      role="dialog"
      aria-modal="false"
      aria-labelledby="assistant-capability-title"
      style={capabilityLibraryPosition}
    >
      <header>
        <div><span>Ask Klio</span><h2 id="assistant-capability-title">Start with an outcome</h2><p>Choose a starting point, then make the request your own.</p></div>
        <button type="button" className="assistant-capability-close" onClick={() => { setCapabilityLibraryOpen(false); capabilityLibraryButton.current?.focus({ preventScroll: true }); }} aria-label="Close everything Klio can do"><X size={16} /></button>
      </header>
      <div className="assistant-capability-groups">
        {assistantStarterGroups.map((group) => <section aria-labelledby={`assistant-capability-${group.id}`} key={group.id}>
          <h3 id={`assistant-capability-${group.id}`}>{group.label}</h3>
          <div>{assistantStarters.filter((starter) => starter.groupId === group.id).map((starter) => {
            const Icon = assistantStarterIcon(starter.id);
            const disabledReason = starter.disabledReason ?? starterBlockReason;
            return <button type="button" className="assistant-capability-row" onClick={() => selectAssistantStarter(starter)} disabled={starter.disabled || Boolean(starterBlockReason)} key={starter.id}>
              <span className="assistant-capability-icon" aria-hidden="true"><Icon size={16} /></span>
              <span className="assistant-capability-copy"><strong>{starter.label}</strong><small>{starter.detail}</small></span>
              <span className={`assistant-capability-state ${disabledReason ? "disabled" : ""}`}>{disabledReason ?? <ArrowRight size={15} />}</span>
            </button>;
          })}</div>
        </section>)}
      </div>
      <footer><FileCheck2 size={14} /><p>Uses current family records. Grades, curriculum changes, and major schedule changes still wait for you.</p></footer>
    </section>,
    document.body,
  ) : null;

  if (compact) return (
    <section ref={captureShell} className={`week-capture ${dashboard ? "day-dashboard-capture" : ""}`} aria-labelledby={dashboard ? undefined : "week-capture-title"} onFocus={() => onFocusModeChange?.(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusModeChange?.(false); }}>
      <header className="handoff-heading"><div><span>Hand something to Klio</span>{!dashboard ? <h2 id="week-capture-title">A lesson, score, file, or note</h2> : null}</div><small>Klio handles the follow-through</small></header>
      <section className="compact-agent-discovery" aria-labelledby="compact-agent-starters-title">
        <header><span id="compact-agent-starters-title">Suggestions</span></header>
        <div className="compact-agent-starter-list">{topAssistantStarters.map((starter) => { const Icon = assistantStarterIcon(starter.id); return <button type="button" onClick={() => selectAssistantStarter(starter)} disabled={starter.disabled || Boolean(starterBlockReason)} title={starter.disabledReason ?? starterBlockReason ?? starter.detail} key={starter.id}><Icon size={14} aria-hidden="true" /><span>{assistantStarterShortLabel(starter.id, starterContext)}</span></button>; })}</div>
        <footer className="compact-agent-discovery-footer"><button ref={capabilityLibraryButton} type="button" className="compact-agent-library-trigger" onClick={openCapabilityLibrary} aria-label="See everything Klio can do" aria-expanded={capabilityLibraryOpen} aria-controls={CAPABILITY_LIBRARY_ID} disabled={Boolean(starterBlockReason)}>More <ArrowRight size={13} /></button></footer>
        {starterBlockReason ? <p>{starterBlockReason}</p> : null}
      </section>
      <section className={`quiet-capture ${assignmentContext ? "assignment-context-mode" : ""}`} aria-label="Hand something to Klio" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }} onDragLeave={(event) => event.currentTarget.classList.remove("dragging")} onDrop={handleCaptureDrop}>
        {assignmentContext ? <motion.div className="quiet-assignment-context" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}><FileCheck2 size={14} /><span><small>Working with</small><strong>{assignmentContext.title}</strong></span>{!agentJob ? <button type="button" onClick={onAssignmentContextClear} aria-label={`Remove ${assignmentContext.title}`}><X size={13} /></button> : null}</motion.div> : null}
        <textarea className={assignmentContext ? "assignment-context-textarea" : undefined} ref={captureInput} rows={assignmentContext ? 4 : undefined} value={text} onChange={(event) => handleTextChange(event.target.value)} onContextMenu={openSpellingMenu} onPaste={agentJob ? undefined : pasteImages} placeholder={assignmentContext ? "Ask about this lesson, add a result, or tell Klio what changed…" : "Tell Klio what happened or what you need…"} aria-label="Hand something to Klio" lang="en" spellCheck autoCorrect="on" autoCapitalize="sentences" />
        {spellingAssist}
        <VoiceDictationFeedback phase={voicePhase} seconds={voiceSeconds} message={voiceMessage} onStop={recording ? stopRecording : undefined} />
        <div className="quiet-attachments"><AnimatePresence>{files.map((file, index) => <motion.div layout key={`${file.name}-${file.size}-${index}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}><span>{fileIcon(file)}{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></motion.div>)}</AnimatePresence></div>
        <AnimatePresence>{linkOpen ? <motion.label className="quiet-link reference-link" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Link2 size={15} /><span><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="Save a reference link" type="url" autoFocus /><small>Klio saves this address but does not open or read the page.</small></span><button type="button" onClick={() => { setLinkOpen(false); setLinkUrl(""); }} aria-label="Remove link"><X size={14} /></button></motion.label> : null}</AnimatePresence>
        <footer>
          <input ref={imageInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <input ref={fileInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          {!agentJob ? <div className="quiet-tools">{conversationHistoryButton}<button type="button" onClick={() => imageInput.current?.click()}><Camera size={17} />Photo</button>{!recording ? <button type="button" className={voicePending ? "transcribing" : ""} onClick={toggleRecording} disabled={voicePending} aria-describedby="voice-transcription-disclosure" aria-label={voicePhase === "requesting" ? "Starting voice input" : voicePhase === "transcribing" ? "Transcribing voice input" : "Start voice input"}>{voicePending ? <LoaderCircle className="spin" size={16} /> : <Mic size={17} />}{voicePhase === "requesting" ? "Starting" : voicePhase === "transcribing" ? "Transcribing" : "Voice"}</button> : null}<button type="button" onClick={() => fileInput.current?.click()}><Paperclip size={17} />File</button><button type="button" onClick={() => setText((current) => current || `${studentNames.get(captureStudentId) ?? "The learner"} scored `)}><FileText size={17} />Score</button></div> : null}
          <label className={`capture-for ${assignmentContext ? "locked" : ""}`}><span>For</span><select value={assignmentContext?.studentId ?? studentId} onChange={(event) => selectCaptureStudent(event.target.value)} aria-label="Learner for this handoff" disabled={Boolean(assignmentContext)}><option value="">Family</option>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
          <button type="button" className="quiet-save" aria-label="Send to Klio" onClick={() => void submitCurrent()} disabled={!canSubmit}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={18} />}</button>
          {!agentJob ? <VoiceTranscriptionDisclosure /> : null}
        </footer>
          <AnimatePresence mode="wait">{agentTurn ? <InlineAgentTurn key={`${agentTurn.id}:${conversationViewVersion}`} concise composer={conversationComposer} familyId={familyId} students={students} history={conversationHistory} turn={agentTurn} artifacts={initialArtifacts} learnerName={agentTurn.studentId ? studentNames.get(agentTurn.studentId) : undefined} onDismiss={() => void dismissAgentTurn(agentTurn)} onCancel={() => void cancelAgentTurn(agentTurn)} onAnswer={(answer) => answerAgentTurn(agentTurn, answer)} onFollowUp={(request) => followUpAgentTurn(agentTurn, request)} onConversationSelect={openAgentConversation} onNewConversation={startNewAgentConversation} onPracticeOpen={onPracticeOpen} onRetry={() => void retryAgentTurn(agentTurn)} /> : null}</AnimatePresence>
      </section>
      <AnimatePresence>{message ? <motion.p className="quiet-message" role="status" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{message}</motion.p> : null}</AnimatePresence>
      {spellingMenuPortal}
      {conversationPickerPortal}
      {capabilityLibraryPortal}
    </section>
  );

  return (
    <main className="quiet-home">
      <section className={`quiet-capture ${agentJob ? "agent-job-mode" : ""} ${assignmentContext ? "assignment-context-mode" : ""}`} aria-label={agentJob ? "Give Klio a job" : "Capture learning"} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }} onDragLeave={(event) => event.currentTarget.classList.remove("dragging")} onDrop={handleCaptureDrop}>
        {assignmentContext && !agentJob ? <motion.div className="quiet-assignment-context" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}><FileCheck2 size={14} /><span><small>Working with</small><strong>{assignmentContext.title}</strong></span><button type="button" onClick={onAssignmentContextClear} aria-label={`Remove ${assignmentContext.title}`}><X size={13} /></button></motion.div> : null}
        <textarea ref={captureInput} rows={assignmentContext ? 4 : undefined} value={text} onChange={(event) => handleTextChange(event.target.value)} onContextMenu={openSpellingMenu} onPaste={agentJob ? undefined : pasteImages} placeholder={agentJob ? "What should Klio take care of?" : assignmentContext ? "Add a score, note, photo, or tell Klio what changed…" : "What happened in learning today?"} aria-label={agentJob ? "What should Klio take care of?" : "What happened in learning today?"} lang="en" spellCheck autoCorrect="on" autoCapitalize="sentences" />
        {spellingAssist}
        <VoiceDictationFeedback phase={voicePhase} seconds={voiceSeconds} message={voiceMessage} onStop={recording ? stopRecording : undefined} />
        {agentJob ? <div className="quiet-job-mode"><Sparkles size={13} /><span>{agentJob.label}</span><button type="button" onClick={cancelAgentJob} aria-label="Return to learning capture"><X size={13} /></button></div> : null}
        <div className="quiet-attachments"><AnimatePresence>{files.map((file, index) => <motion.div layout key={`${file.name}-${file.size}-${index}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}><span>{fileIcon(file)}{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></motion.div>)}</AnimatePresence></div>
        <AnimatePresence>{linkOpen ? <motion.label className="quiet-link reference-link" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Link2 size={15} /><span><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="Save a reference link" type="url" autoFocus /><small>Klio saves this address but does not open or read the page.</small></span><button type="button" onClick={() => { setLinkOpen(false); setLinkUrl(""); }} aria-label="Remove link"><X size={14} /></button></motion.label> : null}</AnimatePresence>
        <p className={`capture-interpretation ${!targetName ? "needs-target" : ""}`}>{sendInterpretation}</p>
        <footer>
          <input ref={imageInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <input ref={fileInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,text/csv" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          {agentJob ? <div className="quiet-agent-context"><Sparkles size={14} /><span>Using current family records</span></div> : <div className="quiet-tools">{conversationHistoryButton}<button type="button" onClick={() => imageInput.current?.click()}><Camera size={17} />Photo</button>{!recording ? <button type="button" className={voicePending ? "transcribing" : ""} onClick={toggleRecording} disabled={voicePending} aria-describedby="voice-transcription-disclosure" aria-label={voicePhase === "requesting" ? "Starting voice input" : voicePhase === "transcribing" ? "Transcribing voice input" : "Start voice input"}>{voicePending ? <LoaderCircle className="spin" size={16} /> : <Mic size={17} />}{voicePhase === "requesting" ? "Starting" : voicePhase === "transcribing" ? "Transcribing" : "Voice"}</button> : null}<button type="button" onClick={() => fileInput.current?.click()}><Paperclip size={17} />File</button><button type="button" onClick={() => setLinkOpen((open) => !open)}><Link2 size={17} />Link</button></div>}
          <label className="capture-for"><span>For</span><select value={studentId} onChange={(event) => selectCaptureStudent(event.target.value)} aria-label="Selected child"><option value="">{agentJob ? "Family" : "Choose learner…"}</option>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
          <button type="button" className="quiet-save" aria-label={agentJob ? "Give this job to Klio" : "Save to Klio"} onClick={() => void submitCurrent()} disabled={!canSubmit}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={18} />}</button>
          {!agentJob ? <VoiceTranscriptionDisclosure /> : null}
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
      <AnimatePresence mode="wait">{agentTurn ? <InlineAgentTurn key={`${agentTurn.id}:${conversationViewVersion}`} concise composer={conversationComposer} familyId={familyId} students={students} history={conversationHistory} turn={agentTurn} artifacts={initialArtifacts} learnerName={agentTurn.studentId ? studentNames.get(agentTurn.studentId) : undefined} onDismiss={() => void dismissAgentTurn(agentTurn)} onCancel={() => void cancelAgentTurn(agentTurn)} onAnswer={(answer) => answerAgentTurn(agentTurn, answer)} onFollowUp={(request) => followUpAgentTurn(agentTurn, request)} onConversationSelect={openAgentConversation} onNewConversation={startNewAgentConversation} onRetry={() => void retryAgentTurn(agentTurn)} /> : null}</AnimatePresence>
      <AnimatePresence>{message ? <motion.p className="quiet-message" role="status" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{message}</motion.p> : null}</AnimatePresence>
      {spellingMenuPortal}
      {conversationPickerPortal}
      {capabilityLibraryPortal}

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

function VoiceDictationFeedback({ phase, seconds, message, onStop }: { phase: VoicePhase; seconds: number; message: string; onStop?: () => void }) {
  if (phase === "idle") return null;
  if (phase === "error") return <p className="voice-dictation-feedback error" role="alert"><span aria-hidden="true"><X size={13} /></span><strong>Voice input stopped</strong><small>{message}</small></p>;
  if (phase === "done") return <p className="voice-dictation-feedback done" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true"><Check size={13} /></span><strong>Voice added</strong><small>{message}</small></p>;
  const label = phase === "requesting" ? "Starting microphone" : phase === "recording" ? "Recording" : "Transcribing";
  return <div className={`voice-dictation-feedback ${phase}`} role="status" aria-live="polite" aria-label={`${label}${phase === "recording" ? `, ${formatDictationDuration(seconds)}` : ""}. ${message}`}>
    <span className="voice-recording-meta"><i aria-hidden="true" /><strong>{label}</strong>{phase === "recording" ? <time>{formatDictationDuration(seconds)}</time> : null}</span>
    <span className="voice-waveform" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</span>
    {phase === "recording" && onStop ? <button type="button" onClick={onStop} aria-label="Stop recording"><Square size={11} fill="currentColor" />Stop</button> : <span className="voice-processing-label">{phase === "requesting" ? "Connecting" : "Preparing text"}</span>}
  </div>;
}

function VoiceTranscriptionDisclosure() {
  return <small className="voice-transcription-disclosure" id="voice-transcription-disclosure">Voice is sent to OpenAI for transcription when recording stops. <Link href="/privacy">Privacy</Link></small>;
}

function InlineAgentTurn({ turn, artifacts, composer, familyId, students = [], learnerName, history = [], concise = false, onDismiss, onCancel, onAnswer, onFollowUp, onConversationSelect, onNewConversation, onPracticeOpen, onRetry }: { turn: AgentTurnSummary; artifacts: ArtifactDTO[]; composer?: ConversationComposer; familyId?: string; students?: StudentDTO[]; learnerName?: string; history?: ConversationMessage[]; concise?: boolean; onDismiss: () => void; onCancel?: () => void; onAnswer?: (answer: string) => Promise<void>; onFollowUp?: (request: string) => Promise<void>; onConversationSelect?: (conversationId: string) => Promise<void>; onNewConversation?: () => void; onPracticeOpen?: (artifactId: string) => void; onRetry: () => void }) {
  const [now, setNow] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [minimizedTurnId, setMinimizedTurnId] = useState<string | null>(null);
  const minimized = minimizedTurnId === turn.id;
  const portalReady = useSyncExternalStore(subscribeToClientMount, () => true, () => false);
  useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = window.setInterval(update, 10_000); return () => window.clearInterval(timer); }, []);
  const receiptState = now === null ? turn.status : deriveReceiptState({ status: turn.status, createdAt: turn.createdAt, lastHeartbeatAt: turn.lastHeartbeatAt, now });
  const stale = receiptState === "paused";
  const active = turn.status === "running" && !stale;
  const queued = turn.status === "queued" && !stale;
  // A raw worker status is not a parent question. Only surface the blocking
  // state when the bounded clarification tool produced an answerable prompt.
  const awaitingParent = turn.status === "awaiting_parent" && Boolean(turn.clarification);
  const failed = turn.status === "failed";
  const steps = receiptSteps(turn.normalizedStep, turn.status, stale);
  async function submitAnswer() {
    if (!onAnswer || !answer.trim() || answering) return;
    setAnswering(true); setAnswerError(null);
    try { await onAnswer(answer.trim()); }
    catch (error) { setAnswerError(error instanceof Error ? error.message : "Klio could not save that answer."); setAnswering(false); }
  }
  if (concise) {
    if (minimized) {
      // Finished conversation is continued through the universal composer.
      // Only live or blocked work needs a second, persistent status surface.
      if (!active && !queued && !awaitingParent && !failed && !stale) return null;
      return <aside className="klio-minimized" aria-live="polite"><button type="button" onClick={() => setMinimizedTurnId(null)}><span className={active || queued ? "working" : ""}><Sparkles size={15} /></span><span><strong>{awaitingParent ? "Klio needs one detail" : failed || stale ? "Klio paused" : active ? "Klio is working" : "Waiting to begin"}</strong><small>{turn.taskName}</small></span><ArrowRight size={16} /></button>{(active || queued) && onCancel ? <button type="button" className="klio-minimized-cancel" onClick={onCancel}>Cancel</button> : null}</aside>;
    }
    if (!portalReady) return null;
    return createPortal(
    <><button type="button" tabIndex={-1} className="klio-conversation-backdrop" onClick={() => setMinimizedTurnId(turn.id)} aria-label="Minimize Klio and return to the workspace" /><AgentConversation turn={turn} artifacts={artifacts} composer={composer} familyId={familyId} students={students} now={now} learnerName={learnerName} history={history} stale={stale} active={active} queued={queued} awaitingParent={awaitingParent} failed={failed} answer={answer} answering={answering} answerError={answerError} setAnswer={setAnswer} submitAnswer={submitAnswer} onMinimize={() => setMinimizedTurnId(turn.id)} onCancel={onCancel} onFollowUp={onFollowUp} onConversationSelect={onConversationSelect} onNewConversation={onNewConversation} onPracticeOpen={onPracticeOpen} onRetry={onRetry} /></>,
    document.body,
  );
  }
  return <motion.section className={`quiet-agent-turn work-receipt ${active ? "working" : ""} ${failed || stale ? "failed" : ""}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
    <span className="quiet-agent-mark"><Sparkles size={14} /></span>
    <div><header><div><small>{stale ? "Klio paused" : "On Klio’s desk"}</small><strong>{turn.taskName}</strong><p>{[learnerName, turn.subject, turn.sourceCount ? `${turn.sourceCount} ${turn.sourceCount === 1 ? "source" : "sources"}` : null].filter(Boolean).join(" · ")}</p></div>{!active && !queued && !awaitingParent ? <button type="button" onClick={onDismiss} aria-label="Dismiss Klio result"><X size={13} /></button> : null}</header>
      <div className="receipt-state"><b>{stale ? "This job stopped before finishing." : queued ? "Waiting to start" : active ? receiptStepLabel(turn.normalizedStep) : awaitingParent ? "Waiting for one detail" : failed ? "Could not finish" : "Finished"}</b><span>{stale ? "Your original work is safe." : timeLabel(turn.lastProgressAt ?? turn.createdAt, queued ? "Added" : "Last activity", now)}</span></div>
      <ol>{steps.map((step) => <li className={step.state} key={step.label}>{step.state === "current" && active ? <LoaderCircle className="spin" size={12} /> : step.state === "done" ? <Check size={12} /> : <Circle size={10} />}<span>{step.label}</span></li>)}</ol>
      {turn.result?.message ? <p>{turn.result.message}</p> : null}
      {turn.result && !concise ? <ReceiptDetails result={turn.result} artifacts={artifacts} /> : null}
      {awaitingParent && turn.clarification ? <div className="receipt-clarification"><label htmlFor={`clarification-${turn.id}`}>{turn.clarification.question}</label><textarea id={`clarification-${turn.id}`} value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={4000} rows={3} autoFocus /><div><button type="button" onClick={() => void submitAnswer()} disabled={!answer.trim() || answering}>{answering ? <LoaderCircle className="spin" size={13} /> : null}Continue</button>{onCancel ? <button type="button" onClick={onCancel} disabled={answering}>Cancel task</button> : null}</div>{answerError ? <p role="alert">{answerError}</p> : null}</div> : null}
      {turn.expectedOutput && (active || queued) ? <p className="receipt-output"><b>When finished:</b> {parentFacingExpectedOutput(turn.expectedOutput)}</p> : null}
      {turn.result?.actions.length ? <ReceiptActions actions={turn.result.actions} artifacts={artifacts} /> : null}
      <footer>{queued && onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}{failed || stale ? <button type="button" className="quiet-agent-retry" onClick={onRetry}>Retry</button> : null}</footer>
    </div>
  </motion.section>;
}

function AgentConversation({ turn, artifacts, composer, familyId, students, now, learnerName, history, stale, active, queued, awaitingParent, failed, answer, answering, answerError, setAnswer, submitAnswer, onMinimize, onCancel, onFollowUp, onConversationSelect, onNewConversation, onPracticeOpen, onRetry }: {
  turn: AgentTurnSummary; artifacts: ArtifactDTO[]; composer?: ConversationComposer; familyId?: string; students: StudentDTO[]; now: number | null; learnerName?: string; history: ConversationMessage[];
  stale: boolean; active: boolean; queued: boolean; awaitingParent: boolean; failed: boolean;
  answer: string; answering: boolean; answerError: string | null; setAnswer: (value: string) => void; submitAnswer: () => Promise<void>;
  onMinimize: () => void; onCancel?: () => void; onFollowUp?: (request: string) => Promise<void>; onConversationSelect?: (conversationId: string) => Promise<void>; onNewConversation?: () => void; onPracticeOpen?: (artifactId: string) => void; onRetry: () => void;
}) {
  const [localFollowUp, setLocalFollowUp] = useState("");
  const [followingUp, setFollowingUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [workTurns, setWorkTurns] = useState<AgentTurnSummary[]>([turn]);
  const [workLoading, setWorkLoading] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [switchingConversationId, setSwitchingConversationId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const positionedResponse = useRef<string | null>(null);
  const response = turn.streamedMessage ?? turn.result?.message;
  const followUp = composer?.text ?? localFollowUp;
  const attachedFiles = composer?.files ?? [];
  const composerVoicePending = composer?.voicePhase === "requesting" || composer?.voicePhase === "transcribing";
  const changeFollowUp = (value: string) => composer ? composer.onTextChange(value) : setLocalFollowUp(value);
  const status = stale ? "Paused — your original request is safe" : queued ? "Thinking" : active ? conversationProgressLabel(turn) : awaitingParent ? "Klio needs one detail" : failed ? "Klio could not finish" : "Done";
  useEffect(() => { dialogRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const minimizeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onMinimize(); };
    window.addEventListener("keydown", minimizeOnEscape);
    return () => window.removeEventListener("keydown", minimizeOnEscape);
  }, [onMinimize]);
  useEffect(() => {
    const scroller = scrollRef.current;
    const stream = scroller?.firstElementChild;
    if (!scroller || !stream) return;
    const frame = requestAnimationFrame(() => {
      const latest = stream.lastElementChild as HTMLElement | null;
      if (!latest) return;
      if (active || queued) {
        const distanceFromBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
        if (distanceFromBottom < 90) scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      if (!response || positionedResponse.current === response) return;
      positionedResponse.current = response;
      scroller.scrollTop = completedConversationScrollTarget({
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        latestOffsetTop: latest.offsetTop,
        latestHeight: latest.offsetHeight,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, history.length, queued, response]);
  useEffect(() => {
    if (!familyId) return;
    const controller = new AbortController();
    async function loadWork() {
      setWorkLoading(true);
      try {
        const response = await fetch(`/api/agent/turns?familyId=${encodeURIComponent(familyId!)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json() as { turns?: AgentTurnSummary[]; conversations?: ConversationSummary[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Klio’s work could not be loaded.");
        setWorkTurns(body.turns ?? []);
        setConversations(body.conversations ?? []);
        setWorkError(null);
      } catch (error) {
        if (!controller.signal.aborted) setWorkError(error instanceof Error ? error.message : "Klio’s work could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setWorkLoading(false);
      }
    }
    void loadWork();
    const timer = window.setInterval(() => void loadWork(), 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [familyId]);
  async function sendFollowUp() {
    if (!onFollowUp || (!followUp.trim() && !attachedFiles.length) || followingUp) return;
    setFollowingUp(true); setFollowUpError(null);
    try {
      await onFollowUp(followUp.trim() || "Review the attached work and help me with the next step.");
      changeFollowUp("");
    } catch (error) {
      setFollowUpError(error instanceof Error ? error.message : "Klio could not send that handoff.");
    } finally { setFollowingUp(false); }
  }
  async function switchConversation(nextConversationId: string) {
    if (!onConversationSelect || nextConversationId === turn.conversationId || switchingConversationId) {
      setConversationMenuOpen(false);
      return;
    }
    setSwitchingConversationId(nextConversationId);
    setFollowUpError(null);
    try {
      await onConversationSelect(nextConversationId);
      setConversationMenuOpen(false);
    } catch (error) {
      setFollowUpError(error instanceof Error ? error.message : "Klio could not open that conversation.");
    } finally { setSwitchingConversationId(null); }
  }
  const currentWorkTurns = workTurns.some((item) => item.id === turn.id) ? workTurns.map((item) => item.id === turn.id ? turn : item) : [turn, ...workTurns];
  const hasVisibleWork = currentWorkTurns.some(isVisibleWorkspaceWork);
  return <>
    <section ref={dialogRef} tabIndex={-1} className="klio-conversation" role="dialog" aria-label="Conversation with Klio">
      <header className="klio-conversation-header">
        <span className="klio-conversation-mark"><Sparkles size={16} /></span>
        <div><strong>{conversations.find((item) => item.id === turn.conversationId)?.title ?? "Klio"}</strong><span>{[learnerName, turn.subject].filter(Boolean).join(" · ") || "Family workspace"}</span></div>
        <div className="klio-conversation-controls">
          <button type="button" onClick={() => setConversationMenuOpen((current) => !current)} aria-label="Conversations" aria-expanded={conversationMenuOpen} aria-controls="klio-conversation-menu"><MessagesSquare size={15} /><span>Conversations</span></button>
          {onNewConversation ? <button type="button" onClick={onNewConversation} aria-label="New conversation"><Plus size={15} /><span>New</span></button> : null}
          <button type="button" onClick={onMinimize} aria-label="Close conversation">Done</button>
          {(queued || active) && onCancel ? <button type="button" className="conversation-stop" onClick={onCancel}>Cancel work</button> : null}
        </div>
        {conversationMenuOpen ? <div id="klio-conversation-menu" className="klio-conversation-menu">
          <header><strong>Recent conversations</strong>{onNewConversation ? <button type="button" onClick={onNewConversation}><Plus size={14} />New conversation</button> : null}</header>
          <div>{conversations.length ? conversations.map((conversation) => <button type="button" className={conversation.id === turn.conversationId ? "selected" : ""} onClick={() => void switchConversation(conversation.id)} disabled={Boolean(switchingConversationId)} key={conversation.id}><span><strong>{conversation.title}</strong><small>{conversation.studentId ? students.find((student) => student.id === conversation.studentId)?.displayName ?? "Learner" : "Family"}</small></span>{switchingConversationId === conversation.id ? <LoaderCircle className="spin" size={14} /> : conversation.id === turn.conversationId ? <Check size={14} /> : <ArrowRight size={14} />}</button>) : <p>Your recent conversations will appear here.</p>}</div>
        </div> : null}
      </header>
      <div ref={scrollRef} className="klio-conversation-scroll">
        <div className="klio-conversation-stream">
          {history.map((message, index) => <ConversationMessageView message={message} key={`${message.role}-${index}-${message.content.slice(0, 20)}`} />)}
          <ConversationMessageView message={{ role: "parent", content: parentVisibleRequest(turn.request) }} />
          <article className="conversation-message conversation-klio">
            <span>Klio</span>
            {response ? <AssistantRichMessage content={response} /> : stale ? <p className="conversation-state-message">This stopped before finishing. Your original request is safe.</p> : failed ? <p className="conversation-state-message">I couldn’t finish this request. You can try it again without losing the original work.</p> : <div className="conversation-working"><i /><i /><i /><small>{status}</small></div>}
            {failed || stale ? <button type="button" onClick={onRetry}>Try again</button> : null}
            {turn.result?.actions.length ? <ReceiptActions actions={turn.result.actions} artifacts={artifacts} onPracticeOpen={onPracticeOpen ? (artifactId) => { onMinimize(); onPracticeOpen(artifactId); } : undefined} /> : null}
            {awaitingParent && turn.clarification ? <div className="conversation-clarification"><p>{turn.clarification.question}</p><textarea aria-label={turn.clarification.question} value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={4000} rows={3} autoFocus /><div><button type="button" onClick={() => void submitAnswer()} disabled={!answer.trim() || answering}>{answering ? <LoaderCircle className="spin" size={14} /> : null}Send answer</button>{onCancel ? <button type="button" onClick={onCancel} disabled={answering}>Cancel</button> : null}</div>{answerError ? <small role="alert">{answerError}</small> : null}</div> : null}
          </article>
        </div>
      </div>
      {hasVisibleWork ? <div className="klio-work-dock"><KlioWorkTray turns={currentWorkTurns} students={students} now={now} loading={workLoading} error={workError} /></div> : null}
      <footer className="klio-conversation-footer">
        {onFollowUp && (!awaitingParent || !turn.clarification) ? <div className="conversation-followup">
          <textarea value={followUp} onChange={(event) => changeFollowUp(event.target.value)} onPaste={composer?.onPaste} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendFollowUp(); } }} rows={2} placeholder="Tell Klio what happened, ask a question, or hand off work…" aria-label="Message Klio" />
          {attachedFiles.length ? <div className="conversation-attachments">{attachedFiles.map((file, index) => <span key={`${file.name}-${file.size}-${index}`}>{fileIcon(file)}<b>{file.name}</b><button type="button" onClick={() => composer?.onRemoveFile(index)} aria-label={`Remove ${file.name}`}><X size={12} /></button></span>)}</div> : null}
          {composer ? <VoiceDictationFeedback phase={composer.voicePhase} seconds={composer.voiceSeconds} message={composer.voiceMessage} onStop={composer.recording ? composer.onVoice : undefined} /> : null}
          <div className="conversation-followup-footer">
            {composer ? <div className="conversation-tools"><button type="button" onClick={composer.onPhoto} aria-label="Attach photo"><Camera size={16} /></button>{!composer.recording ? <button type="button" className={composerVoicePending ? "transcribing" : ""} onClick={composer.onVoice} disabled={composerVoicePending} aria-label={composer.voicePhase === "requesting" ? "Starting voice input" : composer.voicePhase === "transcribing" ? "Transcribing voice input" : "Start voice input"}>{composerVoicePending ? <LoaderCircle className="spin" size={15} /> : <Mic size={16} />}</button> : null}<button type="button" onClick={composer.onFile} aria-label="Attach file"><Paperclip size={16} /></button><button type="button" onClick={composer.onScore} aria-label="Add score"><FileText size={16} /></button></div> : <span><Sparkles size={12} />Using your family workspace</span>}
            {composer ? <label className="conversation-for"><span>For</span><select value={composer.studentId} onChange={(event) => composer.onStudentChange(event.target.value)} aria-label="Learner for this message"><option value="">Family</option>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label> : null}
            <button type="button" className="conversation-send" onClick={() => void sendFollowUp()} disabled={(!followUp.trim() && !attachedFiles.length) || followingUp || composer?.voicePhase === "recording" || composerVoicePending} aria-label="Send message">{followingUp ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={17} />}</button>
          </div>
          {followUpError ? <p className="conversation-followup-error" role="alert">{followUpError}</p> : null}
        </div> : null}
      </footer>
    </section>
  </>;
}

function KlioWorkTray({ turns, students, now, loading, error }: { turns: AgentTurnSummary[]; students: StudentDTO[]; now: number | null; loading: boolean; error: string | null }) {
  const learnerNames = new Map(students.map((student) => [student.id, student.displayName]));
  const openTurns = turns.filter(isVisibleWorkspaceWork);
  const visibleTurns = openTurns.slice(0, 3);
  if (!visibleTurns.length && !loading && !error) return null;
  return <section id="klio-work-tray" className="klio-work-tray" aria-label="Klio’s current work">
    <header><div><span>Conductor</span><strong>{openTurns.length ? `${openTurns.length} open ${openTurns.length === 1 ? "job" : "jobs"}` : "Checking current work"}</strong></div></header>
    {loading && !turns.length ? <div className="klio-work-loading"><i /><i /><i /></div> : error && !visibleTurns.length ? <p className="klio-work-error">{error}</p> : <div className="klio-work-cards">{visibleTurns.map((workTurn) => {
      const receiptState = now === null ? workTurn.status : deriveReceiptState({ status: workTurn.status, createdAt: workTurn.createdAt, lastHeartbeatAt: workTurn.lastHeartbeatAt, now });
      const paused = receiptState === "paused";
      const steps = receiptSteps(workTurn.normalizedStep, workTurn.status, paused);
      const completed = steps.filter((step) => step.state === "done").length;
      const stateLabel = paused ? "Paused" : workTurn.status === "awaiting_parent" ? "Needs your input" : workTurn.status === "running" ? "Working" : workTurn.status === "queued" ? "Queued" : workTurn.status === "failed" ? "Needs a retry" : "Finished";
      return <article className={`klio-work-card ${paused || workTurn.status === "failed" ? "paused" : workTurn.status}`} key={workTurn.id}>
        <header><div><span>{stateLabel}</span><strong>{workTurn.taskName}</strong><small>{[workTurn.studentId ? learnerNames.get(workTurn.studentId) : null, workTurn.subject].filter(Boolean).join(" · ") || "Family workspace"}</small></div><em>{completed} of {steps.length}</em></header>
        <ol>{steps.map((step) => <li className={step.state} key={step.label}>{step.state === "done" ? <Check size={12} /> : step.state === "current" ? <i /> : <Circle size={9} />}<span>{step.label}</span></li>)}</ol>
        {workTurn.expectedOutput ? <footer><span>Output</span><p>{parentFacingExpectedOutput(workTurn.expectedOutput)}</p></footer> : null}
      </article>;
    })}</div>}
    {error && visibleTurns.length ? <p className="klio-work-refresh-error">Live updates paused. Showing the latest saved state.</p> : null}
  </section>;
}

function isVisibleWorkspaceWork(turn: AgentTurnSummary) {
  if (!["queued", "running", "awaiting_parent", "failed"].includes(turn.status)) return false;
  if (turn.goal !== "general") return true;
  // A general turn begins as conversation. It becomes visible operational work
  // only after Klio actually chooses a workspace tool or reaches an action step.
  return turn.tools.length > 0 || ["updating_week", "creating_practice", "preparing_feedback", "ready_review"].includes(turn.normalizedStep ?? "");
}

function conversationProgressLabel(turn: AgentTurnSummary) {
  if (turn.goal === "general" && !isVisibleWorkspaceWork(turn)) return "Thinking";
  return receiptStepLabel(turn.normalizedStep);
}

function ConversationMessageView({ message }: { message: ConversationMessage }) {
  return <article className={`conversation-message ${message.role === "parent" ? "conversation-parent" : "conversation-klio"}`}><span>{message.role === "parent" ? "You" : "Klio"}</span>{message.role === "parent" ? <p>{message.content}</p> : <AssistantRichMessage content={message.content} />}</article>;
}

function parentVisibleRequest(request: string) {
  return request.match(/and asked: “([\s\S]+?)” Answer the question directly/)?.[1] ?? request;
}

function ReceiptActions({ actions, artifacts, onPracticeOpen }: { actions: NonNullable<AgentTurnDTO["result"]>["actions"]; artifacts: ArtifactDTO[]; onPracticeOpen?: (artifactId: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolvedTargets, setResolvedTargets] = useState<string[]>([]);
  async function decide(targetType: "planning_proposal" | "adjustment", targetId: string, decision: "approve" | "reject" | "undo") {
    setBusy(`${targetId}:${decision}`); setNotice(null);
    const endpoint = targetType === "planning_proposal" ? `/api/planning-proposals/${targetId}` : `/api/adjustments/${targetId}`;
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    const body = await response.json(); setBusy(null);
    if (!response.ok) { setNotice(body.error ?? "Klio could not safely update that proposal."); return; }
    setResolvedTargets((current) => current.includes(targetId) ? current : [...current, targetId]);
    setNotice(decision === "approve" ? "Approved and applied." : decision === "undo" ? "Change undone." : "Declined; current records are unchanged.");
    router.refresh();
  }
  const practiceActions = actions.filter((action) => action.targetType === "artifact" && /practice/i.test(action.label));
  return <div className="receipt-actions">{actions.map((action) => {
    const decisionTarget = action.verb === "open" && action.targetId && (action.targetType === "planning_proposal" || action.targetType === "adjustment") ? action.targetType : null;
    const undoTarget = action.verb === "undo" && action.targetId && action.targetType === "adjustment";
    const resolved = Boolean(action.targetId && resolvedTargets.includes(action.targetId));
    const artifact = action.targetType === "artifact" && action.targetId ? artifacts.find((item) => item.id === action.targetId) : null;
    const isPractice = artifact?.type === "practice" || (action.targetType === "artifact" && /practice/i.test(action.label));
    const practice = artifact ? practiceActionDetails(artifact) : null;
    const practiceIndex = practiceActions.indexOf(action);
    return <div key={`${action.verb}:${action.targetType}:${action.targetId}`}>
      {undoTarget && action.targetId ? resolved ? <span className="receipt-action-done"><Check size={12} />Undone</span> : <button type="button" disabled={busy !== null} onClick={() => void decide("adjustment", action.targetId!, "undo")}>{busy === `${action.targetId}:undo` ? <LoaderCircle className="spin" size={12} /> : <RotateCcw size={12} />}Undo change</button> : isPractice && action.targetId && onPracticeOpen ? <button type="button" className="receipt-practice-launch" onClick={() => onPracticeOpen(action.targetId!)}><span><strong>{practice?.title ?? `Focused practice ${practiceIndex + 1}`}</strong><small>{practice ? `${practice.activityCount} activities · about ${practice.minutes} minutes` : "Ready for the learner"}</small></span><ArrowRight size={14} /></button> : <Link href={isPractice && action.targetId ? `/app?artifact=${encodeURIComponent(action.targetId)}` : action.href}>{decisionTarget ? "Review or edit" : isPractice ? practice?.title ?? `Open practice ${practiceIndex + 1}` : action.label}<ChevronRight size={12} /></Link>}
      {decisionTarget && action.targetId && !resolved ? <><button type="button" disabled={busy !== null} onClick={() => void decide(decisionTarget, action.targetId!, "reject")}>Decline</button><button type="button" disabled={busy !== null} onClick={() => void decide(decisionTarget, action.targetId!, "approve")}>{busy === `${action.targetId}:approve` ? <LoaderCircle className="spin" size={12} /> : <Check size={12} />}Approve</button></> : null}
    </div>;
  })}{notice ? <p role="status">{notice}</p> : null}</div>;
}

function practiceActionDetails(artifact: ArtifactDTO) {
  if (artifact.type !== "practice") return null;
  const content = artifact.content && typeof artifact.content === "object" && !Array.isArray(artifact.content) ? artifact.content as Record<string, unknown> : null;
  const practice = normalizePracticeSpec(content?.practice);
  if (!practice) return { title: artifact.title, activityCount: 0, minutes: 10 };
  return { title: artifact.title, activityCount: practice.activities.length, minutes: estimatedPracticeMinutes(practice.activities) };
}


function ReceiptDetails({ result, artifacts }: { result: NonNullable<AgentTurnDTO["result"]>; artifacts: ArtifactDTO[] }) {
  const resultArtifact = result.actions.find((action) => action.targetType === "artifact" && action.targetId)?.targetId;
  const approvedPractice = resultArtifact ? artifacts.find((artifact) => artifact.id === resultArtifact && artifact.type === "practice" && artifact.status === "approved") : null;
  const sections = [
    ["Understood", result.understood],
    ["Used", result.used],
    ["Changed", approvedPractice ? result.changed.map((item) => /practice draft/i.test(item) ? "Created focused practice" : item) : result.changed],
    ["Still needs you", approvedPractice ? result.remaining.filter((item) => !/approv.*practice|practice.*approv/i.test(item)) : result.remaining],
  ] as const;
  if (!sections.some(([, items]) => items.length)) return null;
  return <dl className="receipt-details">{sections.filter(([, items]) => items.length).map(([label, items]) => <div key={label}><dt>{label}</dt><dd>{items.join(" · ")}</dd></div>)}</dl>;
}

function receiptSteps(step: string | null, status: string, stale: boolean) {
  const labels = ["Received the submitted work", "Read the assignment and curriculum context", "Checked what the handoff requires", "Prepared the family workspace update", "Finished the parent-facing result"];
  const index = stale ? Math.max(0, stepIndex(step)) : status === "completed" ? labels.length : status === "awaiting_parent" ? 2 : stepIndex(step);
  return labels.map((label, position) => ({ label, state: position < index ? "done" : position === index && ["running", "awaiting_parent"].includes(status) && !stale ? "current" : "pending" }));
}
function stepIndex(step: string | null) { return ({ received: 0, waiting: 0, reading: 1, checking: 2, updating_week: 3, creating_practice: 3, preparing_feedback: 3, waiting_detail: 2, ready_review: 4, finished: 5, paused: 2, failed: 2 } as Record<string, number>)[step ?? ""] ?? 0; }
function receiptStepLabel(step: string | null) { return ({ reading: "Reading submitted work", checking: "Checking the handoff", updating_week: "Updating the week", creating_practice: "Creating focused practice", preparing_feedback: "Preparing feedback", ready_review: "Ready for review" } as Record<string, string>)[step ?? ""] ?? "Working on the handoff"; }
function timeLabel(value: string, prefix: string, now: number | null) { if (now === null) return `${prefix} recently`; const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000)); return `${prefix} ${seconds < 5 ? "just now" : seconds < 60 ? `${seconds} seconds ago` : `${Math.round(seconds / 60)} minutes ago`}`; }
function parentFacingExpectedOutput(value: string) {
  if (/one concise receipt/i.test(value)) return "Klio will place any created work in the workspace and summarize the change here.";
  if (/grounded support|safe workspace change/i.test(value)) return "Practice or schedule changes will appear in a workspace tab. If one detail is missing, Klio will ask here.";
  return value;
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
function isUnfiled(item: EvidenceDTO) { return item.kind !== "practice_result" && (item.status === "needs_review" || (item.status === "ready" && item.categories.length === 0)); }
function reminderTime(item: ReminderDTO) { return item.dueAt ? new Date(item.dueAt).getTime() : Number.MAX_SAFE_INTEGER; }
function fileIcon(file: File) { if (file.type.startsWith("image/")) return <ImageIcon size={14} />; if (file.type.startsWith("audio/")) return <Volume2 size={14} />; return <FileText size={14} />; }
function outputIcon(type: string) { if (type === "weekly_plan") return <CalendarDays size={14} />; if (type === "lesson" || type === "practice") return <BookOpen size={14} />; return <LayoutDashboard size={14} />; }
function kindIcon(kind: string) { if (kind === "photo") return <ImageIcon size={15} />; if (kind === "voice") return <Mic size={15} />; return <FileText size={15} />; }
function assistantStarterIcon(id: AssistantStarterId) {
  return ({
    family_briefing: LayoutDashboard,
    organize_today: CalendarDays,
    teach_next_lesson: BookOpen,
    practice_from_mistakes: Pencil,
    review_recent_learning: FileText,
    plan_week: CalendarDays,
    portfolio_update: FileCheck2,
  } satisfies Record<AssistantStarterId, typeof LayoutDashboard>)[id];
}
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
function formatConversationAge(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}
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
