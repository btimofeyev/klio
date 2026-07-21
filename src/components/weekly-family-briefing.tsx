"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, X } from "lucide-react";
import type { StudentDTO, WeeklyBriefingDTO, WeeklyBriefingState } from "@/lib/data/workspace";
import styles from "./weekly-family-briefing.module.css";

export function WeeklyFamilyBriefing({ briefing, state, students, selectedStudentId, familyTimezone, planningProposals = [], onAsk, onDismissed }: {
  briefing: WeeklyBriefingDTO | null;
  state: WeeklyBriefingState;
  students: StudentDTO[];
  selectedStudentId: string;
  familyTimezone: string;
  planningProposals?: BriefingPlanningProposal[];
  onAsk: (request: string) => void;
  onDismissed?: () => void;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(state === "dismissed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewed = useRef(Boolean(briefing?.viewedAt));
  const learner = students.find((student) => student.id === selectedStudentId);

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
  const presentation = briefingPresentation(visibleActions, visiblePacing, visiblePreviousWeek, planningProposals, briefing.generatedAt);
  const highlights = presentation.highlights;
  const openHighlights = highlights.filter((item) => item.state === "open");
  const preparedHighlights = highlights.filter((item) => item.state === "prepared");
  const showActionNote = highlights.length > 0;
  const scopeLabel = learner?.displayName;
  const briefingId = briefing.id;
  const summary = briefingSummary(visibleLearners, presentation, learner?.displayName);

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

  function askAboutBriefing() {
    if (!openHighlights.length) {
      const scope = learner ? `${learner.displayName}’s` : "the family’s";
      onAsk(`Give me a very short update on ${scope} week for ${dateRange(snapshot.weekStart, snapshot.weekEnd)}. Tell me only if something now needs my decision. Do not change anything.`);
      return;
    }
    const scope = learner ? `${learner.displayName}’s` : "the family’s";
    onAsk(`Take care of the remaining items in ${scope} weekly briefing for ${dateRange(snapshot.weekStart, snapshot.weekEnd)}: ${openHighlights.map((item) => item.title.toLocaleLowerCase("en-US")).join("; ")}. Prepare the smallest useful next step. Draft schedule or pacing changes as a proposal for my review, and do not apply anything automatically.`);
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
        {openHighlights.length ? <button type="button" onClick={askAboutBriefing}>{preparedHighlights.length || presentation.resolvedThemes ? "Ask Klio to handle the rest" : "Ask Klio to handle this"}</button> : null}
        <p>{briefingTrust(presentation)}</p>
        {error ? <span role="alert">{error}</span> : null}
      </footer>
    </article> : null}
  </section>;
}

export function weeklyBriefingShouldRender(briefing: WeeklyBriefingDTO | null, state: WeeklyBriefingState) {
  return state === "pending" || state === "failed" || (state === "available" && Boolean(briefing));
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
type BriefingHighlight = { theme: string; state: "open" | "prepared"; context: string; title: string; explanation: string; href?: string; linkLabel: string };
type BriefingPresentation = { highlights: BriefingHighlight[]; resolvedThemes: number; latestChangeAt: string | null };

function briefingPresentation(actions: BriefingAction[], pacing: BriefingPacing, previousWeek: PreviousWeek, proposals: BriefingPlanningProposal[], generatedAt: string): BriefingPresentation {
  const seen = new Set<string>();
  const highlights: BriefingHighlight[] = [];
  let resolvedThemes = 0;
  let latestChangeAt: string | null = null;
  for (const action of actions) {
    const theme = actionTheme(action.kind);
    if (seen.has(theme)) continue;
    seen.add(theme);
    const themeActions = actions.filter((candidate) => actionTheme(candidate.kind) === theme);
    const proposalState = proposalStateForTheme(theme, themeActions, pacing, proposals, generatedAt);
    if (proposalState.state !== "open" && (!latestChangeAt || proposalState.proposal.createdAt > latestChangeAt)) latestChangeAt = proposalState.proposal.createdAt;
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
    return { theme, state: "open", context: "This week", title: "One part of the schedule needs a lighter plan", explanation: "Klio can rebalance it around current limits and prepare the change for your approval.", href, linkLabel: "Open week" };
  }
  if (theme === "decide_unfinished") {
    const count = previousWeek?.unfinishedCount ?? 0;
    return { theme, state: "open", context: "Last week", title: count === 1 ? "One lesson is still open" : "A few lessons are still open", explanation: "Klio can fit the unfinished work into this week without disturbing the rest of the plan.", href, linkLabel: "Open week" };
  }
  if (theme === "pacing") {
    const concernCount = pacing.filter((item) => item.kind !== "approved_evidence_trend").length;
    return { theme, state: "open", context: "Pacing", title: concernCount === 1 ? "One course needs a pacing adjustment" : "The pace could use a simpler plan", explanation: "Klio can balance the affected courses and prepare one proposal for your review.", href, linkLabel: "View plan" };
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

function proposalStateForTheme(theme: string, actions: BriefingAction[], pacing: BriefingPacing, proposals: BriefingPlanningProposal[], generatedAt: string): { state: "open" } | { state: "prepared" | "resolved"; proposal: BriefingPlanningProposal } {
  const targetIds = targetIdsForTheme(theme, actions, pacing);
  if (!targetIds.size) return { state: "open" };
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
  if (theme === "schedule_work" && applied.length) return { state: "resolved", proposal: applied[0].proposal };
  const appliedIds = new Set(applied.flatMap(({ ids }) => [...ids]));
  return [...targetIds].every((id) => appliedIds.has(id)) ? { state: "resolved", proposal: applied[0].proposal } : { state: "open" };
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
  return "Nothing changes until you approve it.";
}

function actionAppliesToLearner(action: BriefingAction, learnerId: string) {
  if (typeof action.target.studentId === "string") return action.target.studentId === learnerId;
  if (Array.isArray(action.target.studentIds)) return action.target.studentIds.includes(learnerId);
  return true;
}
