import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { ReviewWorkspace } from "@/components/review-workspace";
import { HelpFilingQueue } from "@/components/help-filing-queue";
import { formatReviewHistory, groupReviewSuggestions, type ReviewHistoryItem, type ReviewSource, type ReviewSuggestion } from "@/lib/review/presentation";
import { Check, ChevronDown, CircleAlert, Clock3, RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { normalizePublicResult, type PublicResult } from "@/lib/agent/workspace/public-result";
import { agentEventLabel } from "@/lib/agent/workspace/presentation";
import { AdjustmentHistoryAction } from "@/components/adjustment-history-action";
import { getFamilyAttention } from "@/lib/data/attention";

type EvidenceRow = { id: string; kind: string; title: string | null; raw_text: string | null; mime_type: string | null; source_at: string };
type ActivitySearchParams = { turn?: string | string[] };
type ConductorTurn = {
  id: string; student_id: string | null; task_name: string | null; subject: string | null; source_count: number | null;
  status: string; normalized_step: string | null; expected_output: string | null; public_result: unknown; error_code: string | null;
  created_at: string; started_at: string | null; completed_at: string | null; last_progress_at: string | null; last_heartbeat_at: string | null; attempt_count: number;
  agent_events: Array<{ sequence: number; kind: string; payload: unknown; created_at: string }>;
};

export default async function ActivityPage({ searchParams }: { searchParams: Promise<ActivitySearchParams> }) {
  const query = await searchParams;
  const requestedTurnId = typeof query.turn === "string" ? query.turn : undefined;
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const attention = await getFamilyAttention(workspace.family.id);
  const { data: requests, error: requestError } = await supabase.from("approval_requests")
    .select("id, requested_by_run, entity_type, entity_id, created_at")
    .eq("family_id", workspace.family.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(300);
  if (requestError) throw requestError;

  const artifactIds = (requests ?? []).filter((request) => request.entity_type === "artifact").map((request) => request.entity_id);
  const observationIds = (requests ?? []).filter((request) => request.entity_type === "skill_observation").map((request) => request.entity_id);
  const [{ data: artifacts, error: artifactError }, { data: observations, error: observationError }, { data: artifactLinks }, { data: observationLinks }, { data: events }, turnsResult, insightsResult, adjustmentsResult] = await Promise.all([
    artifactIds.length ? supabase.from("artifacts").select("id, agent_run_id, student_id, type, title, summary, rationale, content, created_at").eq("family_id", workspace.family.id).eq("status", "draft").in("id", artifactIds) : Promise.resolve({ data: [], error: null }),
    observationIds.length ? supabase.from("skill_observations").select("id, student_id, subject, skill_label, status, rationale, confidence, uncertainty_flags, created_at").eq("family_id", workspace.family.id).eq("approval_status", "draft").in("id", observationIds) : Promise.resolve({ data: [], error: null }),
    artifactIds.length ? supabase.from("artifact_sources").select("artifact_id, evidence_id").eq("family_id", workspace.family.id).in("artifact_id", artifactIds) : Promise.resolve({ data: [], error: null }),
    observationIds.length ? supabase.from("observation_evidence").select("observation_id, evidence_id").eq("family_id", workspace.family.id).in("observation_id", observationIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("audit_events").select("id, action, entity_type, metadata, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("agent_turns").select("id,student_id,task_name,subject,source_count,status,normalized_step,expected_output,public_result,error_code,created_at,started_at,completed_at,last_progress_at,last_heartbeat_at,attempt_count,agent_events(sequence,kind,payload,created_at)").eq("family_id", workspace.family.id).is("dismissed_at", null).order("created_at", { ascending: false }).limit(30),
    supabase.from("klio_insights").select("id,student_id,kind,title,summary,reason,evidence_refs,action_ref,status,created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("adjustment_proposals").select("id,student_id,summary,reason,status,applied_at,undone_at,undo_status,undo_expires_at,acknowledged_at,created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (artifactError) throw artifactError;
  if (observationError) throw observationError;
  if (turnsResult.error) throw turnsResult.error;
  if (insightsResult.error) throw insightsResult.error;
  if (adjustmentsResult.error) throw adjustmentsResult.error;

  const evidenceIds = [...new Set([...(artifactLinks ?? []).map((link) => link.evidence_id), ...(observationLinks ?? []).map((link) => link.evidence_id)])];
  const { data: evidence, error: evidenceError } = evidenceIds.length
    ? await supabase.from("evidence_items").select("id, kind, title, raw_text, mime_type, source_at").eq("family_id", workspace.family.id).in("id", evidenceIds)
    : { data: [], error: null };
  if (evidenceError) throw evidenceError;

  const studentNames = new Map(workspace.students.map((student) => [student.id, student.displayName]));
  const evidenceById = new Map((evidence as EvidenceRow[]).map((item) => [item.id, toSource(item)]));
  const artifactById = new Map((artifacts ?? []).map((item) => [item.id, item]));
  const observationById = new Map((observations ?? []).map((item) => [item.id, item]));
  const artifactEvidence = new Map<string, string[]>();
  for (const link of artifactLinks ?? []) artifactEvidence.set(link.artifact_id, [...(artifactEvidence.get(link.artifact_id) ?? []), link.evidence_id]);
  const observationEvidence = new Map<string, string[]>();
  for (const link of observationLinks ?? []) observationEvidence.set(link.observation_id, [...(observationEvidence.get(link.observation_id) ?? []), link.evidence_id]);

  const suggestions: ReviewSuggestion[] = [];
  let staleCount = 0;
  for (const request of requests ?? []) {
    if (request.entity_type === "artifact") {
      const artifact = artifactById.get(request.entity_id);
      if (!artifact) { staleCount += 1; continue; }
      const content = artifact.content && typeof artifact.content === "object" && !Array.isArray(artifact.content) ? artifact.content as Record<string, unknown> : {};
      suggestions.push({
        requestId: request.id, runId: request.requested_by_run ?? artifact.agent_run_id, entityType: "artifact", id: artifact.id,
        studentName: artifact.student_id ? studentNames.get(artifact.student_id) ?? "Learner" : "Family", createdAt: artifact.created_at,
        label: "Something Klio made", conclusion: artifact.title, explanation: artifact.rationale || artifact.summary || "Klio made this from the work you shared.",
        consequence: "This draft will be available to use in plans and learning records.", uncertainty: stringArray(content.uncertainty_flags),
        sources: (artifactEvidence.get(artifact.id) ?? []).map((id) => evidenceById.get(id)).filter(Boolean) as ReviewSource[],
        artifact: { type: artifact.type, summary: artifact.summary, overview: typeof content.overview === "string" ? content.overview : null },
      });
    } else {
      const observation = observationById.get(request.entity_id);
      if (!observation) { staleCount += 1; continue; }
      suggestions.push({
        requestId: request.id, runId: request.requested_by_run, entityType: "skill_observation", id: observation.id,
        studentName: studentNames.get(observation.student_id) ?? "Learner", createdAt: observation.created_at,
        label: "Something Klio noticed", conclusion: observation.skill_label, explanation: observation.rationale,
        consequence: "Klio will use this when suggesting what to practice and plan next.", confidence: observation.confidence,
        uncertainty: stringArray(observation.uncertainty_flags), status: observation.status as ReviewSuggestion["status"], subject: observation.subject,
        sources: (observationEvidence.get(observation.id) ?? []).map((id) => evidenceById.get(id)).filter(Boolean) as ReviewSource[],
      });
    }
  }

  const groups = groupReviewSuggestions(suggestions);
  const history: ReviewHistoryItem[] = (events ?? []).map((event) => formatReviewHistory(event));
  const unfiled = workspace.evidence.filter((item) => item.captureRoute !== "reminder" && item.kind !== "practice_result" && (item.status === "needs_review" || (item.status === "ready" && item.categories.length === 0)));
  const turns = turnsResult.data ?? [];
  const receiptItems = turns.slice(0, 12);
  const meaningfulInsights = insightsResult.data.filter((item) => item.status !== "dismissed").slice(0, 12);
  const acknowledgedAdjustments = adjustmentsResult.data.filter((item) => item.acknowledged_at).slice(0, 12);
  const adjustmentById = new Map(adjustmentsResult.data.map((item) => [item.id, item]));
  const openTurns = turns.filter((turn) => !["completed", "cancelled"].includes(turn.status));
  const selectedTurn = turns.find((turn) => turn.id === requestedTurnId) ?? openTurns[0] ?? turns[0] ?? null;
  const receiptRows = receiptItems.map((turn) => {
    const learner = workspace.students.find((student) => student.id === turn.student_id)?.displayName;
    const stale = isStaleTurn(turn);
    const result = normalizePublicResult(turn.public_result);
    const status = stale ? "Klio paused" : receiptStatus(turn.status);
    const metadata = [learner, turn.subject, turn.source_count ? `${turn.source_count} ${turn.source_count === 1 ? "source" : "sources"}` : null].filter(Boolean).join(" · ") || turn.expected_output;
    return { createdAt: turn.created_at, row: <details className="activity-row" key={turn.id}><summary><i className={stale || turn.status === "failed" ? "failed" : turn.status === "completed" ? "done" : "active"}>{stale || turn.status === "failed" ? <CircleAlert size={14} /> : turn.status === "completed" ? <Check size={14} /> : <Clock3 size={14} />}</i><span><small>{status} · Work receipt</small><strong>{turn.task_name || "Family handoff"}</strong><em>{metadata}</em></span><time>{shortActivityDate(turn.created_at)}</time><ChevronDown size={15} /></summary><div className="activity-row-detail"><blockquote>{result.message}</blockquote><ActivityReceiptDetails result={result} /></div></details> };
  });
  const changeRows: Array<{ createdAt: string; row: ReactNode }> = meaningfulInsights.map((insight) => {
    const action = jsonObject(insight.action_ref);
    const proposal = typeof action.proposalId === "string" ? adjustmentById.get(action.proposalId) : null;
    const refs = jsonArray(insight.evidence_refs).map(jsonObject);
    return { createdAt: insight.created_at, row: <details className="activity-row" key={insight.id}><summary><i className="noticed"><Sparkles size={14} /></i><span><small>{insight.kind.replaceAll("_", " ")} · Observation</small><strong>{insight.title}</strong><em>{refs.length} supporting {refs.length === 1 ? "record" : "records"}</em></span><time>{shortActivityDate(insight.created_at)}</time><ChevronDown size={15} /></summary><div className="activity-row-detail"><p>{insight.summary}</p>{refs.some((ref) => typeof ref.score === "number") ? <div className="activity-evidence-chips">{refs.filter((ref) => typeof ref.score === "number").map((ref, index) => <span key={`${String(ref.id)}-${index}`}>{Math.round(Number(ref.score))}% · {typeof ref.skillKey === "string" ? ref.skillKey.replaceAll(/[._-]/g, " ") : "approved result"}</span>)}</div> : null}{proposal?.status === "undone" ? <b className="activity-change-state"><RotateCcw size={12} />Undone</b> : proposal?.status === "applied" ? <b className="activity-change-state">Applied</b> : null}</div></details> };
  });
  changeRows.push(...acknowledgedAdjustments.map((proposal) => ({ createdAt: proposal.acknowledged_at!, row: <details className="activity-row" key={`acknowledged-${proposal.id}`}><summary><i className="changed"><RotateCcw size={14} /></i><span><small>Schedule update · Change</small><strong>{proposal.summary}</strong><em>{studentNames.get(proposal.student_id) ?? "Learner"}</em></span><time>{shortActivityDate(proposal.acknowledged_at!)}</time><ChevronDown size={15} /></summary><div className="activity-row-detail"><p>{proposal.reason}</p><AdjustmentHistoryAction proposalId={proposal.id} status={proposal.status} undoStatus={proposal.undo_status} /></div></details> })));
  const activityRows = [...receiptRows, ...changeRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="section-page activity-page">
      <header><p className="eyebrow">Family workspace</p><h1>Conductor</h1><p>See what Klio is handling, what changed, and where your input is needed—without mixing the work feed into the conversation.</p></header>
      <section className={`attention-strip ${attention.total ? "needs-attention" : "all-clear"}`} aria-labelledby="attention-heading"><header><i>{attention.total ? <CircleAlert size={16} /> : <Check size={16} />}</i><div><span>Current status</span><h2 id="attention-heading">{attention.total ? `${attention.total} ${attention.total === 1 ? "item needs" : "items need"} your attention` : "Nothing needs you right now"}</h2></div></header>{attention.items.length ? <nav aria-label="Attention categories">{attention.items.map((item) => <Link href={item.href} key={item.key}><span>{item.label}</span><b>{item.count}</b></Link>)}</nav> : null}</section>
      <ConductorWorkspace turns={turns} selectedTurn={selectedTurn} studentNames={studentNames} openCount={openTurns.length} />
      {unfiled.length || groups.length ? <section id="decisions" className="activity-decisions"><header><p className="eyebrow">Needs one detail</p><h2>Your review</h2></header><HelpFilingQueue familyId={workspace.family.id} categories={workspace.categories} initialItems={unfiled} students={workspace.students} />{groups.length || !unfiled.length ? <ReviewWorkspace familyId={workspace.family.id} initialGroups={groups} initialHistory={history} staleCount={staleCount} /> : null}</section> : null}
      <section id="receipts" className="activity-history" aria-labelledby="history-heading"><header><div><p className="eyebrow">Recent activity</p><h2 id="history-heading">What happened</h2></div><p>Open any row for its full receipt.</p></header><ActivityTimeline rows={activityRows} /></section>
    </div>
  );
}

function ConductorWorkspace({ turns, selectedTurn, studentNames, openCount }: { turns: ConductorTurn[]; selectedTurn: ConductorTurn | null; studentNames: Map<string, string>; openCount: number }) {
  const selectedState = selectedTurn ? conductorState(selectedTurn) : null;
  const selectedLearner = selectedTurn?.student_id ? studentNames.get(selectedTurn.student_id) : null;
  const selectedResult = selectedTurn?.public_result ? normalizePublicResult(selectedTurn.public_result) : null;
  const selectedEvents = selectedTurn ? [...selectedTurn.agent_events].sort((a, b) => a.sequence - b.sequence) : [];
  return <section id="conductor" className="conductor-workspace" aria-labelledby="conductor-heading">
    <header><div><p className="eyebrow">Agent work</p><h2 id="conductor-heading">Klio’s work queue</h2></div><span>{openCount ? `${openCount} open` : "All caught up"}</span></header>
    <div className="conductor-shell">
      <nav className="conductor-inbox" aria-label="Klio work">
        {turns.length ? turns.slice(0, 16).map((turn) => {
          const state = conductorState(turn);
          const learner = turn.student_id ? studentNames.get(turn.student_id) : null;
          return <Link href={`/app/activity?turn=${encodeURIComponent(turn.id)}#conductor`} className={turn.id === selectedTurn?.id ? "selected" : ""} aria-current={turn.id === selectedTurn?.id ? "true" : undefined} key={turn.id}>
            <i className={state.tone}>{state.tone === "finished" ? <Check size={13} /> : state.tone === "needs-detail" || state.tone === "paused" ? <CircleAlert size={13} /> : <Clock3 size={13} />}</i>
            <span><small>{state.label}</small><strong>{turn.task_name || "Family handoff"}</strong><em>{[learner, turn.subject].filter(Boolean).join(" · ") || "Family workspace"}</em></span>
            <time>{shortActivityDate(turn.created_at)}</time>
          </Link>;
        }) : <div className="conductor-empty"><Sparkles size={18} /><strong>No Klio work yet</strong><p>Work you hand to Klio will appear here with a live, readable history.</p></div>}
      </nav>
      <article className="conductor-detail" aria-live="polite">
        {selectedTurn && selectedState ? <>
          <header><div><span className={`conductor-state ${selectedState.tone}`}>{selectedState.label}</span><h3>{selectedTurn.task_name || "Family handoff"}</h3><p>{[selectedLearner, selectedTurn.subject, selectedTurn.source_count ? `${selectedTurn.source_count} ${selectedTurn.source_count === 1 ? "source" : "sources"}` : null].filter(Boolean).join(" · ") || "Family workspace"}</p></div><time>{fullActivityDate(selectedTurn.created_at)}</time></header>
          {selectedTurn.expected_output ? <div className="conductor-output"><span>Working toward</span><p>{selectedTurn.expected_output}</p></div> : null}
          <section className="conductor-feed" aria-labelledby={`feed-${selectedTurn.id}`}><header><h4 id={`feed-${selectedTurn.id}`}>Work feed</h4><span>{selectedEvents.length} {selectedEvents.length === 1 ? "update" : "updates"}</span></header>
            <ol>{selectedEvents.length ? selectedEvents.map((event, index) => <li className={index === selectedEvents.length - 1 && ["working", "queued"].includes(selectedState.tone) ? "current" : ""} key={`${event.sequence}-${event.kind}`}><i>{index < selectedEvents.length - 1 || selectedState.tone === "finished" ? <Check size={11} /> : <span />}</i><div><strong>{conductorEventText(event)}</strong><time>{shortActivityTime(event.created_at)}</time></div></li>) : <li className="current"><i><span /></i><div><strong>{selectedState.tone === "queued" ? "Waiting for Klio to begin" : selectedState.label}</strong><time>{shortActivityTime(selectedTurn.created_at)}</time></div></li>}</ol>
          </section>
          {selectedResult ? <section className="conductor-result"><span>{selectedTurn.status === "completed" ? "Result" : "Latest handoff"}</span><blockquote>{selectedResult.message}</blockquote><ActivityReceiptDetails result={selectedResult} /></section> : selectedState.tone === "paused" ? <section className="conductor-result paused"><span>What happened</span><p>The original request and family data are safe. You can return to Home and retry this work.</p></section> : null}
        </> : <div className="conductor-detail-empty"><Sparkles size={20} /><h3>Klio’s work will stay visible here</h3><p>Start from Home, keep the conversation going there, and use Conductor when you want the operational detail.</p></div>}
      </article>
    </div>
  </section>;
}

function ActivityTimeline({ rows }: { rows: Array<{ createdAt: string; row: ReactNode }> }) {
  const recent = rows.slice(0, 6);
  const older = rows.slice(6);
  return <div className="activity-stream">{recent.length ? recent.map((item) => item.row) : <p className="activity-empty">Activity will appear here after Klio handles something.</p>}{older.length ? <details className="activity-older"><summary>Show {older.length} earlier {older.length === 1 ? "event" : "events"}<ChevronDown size={14} /></summary><div>{older.map((item) => item.row)}</div></details> : null}</div>;
}

function ActivityReceiptDetails({ result }: { result: PublicResult }) {
  const sections = [["Understood", result.understood], ["Used", result.used], ["Changed", result.changed], ["Still needs you", result.remaining]] as const;
  return <div className="activity-receipt-details">
    {sections.filter(([, items]) => items.length).map(([label, items]) => <p key={label}><b>{label}:</b> {items.join(" · ")}</p>)}
    {result.actions.length ? <nav aria-label="Receipt actions">{result.actions.map((action) => <Link href={action.href} key={`${action.verb}:${action.targetType}:${action.targetId}`}>{action.label}</Link>)}</nav> : null}
  </div>;
}

function toSource(item: EvidenceRow): ReviewSource {
  return { id: item.id, kind: item.kind, title: item.title, rawText: item.raw_text, mimeType: item.mime_type, sourceAt: item.source_at };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function jsonArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function jsonObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function receiptStatus(status: string) { return ({ queued: "Waiting to start", running: "In progress", awaiting_parent: "Waiting for one detail", completed: "Finished", failed: "Could not finish", cancelled: "Cancelled" } as Record<string,string>)[status] ?? status.replaceAll("_", " "); }
function isStaleTurn(turn: { status: string; created_at: string; last_heartbeat_at: string | null }) { const age = Date.now() - new Date(turn.last_heartbeat_at ?? turn.created_at).getTime(); return turn.status === "running" ? age > 90_000 : turn.status === "queued" ? age > 120_000 : false; }
function shortActivityDate(value: string) { return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function shortActivityTime(value: string) { return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fullActivityDate(value: string) { return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function conductorState(turn: Pick<ConductorTurn, "status" | "created_at" | "last_heartbeat_at">) {
  if (isStaleTurn(turn)) return { tone: "paused", label: "Paused" };
  if (turn.status === "awaiting_parent") return { tone: "needs-detail", label: "Needs your input" };
  if (turn.status === "failed") return { tone: "paused", label: "Needs a retry" };
  if (turn.status === "running") return { tone: "working", label: "Working" };
  if (turn.status === "queued") return { tone: "queued", label: "Queued" };
  if (turn.status === "cancelled") return { tone: "finished", label: "Cancelled" };
  return { tone: "finished", label: "Finished" };
}
function conductorEventText(event: { kind: string; payload: unknown }) {
  const payload = jsonObject(event.payload);
  if (typeof payload.message === "string") {
    if (payload.message.trimStart().startsWith("{")) return "Prepared the parent-facing answer";
    if (event.kind === "agent.progress") return payload.message;
  }
  if (event.kind === "clarification.cancelled") return "Stopped waiting for that detail";
  return agentEventLabel(event.kind, event.payload);
}
