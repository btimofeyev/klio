"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, LoaderCircle, X } from "lucide-react";
import type { AgentTurnDTO, StudentDTO, WeeklyBriefingDTO, WeeklyBriefingState } from "@/lib/data/workspace";
import styles from "./weekly-family-briefing.module.css";

export function WeeklyFamilyBriefing({ briefing, state, familyId, students, selectedStudentId, familyTimezone, planningProposals = [], adjustments = [], activeAgentTurn = null, onDismissed }: {
  briefing: WeeklyBriefingDTO | null;
  state: WeeklyBriefingState;
  familyId: string;
  students: StudentDTO[];
  selectedStudentId: string;
  familyTimezone: string;
  planningProposals?: BriefingPlanningProposal[];
  adjustments?: BriefingAdjustment[];
  activeAgentTurn?: AgentTurnDTO | null;
  onDismissed?: () => void;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(state === "dismissed");
  const [busy, setBusy] = useState(false);
  const [localBriefingTurn, setBriefingTurn] = useState<AgentTurnDTO | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const viewed = useRef(Boolean(briefing?.viewedAt));
  const learner = students.find((student) => student.id === selectedStudentId);
  const briefingTurn = localBriefingTurn ?? (isBriefingTurn(activeAgentTurn) ? activeAgentTurn : null);
  const briefingTurnId = briefingTurn?.id ?? null;
  const briefingTurnStatus = briefingTurn?.status ?? null;

  useEffect(() => {
    if (!briefing || state !== "available" || viewed.current) return;
    viewed.current = true;
    const controller = new AbortController();
    void fetch(`/api/weekly-briefings/${briefing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "view" }),
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) viewed.current = false;
    }).catch((caught) => {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) viewed.current = false;
    });
    return () => controller.abort();
  }, [briefing, state]);

  useEffect(() => {
    if (!briefingTurnId || !briefingTurnStatus || !["queued", "running"].includes(briefingTurnStatus) || briefingTurnId.startsWith("optimistic:")) return;
    let cancelled = false;
    let timer: number | undefined;
    async function refreshTurn() {
      try {
        const response = await fetch(`/api/agent/turns?familyId=${encodeURIComponent(familyId)}`, { cache: "no-store" });
        const result = await response.json() as { turns?: AgentTurnDTO[] };
        if (!response.ok || cancelled) return;
        const updated = result.turns?.find((turn) => turn.id === briefingTurnId);
        if (!updated) return;
        setBriefingTurn(updated);
        if (["queued", "running"].includes(updated.status)) timer = window.setTimeout(refreshTurn, 900);
        else router.refresh();
      } catch {
        if (!cancelled) timer = window.setTimeout(refreshTurn, 1800);
      }
    }
    timer = window.setTimeout(refreshTurn, 500);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [briefingTurnId, briefingTurnStatus, familyId, router]);

  if (hidden || state === "not_due") return null;
  if (!briefing || state !== "available") {
    return <section className={styles.status} data-briefing-side="right" aria-live="polite">
      <Clock3 size={15} aria-hidden="true" />
      <div><strong>{state === "failed" ? "This week’s briefing is delayed" : "Preparing your week at a glance"}</strong><span>{state === "failed" ? "Klio will retry without changing family records." : "Klio is gathering the current family plan."}</span></div>
    </section>;
  }

  const snapshot = briefing.snapshot;
  const visibleLearners = learner ? snapshot.learners.filter((item) => item.studentId === learner.id) : snapshot.learners;
  const visiblePacing = learner ? snapshot.pacing.filter((item) => item.studentId === learner.id) : snapshot.pacing;
  const visibleActions = learner ? snapshot.actions.filter((action) => actionAppliesToLearner(action, learner.id)) : snapshot.actions;
  const visiblePreviousWeek = learner
    ? snapshot.previousWeek.byLearner?.find((item) => item.studentId === learner.id)
    : snapshot.previousWeek;
  const verifiedAt = verifiedNoActionAt(briefingTurn, briefing.generatedAt);
  const presentation = briefingPresentation(visibleActions, visiblePacing, visiblePreviousWeek, planningProposals, adjustments, briefing.generatedAt, verifiedAt);
  const highlights = presentation.highlights;
  const openHighlights = highlights.filter((item) => item.state === "open");
  const preparedHighlights = highlights.filter((item) => item.state === "prepared");
  const showActionNote = highlights.length > 0;
  const scopeLabel = learner?.displayName;
  const briefingId = briefing.id;
  const summary = briefingSummary(visibleLearners, presentation, learner?.displayName);
  const turnIsWorking = Boolean(briefingTurn && ["queued", "running"].includes(briefingTurn.status));
  const turnProgress = briefingProgress(briefingTurn);
  const turnUpdate = briefingTurn?.events.at(-1)?.label ?? (briefingTurn?.status === "queued" ? "Received the handoff" : "Checking the current week");

  async function dismissBriefing() {
    if (busy) return false;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/weekly-briefings/${briefingId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Klio could not update this briefing."); return false; }
      setHidden(true); onDismissed?.(); router.refresh();
      return true;
    } catch {
      setError("Klio could not update this briefing."); return false;
    } finally { setBusy(false); }
  }

  async function handleBriefing() {
    if (!openHighlights.length || busy || ["queued", "running"].includes(briefingTurn?.status ?? "")) return;
    const scope = learner ? `${learner.displayName}’s` : "the family’s";
    const request = `Take care of the remaining items in ${scope} weekly briefing for ${dateRange(snapshot.weekStart, snapshot.weekEnd)}: ${openHighlights.map((item) => item.title.toLocaleLowerCase("en-US")).join("; ")}. Work in the background using current family records and available tools. The parent explicitly authorizes ordinary safe, reversible assignment moves in this handoff. Use move_unfinished_work for open past work and organize_day_schedule for an overloaded day; those changes should apply now with Undo. Do not use draft_weekly_plan and do not return a review-only narrative. Use prepare_planning_changes only when the requested outcome is genuinely larger than those bounded tools. If no change is needed, finish with no action. Ask one precise question only when a required fact cannot be inferred.`;
    const startedAt = new Date().toISOString();
    setBusy(true); setError(null); setAnswer("");
    setBriefingTurn(optimisticBriefingTurn({ briefingId, request, studentId: learner?.id ?? null, createdAt: startedAt }));
    try {
      const response = await fetch(`/api/weekly-briefings/${briefingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "handle", request, studentId: learner?.id ?? null }),
      });
      const result = await response.json().catch(() => ({})) as { turn?: { id: string; status: string }; error?: string };
      if (!response.ok || !result.turn?.id) throw new Error(result.error ?? "Klio could not start this briefing handoff.");
      setBriefingTurn((current) => current ? { ...current, id: result.turn!.id, status: result.turn!.status } : current);
    } catch (caught) {
      setBriefingTurn(null);
      setError(caught instanceof Error ? caught.message : "Klio could not start this briefing handoff.");
    } finally {
      setBusy(false);
    }
  }

  async function retryBriefingTurn() {
    if (!briefingTurn || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/agent/turns/${briefingTurn.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry" }) });
      const result = await response.json().catch(() => ({})) as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Klio could not retry this handoff.");
      setBriefingTurn({ ...briefingTurn, status: "queued", normalizedStep: "waiting", clarification: null, result: null, lastProgressAt: new Date().toISOString() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Klio could not retry this handoff.");
    } finally {
      setBusy(false);
    }
  }

  async function answerBriefingQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!briefingTurn?.clarification || !answer.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/agent/turns/${briefingTurn.id}/clarification`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: answer.trim(), requestId: crypto.randomUUID() }),
      });
      const result = await response.json().catch(() => ({})) as { resumedTurnId?: string; error?: string };
      if (!response.ok || !result.resumedTurnId) throw new Error(result.error ?? "Klio could not save that answer.");
      const resumedAt = new Date().toISOString();
      setBriefingTurn({ ...briefingTurn, id: result.resumedTurnId, status: "queued", clarification: null, result: null, normalizedStep: "waiting", createdAt: resumedAt, startedAt: null, lastHeartbeatAt: null, lastProgressAt: resumedAt });
      setAnswer("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Klio could not save that answer.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.notes} aria-labelledby={`weekly-briefing-${briefing.id}`}>
    <article className={`${styles.note} ${styles.summaryNote} ${showActionNote ? "" : styles.singleNote}`} data-briefing-side="left">
      {!showActionNote ? <button type="button" className={styles.dismiss} aria-label="Dismiss weekly briefing" title="Dismiss" onClick={() => void dismissBriefing()} disabled={busy}><X size={14} aria-hidden="true" /></button> : null}
      <span>{scopeLabel ? `${scopeLabel} · ` : ""}{dateRange(snapshot.weekStart, snapshot.weekEnd)}</span>
      <h2 id={`weekly-briefing-${briefing.id}`}>Klio noticed</h2>
      <p>{summary}</p>
      <small>Updated {formatGenerated(presentation.latestChangeAt ?? briefing.generatedAt, familyTimezone)}</small>
    </article>

    {showActionNote ? <article className={`${styles.note} ${styles.actionNote}`} data-briefing-side="right">
      <header><h3>What matters</h3><button type="button" className={styles.dismiss} aria-label="Dismiss weekly briefing" title="Dismiss" onClick={() => void dismissBriefing()} disabled={busy}><X size={14} aria-hidden="true" /></button></header>
      <p className={styles.mobileSummary}>{summary}</p>
      {highlights.length ? <ol className={styles.highlights}>{highlights.map((item) => <li className={item.state === "prepared" ? styles.prepared : undefined} key={item.theme}>
        <div><span>{item.context}</span><strong>{item.title}</strong><p>{item.explanation}</p></div>
        {item.href ? <Link href={item.href}>{item.linkLabel} <ArrowRight size={12} aria-hidden="true" /></Link> : null}
      </li>)}</ol> : <p className={styles.ready}>{visibleLearners.length ? presentation.resolvedThemes ? "Klio handled the briefing. Nothing else needs your decision." : `${learner?.displayName ?? "Everyone"} fits within the current plan.` : "There is no learner schedule to summarize yet."}</p>}
      <footer className={styles.footer}>
        {turnIsWorking ? <div className={styles.handoffProgress} role="status" aria-live="polite">
          <div className={styles.handoffHeading}><LoaderCircle size={13} aria-hidden="true" /><span><strong>{briefingTurn?.status === "queued" ? "Klio is starting" : "Klio is handling this"}</strong><small>{turnUpdate}</small></span></div>
          <div className={styles.progressTrack} role="progressbar" aria-label="Klio briefing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={turnProgress}><span style={{ width: `${turnProgress}%` }} /></div>
        </div> : briefingTurn?.status === "awaiting_parent" && briefingTurn.clarification ? <form className={styles.handoffQuestion} onSubmit={answerBriefingQuestion}>
          <span><strong>Klio needs one detail</strong><small>{briefingTurn.clarification.question}</small></span>
          <label><span>Your answer</span><input value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={busy} /></label>
          <button type="submit" disabled={busy || !answer.trim()}>Continue</button>
        </form> : briefingTurn?.status === "failed" ? <div className={styles.handoffFailed} role="alert">
          <AlertCircle size={13} aria-hidden="true" /><span><strong>Klio paused here</strong><small>Your briefing is unchanged. Retry the same background handoff.</small></span><button type="button" onClick={() => void retryBriefingTurn()} disabled={busy}>Try again</button>
        </div> : briefingTurn?.status === "completed" && openHighlights.length ? <div className={styles.handoffComplete} role="status">
          <CheckCircle2 size={13} aria-hidden="true" /><span><strong>Klio finished</strong><small>{briefingResultSummary(briefingTurn)}</small></span>
          {briefingTurn.result?.actions[0] ? <Link href={briefingTurn.result.actions[0].href}>{briefingTurn.result.actions[0].label} <ArrowRight size={12} aria-hidden="true" /></Link> : null}
        </div> : openHighlights.length ? <button type="button" onClick={() => void handleBriefing()} disabled={busy}>{preparedHighlights.length || presentation.resolvedThemes ? "Ask Klio to handle the rest" : "Ask Klio to handle this"}</button> : null}
        {!turnIsWorking && briefingTurn?.status !== "awaiting_parent" ? <p>{briefingTrust(presentation)}</p> : null}
        {error ? <span role="alert">{error}</span> : null}
      </footer>
    </article> : null}
  </section>;
}

export function weeklyBriefingShouldRender(briefing: WeeklyBriefingDTO | null, state: WeeklyBriefingState) {
  return state === "pending" || state === "failed" || (state === "available" && Boolean(briefing));
}

export function isBriefingTurn(turn: AgentTurnDTO | null | undefined): boolean {
  return turn?.taskName === "Handling weekly briefing" && turn.conversationId === null;
}

function optimisticBriefingTurn(input: { briefingId: string; request: string; studentId: string | null; createdAt: string }): AgentTurnDTO {
  return {
    id: `optimistic:${input.briefingId}`,
    status: "queued",
    goal: "weekly_plan",
    request: input.request,
    result: null,
    clarification: null,
    events: [{ sequence: 1, kind: "turn.queued", label: "Received the handoff" }],
    tools: [],
    taskName: "Handling weekly briefing",
    studentId: input.studentId,
    subject: null,
    sourceCount: 0,
    normalizedStep: "waiting",
    expectedOutput: "A completed safe change, a durable reviewable proposal, or one precise question",
    createdAt: input.createdAt,
    startedAt: null,
    lastHeartbeatAt: null,
    lastProgressAt: input.createdAt,
    conversationId: null,
    interactionMode: "act",
    streamedMessage: null,
  };
}

function briefingProgress(turn: AgentTurnDTO | null) {
  if (!turn) return 0;
  if (turn.status === "completed") return 100;
  if (turn.status === "queued") return 10;
  const steps: Record<string, number> = { waiting: 10, reading: 28, planning: 48, acting: 70, verifying: 88, finished: 100 };
  return Math.max(18, steps[turn.normalizedStep ?? ""] ?? Math.min(86, 22 + turn.events.length * 9));
}

function briefingResultSummary(turn: AgentTurnDTO) {
  const source = turn.result?.changed[0] ?? turn.result?.message ?? turn.streamedMessage ?? "The background handoff is complete.";
  const plain = source.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 180 ? `${plain.slice(0, 177).trimEnd()}…` : plain;
}

function briefingSummary(learners: WeeklyBriefingDTO["snapshot"]["learners"], presentation: BriefingPresentation, learnerName?: string) {
  if (!learners.length) return "There is no learner schedule to summarize yet.";
  const subject = learnerName ? `${learnerName}’s week` : "The week";
  const prepared = presentation.highlights.filter((item) => item.state === "prepared").length;
  const open = presentation.highlights.filter((item) => item.state === "open").length;
  if (prepared && open) return "One change is ready for review. One item still needs a plan.";
  if (prepared) return prepared === 1 ? "Klio prepared a change. It’s ready for your review." : "Klio prepared two changes. They’re ready for your review.";
  if (presentation.resolvedThemes && open) return `Klio handled ${presentation.resolvedThemes === 1 ? "one item" : "part of the briefing"}. ${open === 1 ? "One thing remains." : "Two things remain."}`;
  if (presentation.resolvedThemes) return "Klio handled the briefing. Nothing else needs your decision.";
  const highlights = presentation.highlights;
  if (!highlights.length) return `${subject} is ready. Nothing needs your decision.`;
  if (highlights.length === 1) return `${subject} is organized. Klio found one thing worth a quick look.`;
  return `${subject} is organized. Klio narrowed it down to two things.`;
}

function dateRange(start: string, end: string) {
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${format.format(new Date(`${start}T12:00:00Z`))}–${format.format(new Date(`${end}T12:00:00Z`))}`;
}

function formatGenerated(value: string, timeZone: string) {
  try { return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
}

type BriefingAction = WeeklyBriefingDTO["snapshot"]["actions"][number];
type BriefingPacing = WeeklyBriefingDTO["snapshot"]["pacing"];
type PreviousWeek = WeeklyBriefingDTO["snapshot"]["previousWeek"] | NonNullable<WeeklyBriefingDTO["snapshot"]["previousWeek"]["byLearner"]>[number] | undefined;
type BriefingPlanningProposal = { id: string; status: string; proposalKind: string; actionName: string; summary: string; changes: unknown; targetAssignmentId: string | null; targetGoalId: string | null; targetCurriculumUnitId: string | null; createdAt: string };
type BriefingAdjustment = { id: string; status: string; summary: string; createdAt: string; actions: Array<{ assignmentId: string | null }> };
type BriefingHighlight = { theme: string; state: "open" | "prepared"; context: string; title: string; explanation: string; href?: string; linkLabel: string };
type BriefingPresentation = { highlights: BriefingHighlight[]; resolvedThemes: number; latestChangeAt: string | null };

function briefingPresentation(actions: BriefingAction[], pacing: BriefingPacing, previousWeek: PreviousWeek, proposals: BriefingPlanningProposal[], adjustments: BriefingAdjustment[], generatedAt: string, verifiedAt: string | null): BriefingPresentation {
  const seen = new Set<string>();
  const highlights: BriefingHighlight[] = [];
  let resolvedThemes = 0;
  let latestChangeAt: string | null = null;
  for (const action of actions) {
    const theme = actionTheme(action.kind);
    if (seen.has(theme)) continue;
    seen.add(theme);
    if (verifiedAt) {
      resolvedThemes += 1;
      latestChangeAt = verifiedAt;
      continue;
    }
    const themeActions = actions.filter((candidate) => actionTheme(candidate.kind) === theme);
    const proposalState = proposalStateForTheme(theme, themeActions, pacing, proposals, adjustments, generatedAt);
    const changedAt = proposalState.state === "prepared" ? proposalState.proposal.createdAt : proposalState.state === "resolved" ? proposalState.changedAt : null;
    if (changedAt && (!latestChangeAt || changedAt > latestChangeAt)) latestChangeAt = changedAt;
    if (proposalState.state === "resolved") {
      resolvedThemes += 1;
      continue;
    }
    highlights.push(proposalState.state === "prepared"
      ? preparedHighlight(theme, proposalState.proposal)
      : toHighlight(action, theme, pacing, previousWeek));
    if (highlights.length === 2) break;
  }
  return { highlights, resolvedThemes, latestChangeAt };
}

function verifiedNoActionAt(turn: AgentTurnDTO | null, generatedAt: string) {
  if (!turn || !isBriefingTurn(turn) || turn.status !== "completed" || turn.result?.kind !== "no_op") return null;
  if (turn.result.actions.length || turn.result.changed.length || turn.result.remaining.length) return null;
  return Date.parse(turn.createdAt) >= Date.parse(generatedAt) ? turn.createdAt : null;
}

function actionTheme(kind: BriefingAction["kind"]) {
  if (kind === "resolve_capacity" || kind === "resolve_parent_attention") return "schedule";
  if (kind === "review_pacing" || kind === "review_crowded_subject") return "pacing";
  return kind;
}

function toHighlight(action: BriefingAction, theme: string, pacing: BriefingPacing, previousWeek: PreviousWeek): BriefingHighlight {
  const href = typeof action.target.href === "string" ? action.target.href : undefined;
  if (theme === "review_submissions") {
    const count = previousWeek?.awaitingReviewCount ?? 0;
    return { theme, state: "open", context: "Review", title: "Submitted work is ready for you", explanation: count ? `${count} ${count === 1 ? "item is" : "items are"} waiting. Klio has kept them out of learning claims until you approve them.` : "Klio has kept this work out of learning claims until you approve it.", href, linkLabel: "Review" };
  }
  if (theme === "schedule") {
    return { theme, state: "open", context: "This week", title: "One part of the schedule needs a lighter plan", explanation: "Klio can rebalance ordinary schedule work now and keep the change undoable.", href, linkLabel: "Open week" };
  }
  if (theme === "decide_unfinished") {
    const count = previousWeek?.unfinishedCount ?? 0;
    return { theme, state: "open", context: "Last week", title: count === 1 ? "One lesson is still open" : "A few lessons are still open", explanation: "Klio can fit the unfinished work into this week without disturbing the rest of the plan.", href, linkLabel: "Open week" };
  }
  if (theme === "pacing") {
    const concernCount = pacing.filter((item) => item.kind !== "approved_evidence_trend").length;
    return { theme, state: "open", context: "Pacing", title: concernCount === 1 ? "One course needs a pacing adjustment" : "The pace could use a simpler plan", explanation: "Klio can make bounded schedule moves now with Undo; larger academic changes still wait for you.", href, linkLabel: "View plan" };
  }
  return { theme, state: "open", context: "This week", title: "Some work still needs a place", explanation: "Klio can fit it into the week and prepare the schedule for your review.", href, linkLabel: "Open week" };
}

function preparedHighlight(theme: string, proposal: BriefingPlanningProposal): BriefingHighlight {
  const title = theme === "decide_unfinished"
    ? "A catch-up plan is ready"
    : theme === "pacing"
      ? "A pacing plan is ready"
      : theme === "schedule"
        ? "A lighter schedule is ready"
        : "A placement plan is ready";
  return { theme, state: "prepared", context: "Ready for review", title, explanation: conciseProposalSummary(proposal.summary), href: `/app/adjustments?proposal=${encodeURIComponent(proposal.id)}`, linkLabel: "Review" };
}

function proposalStateForTheme(theme: string, actions: BriefingAction[], pacing: BriefingPacing, proposals: BriefingPlanningProposal[], adjustments: BriefingAdjustment[], generatedAt: string): { state: "open" } | { state: "prepared"; proposal: BriefingPlanningProposal } | { state: "resolved"; changedAt: string } {
  const targetIds = targetIdsForTheme(theme, actions, pacing);
  if (!targetIds.size) return { state: "open" };
  const appliedAdjustments = adjustments
    .filter((adjustment) => adjustment.status === "applied" && Date.parse(adjustment.createdAt) >= Date.parse(generatedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const adjustedIds = new Set(appliedAdjustments.flatMap((adjustment) => adjustment.actions.flatMap((action) => action.assignmentId ? [action.assignmentId] : [])));
  const adjustmentResolved = theme === "schedule_work"
    ? [...targetIds].some((id) => adjustedIds.has(id))
    : [...targetIds].every((id) => adjustedIds.has(id));
  if (adjustmentResolved) return { state: "resolved", changedAt: appliedAdjustments[0].createdAt };
  const eligible = proposals
    .filter((proposal) => ["proposed", "applied"].includes(proposal.status) && Date.parse(proposal.createdAt) >= Date.parse(generatedAt))
    .map((proposal) => ({ proposal, ids: proposalReferenceIds(proposal) }))
    .filter(({ ids }) => [...targetIds].some((id) => ids.has(id)))
    .sort((a, b) => b.proposal.createdAt.localeCompare(a.proposal.createdAt));
  const prepared = eligible.find(({ proposal }) => proposal.status === "proposed");
  if (prepared) return { state: "prepared", proposal: prepared.proposal };
  const applied = eligible.filter(({ proposal }) => proposal.status === "applied");
  // A schedule-work briefing intentionally asks for the smallest useful next
  // placement. Once that bounded placement is approved, resolve the stored
  // alert instead of inviting a second proposal for the same backlog.
  if (theme === "schedule_work" && applied.length) return { state: "resolved", changedAt: applied[0].proposal.createdAt };
  const appliedIds = new Set(applied.flatMap(({ ids }) => [...ids]));
  return [...targetIds].every((id) => appliedIds.has(id)) ? { state: "resolved", changedAt: applied[0].proposal.createdAt } : { state: "open" };
}

function targetIdsForTheme(theme: string, actions: BriefingAction[], pacing: BriefingPacing) {
  const ids = new Set<string>();
  if (theme === "pacing") {
    for (const action of actions) collectNamedIds(action.target, new Set(["goalId", "goalIds"]), ids);
    for (const item of pacing.filter((item) => item.kind !== "approved_evidence_trend")) for (const reference of item.evidenceRefs) collectNamedIds(reference, new Set(["goalId", "goalIds"]), ids);
    return ids;
  }
  if (["schedule", "decide_unfinished", "schedule_work"].includes(theme)) {
    for (const action of actions) {
      collectNamedIds(action.target, new Set(["assignmentId", "assignmentIds"]), ids);
      for (const reference of action.evidenceRefs) if (reference.type === "assignment") ids.add(reference.id);
    }
  }
  return ids;
}

function proposalReferenceIds(proposal: BriefingPlanningProposal) {
  const ids = new Set<string>();
  for (const value of [proposal.targetAssignmentId, proposal.targetGoalId, proposal.targetCurriculumUnitId]) if (value) ids.add(value);
  collectNamedIds(proposal.changes, new Set(["assignmentId", "assignmentIds", "goalId", "goalIds", "curriculumUnitId", "curriculumUnitIds"]), ids);
  return ids;
}

function collectNamedIds(value: unknown, keys: Set<string>, ids: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectNamedIds(item, keys, ids);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key)) {
      if (typeof item === "string") ids.add(item);
      else if (Array.isArray(item)) for (const id of item) if (typeof id === "string") ids.add(id);
    }
    collectNamedIds(item, keys, ids);
  }
}

function conciseProposalSummary(value: string) {
  const summary = value.replace(/\s+/g, " ").trim();
  return summary.length <= 180 ? summary : `${summary.slice(0, 177).trimEnd()}…`;
}

function briefingTrust(presentation: BriefingPresentation) {
  const open = presentation.highlights.some((item) => item.state === "open");
  const prepared = presentation.highlights.some((item) => item.state === "prepared");
  if (presentation.resolvedThemes && (open || prepared)) return "Handled changes were parent-approved. Anything new still waits for you.";
  if (presentation.resolvedThemes) return "Only parent-approved changes were applied.";
  return "Safe schedule moves apply now with Undo. Grades and major changes still wait for you.";
}

function actionAppliesToLearner(action: BriefingAction, learnerId: string) {
  if (typeof action.target.studentId === "string") return action.target.studentId === learnerId;
  if (Array.isArray(action.target.studentIds)) return action.target.studentIds.includes(learnerId);
  return true;
}
