import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { ReviewWorkspace } from "@/components/review-workspace";
import { HelpFilingQueue } from "@/components/help-filing-queue";
import { formatReviewHistory, groupReviewSuggestions, type ReviewHistoryItem, type ReviewSource, type ReviewSuggestion } from "@/lib/review/presentation";
import { ArrowLeft, Check, ChevronDown, ChevronRight, CircleAlert, Clock3, RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { normalizePublicResult, type PublicResult } from "@/lib/agent/workspace/public-result";
import { AdjustmentHistoryAction } from "@/components/adjustment-history-action";
import { getFamilyAttention } from "@/lib/data/attention";
import { ActivityReminderList } from "@/components/activity-reminder-list";

type EvidenceRow = { id: string; kind: string; title: string | null; raw_text: string | null; mime_type: string | null; source_at: string };
type ActivitySearchParams = { focus?: string | string[] };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<ActivitySearchParams> }) {
  const query = await searchParams;
  const focus = typeof query.focus === "string" ? query.focus : undefined;
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
  const [{ data: artifacts, error: artifactError }, { data: observations, error: observationError }, { data: artifactLinks }, { data: observationLinks }, { data: events }, turnsResult, insightsResult, adjustmentsResult, briefingsResult] = await Promise.all([
    artifactIds.length ? supabase.from("artifacts").select("id, agent_run_id, student_id, type, title, summary, rationale, content, created_at").eq("family_id", workspace.family.id).eq("status", "draft").in("id", artifactIds) : Promise.resolve({ data: [], error: null }),
    observationIds.length ? supabase.from("skill_observations").select("id, student_id, subject, skill_label, status, rationale, confidence, uncertainty_flags, created_at").eq("family_id", workspace.family.id).eq("approval_status", "draft").in("id", observationIds) : Promise.resolve({ data: [], error: null }),
    artifactIds.length ? supabase.from("artifact_sources").select("artifact_id, evidence_id").eq("family_id", workspace.family.id).in("artifact_id", artifactIds) : Promise.resolve({ data: [], error: null }),
    observationIds.length ? supabase.from("observation_evidence").select("observation_id, evidence_id").eq("family_id", workspace.family.id).in("observation_id", observationIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("audit_events").select("id, action, entity_type, metadata, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("agent_turns").select("id,student_id,task_name,subject,source_count,status,normalized_step,expected_output,public_result,error_code,created_at,started_at,completed_at,last_progress_at,last_heartbeat_at,attempt_count").eq("family_id", workspace.family.id).is("dismissed_at", null).order("created_at", { ascending: false }).limit(30),
    supabase.from("klio_insights").select("id,student_id,kind,title,summary,reason,evidence_refs,action_ref,status,created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("adjustment_proposals").select("id,student_id,summary,reason,status,applied_at,undone_at,undo_status,undo_expires_at,acknowledged_at,created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("weekly_briefings").select("id,week_start,status,headline,summary,generated_at,viewed_at,dismissed_at").eq("family_id", workspace.family.id).order("week_start", { ascending: false }).limit(12),
  ]);
  if (artifactError) throw artifactError;
  if (observationError) throw observationError;
  if (turnsResult.error) throw turnsResult.error;
  if (insightsResult.error) throw insightsResult.error;
  if (adjustmentsResult.error) throw adjustmentsResult.error;
  if (briefingsResult.error) throw briefingsResult.error;

  const evidenceIds = [...new Set([...(artifactLinks ?? []).map((link) => link.evidence_id), ...(observationLinks ?? []).map((link) => link.evidence_id)])];
  const { data: evidence, error: evidenceError } = evidenceIds.length
    ? await supabase.from("evidence_items").select("id, kind, title, raw_text, mime_type, source_at").eq("family_id", workspace.family.id).in("id", evidenceIds)
    : { data: [], error: null };
  if (evidenceError) throw evidenceError;

  const studentNames = new Map(workspace.students.map((student) => [student.id, student.displayName]));
  const overdueReminderCount = attention.items.find((item) => item.key === "reminders")?.count ?? 0;
  const overdueReminders = workspace.reminders.filter((reminder) => reminder.status === "pending" && reminder.dueAt).slice(0, overdueReminderCount);
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
  const receiptRows = receiptItems.map((turn) => {
    const learner = workspace.students.find((student) => student.id === turn.student_id)?.displayName;
    const stale = isStaleTurn(turn);
    const result = normalizePublicResult(turn.public_result);
    const status = stale ? "Klio paused" : receiptStatus(turn.status);
    const metadata = [learner, turn.subject].filter(Boolean).join(" · ") || "Family";
    const title = receiptTitle(turn.task_name, result.message);
    return { createdAt: turn.created_at, row: <details className="activity-row" key={turn.id}><summary><i className={stale || turn.status === "failed" ? "failed" : turn.status === "completed" ? "done" : "active"}>{stale || turn.status === "failed" ? <CircleAlert size={16} /> : turn.status === "completed" ? <Check size={16} /> : <Clock3 size={16} />}</i><span><small>{status}</small><strong>{title}</strong><em>{metadata}</em></span><time>{activityDate(turn.created_at)}</time><ChevronDown size={16} /></summary><div className="activity-row-detail"><blockquote>{result.message}</blockquote><ActivityReceiptDetails result={result} /></div></details> };
  });
  const changeRows: Array<{ createdAt: string; row: ReactNode }> = meaningfulInsights.map((insight) => {
    const action = jsonObject(insight.action_ref);
    const proposal = typeof action.proposalId === "string" ? adjustmentById.get(action.proposalId) : null;
    const refs = jsonArray(insight.evidence_refs).map(jsonObject);
    const learner = insight.student_id ? studentNames.get(insight.student_id) : null;
    const evidenceLabel = refs.length ? `${refs.length} supporting ${refs.length === 1 ? "record" : "records"}` : null;
    return { createdAt: insight.created_at, row: <details className="activity-row" key={insight.id}><summary><i className="noticed"><Sparkles size={16} /></i><span><small>Klio noticed</small><strong>{insight.title}</strong><em>{[learner, evidenceLabel].filter(Boolean).join(" · ") || "Family"}</em></span><time>{activityDate(insight.created_at)}</time><ChevronDown size={16} /></summary><div className="activity-row-detail"><p>{insight.summary}</p>{refs.some((ref) => typeof ref.score === "number") ? <div className="activity-evidence-chips">{refs.filter((ref) => typeof ref.score === "number").map((ref, index) => <span key={`${String(ref.id)}-${index}`}>{Math.round(Number(ref.score))}% · {typeof ref.skillKey === "string" ? ref.skillKey.replaceAll(/[._-]/g, " ") : "approved result"}</span>)}</div> : null}{proposal?.status === "undone" ? <b className="activity-change-state"><RotateCcw size={12} />Undone</b> : proposal?.status === "applied" ? <b className="activity-change-state"><Check size={12} />Applied</b> : null}</div></details> };
  });
  changeRows.push(...acknowledgedAdjustments.map((proposal) => {
    const learner = studentNames.get(proposal.student_id) ?? "Learner";
    return { createdAt: proposal.acknowledged_at!, row: <details className="activity-row" key={`acknowledged-${proposal.id}`}><summary><i className="changed"><RotateCcw size={16} /></i><span><small>Schedule update</small><strong>{learner}’s schedule was adjusted</strong><em>{scheduleUpdateLabel(proposal.summary)}</em></span><time>{activityDate(proposal.acknowledged_at!)}</time><ChevronDown size={16} /></summary><div className="activity-row-detail"><blockquote>{proposal.summary}</blockquote><p>{proposal.reason}</p><AdjustmentHistoryAction proposalId={proposal.id} status={proposal.status} undoStatus={proposal.undo_status} /></div></details> };
  }));
  changeRows.push(...briefingsResult.data.map((briefing) => ({ createdAt: briefing.generated_at, row: <details className="activity-row" key={`weekly-briefing-${briefing.id}`}><summary><i className="noticed"><Sparkles size={16} /></i><span><small>Weekly summary</small><strong>{briefing.headline}</strong><em>Week of {shortActivityDate(`${briefing.week_start}T12:00:00Z`)}</em></span><time>{activityDate(briefing.generated_at)}</time><ChevronDown size={16} /></summary><div className="activity-row-detail"><p>{briefing.summary}</p><Link className="activity-detail-link" href={`/app/week?date=${briefing.week_start}`}>Open this week<ChevronRight size={14} /></Link></div></details> })));
  const activityRows = [...receiptRows, ...changeRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="section-page activity-page">
      <header><h1>Activity</h1><p>Anything that needs you stays at the top. Klio’s completed work is saved below.</p></header>
      <section className={`attention-strip ${attention.total ? "needs-attention" : "all-clear"}`} aria-labelledby="attention-heading">
        <header><i>{attention.total ? <CircleAlert size={18} /> : <Check size={18} />}</i><div><h2 id="attention-heading">{attention.total ? "Needs you" : "You’re caught up"}</h2><p>{attention.total ? `${attention.total} ${attention.total === 1 ? "decision is" : "decisions are"} waiting for you.` : "No decisions are waiting."}</p></div></header>
        {attention.items.length ? <nav aria-label="Attention categories">{attention.items.map((item) => <Link href={item.href} aria-current={focus === item.key ? "page" : undefined} key={item.key}><span>{item.label}</span><b>{item.count}</b><ChevronRight size={16} /></Link>)}</nav> : null}
      </section>
      {focus === "reminders" ? <section id="overdue-reminders" className="activity-reminders" aria-labelledby="overdue-reminders-heading">
        <header><div><p>Needs you</p><h2 id="overdue-reminders-heading">Overdue reminders</h2><span>Mark finished work done, move what still matters, or dismiss what no longer applies.</span></div><Link href="/app/activity"><ArrowLeft size={14} />All activity</Link></header>
        <ActivityReminderList initialReminders={overdueReminders} studentNames={Object.fromEntries(studentNames)} />
      </section> : null}
      {unfiled.length || groups.length ? <section id="decisions" className="activity-decisions"><header><h2>Ready for your review</h2><p>Confirm or correct only the items below.</p></header><HelpFilingQueue familyId={workspace.family.id} categories={workspace.categories} initialItems={unfiled} students={workspace.students} />{groups.length || !unfiled.length ? <ReviewWorkspace familyId={workspace.family.id} initialGroups={groups} initialHistory={history} staleCount={staleCount} /> : null}</section> : null}
      <section id="receipts" className="activity-history" aria-labelledby="history-heading"><header><div><h2 id="history-heading">What happened</h2><p>Recent changes and completed work.</p></div><p>Open a row for details, evidence, or undo.</p></header><ActivityTimeline rows={activityRows} /></section>
    </div>
  );
}

function ActivityTimeline({ rows }: { rows: Array<{ createdAt: string; row: ReactNode }> }) {
  const recent = rows.slice(0, 5);
  const older = rows.slice(5);
  return <div className="activity-stream">{recent.length ? recent.map((item) => item.row) : <p className="activity-empty">Activity will appear here after Klio handles something.</p>}{older.length ? <details className="activity-older"><summary>Show {older.length} earlier {older.length === 1 ? "event" : "events"}<ChevronDown size={14} /></summary><div>{older.map((item) => item.row)}</div></details> : null}</div>;
}

function ActivityReceiptDetails({ result }: { result: PublicResult }) {
  const sections = [["What Klio understood", result.understood], ["What Klio used", result.used], ["What changed", result.changed], ["What still needs you", result.remaining]] as const;
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
function receiptStatus(status: string) { return ({ queued: "Waiting to start", running: "In progress", awaiting_parent: "Waiting for one detail", completed: "Done", failed: "Could not finish", cancelled: "Cancelled" } as Record<string,string>)[status] ?? status.replaceAll("_", " "); }
function isStaleTurn(turn: { status: string; created_at: string; last_heartbeat_at: string | null }) { const age = Date.now() - new Date(turn.last_heartbeat_at ?? turn.created_at).getTime(); return turn.status === "running" ? age > 90_000 : turn.status === "queued" ? age > 120_000 : false; }
function shortActivityDate(value: string) { return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function activityDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  return shortActivityDate(value);
}
function receiptTitle(taskName: string | null, message: string) {
  const name = taskName?.trim();
  const generic = !name || /^(handling a family handoff|family handoff|answering your question|working with klio)$/i.test(name);
  if (!generic) return name;
  const firstSentence = message.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (!firstSentence) return "Klio handled a family update";
  return firstSentence.length > 92 ? `${firstSentence.slice(0, 89).trimEnd()}…` : firstSentence;
}
function scheduleUpdateLabel(summary: string) {
  const firstSentence = summary.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (/preserv(?:e|ed|ing)(?: (?:course|curriculum))? order/i.test(firstSentence)) return "Course order preserved";
  return firstSentence.length > 72 ? `${firstSentence.slice(0, 69).trimEnd()}…` : firstSentence;
}
