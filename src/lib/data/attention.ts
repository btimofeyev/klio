import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { buildScheduleDecisionPresentation, planningProposalAssignmentIds, planningProposalNeedsDecision, scheduleDecisionInsightIsScheduleQuestion, scheduleDecisionIsRepresentedElsewhere } from "@/lib/product/workspace-insight-presentation";

export type AttentionItem = { key: string; label: string; count: number; href: string };
export type FamilyAttention = { total: number; items: AttentionItem[] };

export const getFamilyAttention = cache(async (familyId: string): Promise<FamilyAttention> => {
  const supabase = await createClient();
  const now = new Date();
  const staleRunningBefore = new Date(now.getTime() - 90_000).toISOString();
  const staleQueuedBefore = new Date(now.getTime() - 120_000).toISOString();
  const [reviews, approvals, evidence, reminders, turns, adjustments, plans, insights, students] = await Promise.all([
    supabase.from("assignment_reviews").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "draft"),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "pending"),
    supabase.from("evidence_items").select("id,kind,processing_status,evidence_categories(category_id)").eq("family_id", familyId).in("processing_status", ["ready", "needs_review"]),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "pending").lt("due_at", now.toISOString()),
    supabase.from("agent_turns").select("id,status,snapshot_summary,student_id,created_at,last_heartbeat_at").eq("family_id", familyId).is("dismissed_at", null).in("status", ["queued", "running", "awaiting_parent", "failed"]),
    supabase.from("adjustment_proposals").select("id,status,acknowledged_at").eq("family_id", familyId).or("status.eq.proposed,and(status.eq.applied,acknowledged_at.is.null)"),
    supabase.from("planning_proposals").select("id,student_id,status,summary,action_name,target_assignment_id,proposed_changes,created_at").eq("family_id", familyId).in("status", ["proposed", "applied"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("klio_insights").select("id,student_id,kind,evidence_refs,action_ref,created_at").eq("family_id", familyId).eq("status", "active").eq("kind", "needs_detail"),
    supabase.from("students").select("id,display_name").eq("family_id", familyId).eq("active", true),
  ]);
  const error = reviews.error ?? approvals.error ?? evidence.error ?? reminders.error ?? turns.error ?? adjustments.error ?? plans.error ?? insights.error ?? students.error;
  if (error) throw error;

  const planningProposals = (plans.data ?? []).map((proposal) => ({
    id: proposal.id,
    studentId: proposal.student_id,
    status: proposal.status,
    summary: proposal.summary,
    actionName: proposal.action_name,
    targetAssignmentId: proposal.target_assignment_id,
    changes: proposal.proposed_changes,
    createdAt: proposal.created_at,
  }));
  const insightAssignmentIds = (insights.data ?? []).flatMap((insight) => Array.isArray(insight.evidence_refs) ? insight.evidence_refs.flatMap(evidenceAssignmentId) : []);
  const planningAssignmentIds = [...new Set([...planningProposals.flatMap((proposal) => [...planningProposalAssignmentIds(proposal)]), ...insightAssignmentIds])];
  const planningAssignments = planningAssignmentIds.length
    ? await supabase.from("assignments").select("id,student_id,title,subject,estimated_minutes,scheduled_date,status").eq("family_id", familyId).in("id", planningAssignmentIds)
    : { data: [], error: null };
  if (planningAssignments.error) throw planningAssignments.error;
  const planningAssignmentStates = planningAssignments.data.map((assignment) => ({
    id: assignment.id,
    studentId: assignment.student_id,
    title: assignment.title,
    subject: assignment.subject,
    estimatedMinutes: assignment.estimated_minutes,
    scheduledDate: assignment.scheduled_date,
    status: assignment.status,
  }));
  const actionablePlanCount = planningProposals.filter((proposal) => planningProposalNeedsDecision(proposal, planningAssignmentStates)).length;
  const studentStates = (students.data ?? []).map((student) => ({ id: student.id, displayName: student.display_name }));
  const unresolvedInsightCount = (insights.data ?? []).filter((insight) => {
    const input = { studentId: insight.student_id, kind: insight.kind, evidenceRefs: Array.isArray(insight.evidence_refs) ? insight.evidence_refs : [], actionRef: insight.action_ref, createdAt: insight.created_at };
    const presentation = buildScheduleDecisionPresentation(input, planningAssignmentStates, studentStates);
    if (!presentation) return !scheduleDecisionInsightIsScheduleQuestion(input);
    const activeTurns = (turns.data ?? []).map((turn) => ({ status: turn.status, request: turnRequest(turn.snapshot_summary), studentId: turn.student_id }));
    return !scheduleDecisionIsRepresentedElsewhere(presentation, planningProposals, activeTurns);
  }).length;

  const unfiled = (evidence.data ?? []).filter((item) => item.kind !== "practice_result" && (item.processing_status === "needs_review" || (item.processing_status === "ready" && item.evidence_categories.length === 0))).length;
  const agentNeedsParent = (turns.data ?? []).filter((turn) => turn.status === "awaiting_parent" || turn.status === "failed" || (turn.status === "running" && (turn.last_heartbeat_at ?? turn.created_at) < staleRunningBefore) || (turn.status === "queued" && turn.created_at < staleQueuedBefore)).length;
  const items: AttentionItem[] = [
    { key: "reviews", label: "Reviews to confirm", count: reviews.count ?? 0, href: "/app/review" },
    { key: "approvals", label: "Klio drafts to approve", count: approvals.count ?? 0, href: "/app/activity#decisions" },
    { key: "filing", label: "Records needing a learner or subject", count: unfiled, href: "/app/activity#decisions" },
    { key: "agent", label: "Klio jobs needing you", count: agentNeedsParent, href: "/app/activity#receipts" },
    { key: "schedule", label: "Schedule changes to review", count: adjustments.data?.length ?? 0, href: "/app/adjustments" },
    { key: "plans", label: "Plans awaiting a decision", count: actionablePlanCount, href: "/app/adjustments" },
    { key: "details", label: "Questions needing one detail", count: unresolvedInsightCount, href: "/app/activity#decisions" },
    { key: "reminders", label: "Overdue reminders", count: reminders.count ?? 0, href: "/app/activity?focus=reminders#overdue-reminders" },
  ].filter((item) => item.count > 0);
  return { total: items.reduce((sum, item) => sum + item.count, 0), items };
});

function evidenceAssignmentId(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const ref = value as Record<string, unknown>;
  return ref.type === "assignment" && typeof ref.id === "string" ? [ref.id] : [];
}

function turnRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof (value as Record<string, unknown>).request === "string" ? (value as Record<string, string>).request : "";
}
