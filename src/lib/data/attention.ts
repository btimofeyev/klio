import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AttentionItem = { key: string; label: string; count: number; href: string };
export type FamilyAttention = { total: number; items: AttentionItem[] };

export const getFamilyAttention = cache(async (familyId: string): Promise<FamilyAttention> => {
  const supabase = await createClient();
  const now = new Date();
  const staleRunningBefore = new Date(now.getTime() - 90_000).toISOString();
  const staleQueuedBefore = new Date(now.getTime() - 120_000).toISOString();
  const [reviews, approvals, evidence, reminders, turns, adjustments, plans, insights] = await Promise.all([
    supabase.from("assignment_reviews").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "draft"),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "pending"),
    supabase.from("evidence_items").select("id,kind,processing_status,evidence_categories(category_id)").eq("family_id", familyId).in("processing_status", ["ready", "needs_review"]),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "pending").lt("due_at", now.toISOString()),
    supabase.from("agent_turns").select("id,status,created_at,last_heartbeat_at").eq("family_id", familyId).is("dismissed_at", null).in("status", ["queued", "running", "awaiting_parent", "failed"]),
    supabase.from("adjustment_proposals").select("id,status,acknowledged_at").eq("family_id", familyId).or("status.eq.proposed,and(status.eq.applied,acknowledged_at.is.null)"),
    supabase.from("planning_proposals").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "proposed"),
    supabase.from("klio_insights").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "active").eq("kind", "needs_detail"),
  ]);
  const error = reviews.error ?? approvals.error ?? evidence.error ?? reminders.error ?? turns.error ?? adjustments.error ?? plans.error ?? insights.error;
  if (error) throw error;

  const unfiled = (evidence.data ?? []).filter((item) => item.kind !== "practice_result" && (item.processing_status === "needs_review" || (item.processing_status === "ready" && item.evidence_categories.length === 0))).length;
  const agentNeedsParent = (turns.data ?? []).filter((turn) => turn.status === "awaiting_parent" || turn.status === "failed" || (turn.status === "running" && (turn.last_heartbeat_at ?? turn.created_at) < staleRunningBefore) || (turn.status === "queued" && turn.created_at < staleQueuedBefore)).length;
  const items: AttentionItem[] = [
    { key: "reviews", label: "Reviews to confirm", count: reviews.count ?? 0, href: "/app/review" },
    { key: "approvals", label: "Klio drafts to approve", count: approvals.count ?? 0, href: "/app/activity#decisions" },
    { key: "filing", label: "Records needing a learner or subject", count: unfiled, href: "/app/activity#decisions" },
    { key: "agent", label: "Klio jobs needing you", count: agentNeedsParent, href: "/app/activity#conductor" },
    { key: "schedule", label: "Schedule changes to review", count: adjustments.data?.length ?? 0, href: "/app/adjustments" },
    { key: "plans", label: "Plans awaiting a decision", count: plans.count ?? 0, href: "/app/adjustments" },
    { key: "details", label: "Questions needing one detail", count: insights.count ?? 0, href: "/app/activity#decisions" },
    { key: "reminders", label: "Overdue reminders", count: reminders.count ?? 0, href: "/app/activity#decisions" },
  ].filter((item) => item.count > 0);
  return { total: items.reduce((sum, item) => sum + item.count, 0), items };
});
