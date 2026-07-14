import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildPracticeProposal } from "@/lib/assignments/planning";
import { learnerWeekdays, weekDates } from "@/lib/assignments/dates";
import type { Json } from "@/lib/supabase/database.types";

const schema = z.object({
  decision: z.enum(["approve", "reject"]), score: z.number().min(0).max(100).nullable(), scoreLabel: z.string().trim().max(40).nullable().optional(),
  feedback: z.string().trim().max(5000), rubric: z.array(z.object({ criterion: z.string().max(160), level: z.string().max(80), note: z.string().max(500).optional() })).max(20).default([]),
  masterySignals: z.array(z.object({ skill: z.string().max(160), status: z.enum(["emerging", "developing", "secure", "needs-review"]) })).max(20).default([]),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the score and feedback." }, { status: 400 });
    const supabase = await createClient();
    const existing = await supabase.from("assignment_reviews").select("id,family_id,assignment_id,submission_id,student_id,status").eq("id", id).maybeSingle();
    if (!existing.data) return NextResponse.json({ error: "Review not found." }, { status: 404 });
    if (existing.data.status !== "draft") return NextResponse.json({ error: "That review has already been decided." }, { status: 409 });
    const approved = parsed.data.decision === "approve";
    const now = new Date().toISOString();
    const review = await supabase.from("assignment_reviews").update({
      status: approved ? "approved" : "rejected", score: approved ? parsed.data.score : null, score_label: approved ? parsed.data.scoreLabel ?? null : null,
      feedback: parsed.data.feedback, rubric: parsed.data.rubric, mastery_signals: parsed.data.masterySignals, reviewed_by: parent.id, reviewed_at: now,
    }).eq("id", id).eq("family_id", existing.data.family_id).select("id,status,score,feedback,reviewed_at").single();
    if (review.error) throw review.error;
    await supabase.from("assignment_submissions").update({ status: approved ? "reviewed" : "returned" }).eq("id", existing.data.submission_id).eq("family_id", existing.data.family_id);
    if (approved) {
      await supabase.from("assignments").update({ status: "completed", completed_at: now }).eq("id", existing.data.assignment_id).eq("family_id", existing.data.family_id);
      await supabase.from("weekly_plan_items").update({ completed_at: now }).eq("assignment_id", existing.data.assignment_id).eq("family_id", existing.data.family_id);
      if (parsed.data.score !== null && parsed.data.score < 75) {
        const source = await supabase.from("assignments").select("id,title,subject,scheduled_date,estimated_minutes,status,curriculum_unit_id,sequence_number").eq("id", existing.data.assignment_id).single();
        const family = await supabase.from("families").select("agent_context_version,available_days").eq("id", existing.data.family_id).single();
        const student = await supabase.from("students").select("daily_capacity_minutes,schedule_preferences").eq("id", existing.data.student_id).eq("family_id", existing.data.family_id).single();
        if (!source.error && !family.error && !student.error && source.data.scheduled_date) {
          const learningDays = weekDates(source.data.scheduled_date, learnerWeekdays(student.data.schedule_preferences, family.data.available_days));
          const weekAssignments = await supabase.from("assignments").select("id,title,subject,scheduled_date,estimated_minutes,status,curriculum_unit_id,sequence_number").eq("family_id", existing.data.family_id).eq("student_id", existing.data.student_id).gte("scheduled_date", learningDays[0]).lte("scheduled_date", learningDays.at(-1)!);
          if (!weekAssignments.error) {
            const action = buildPracticeProposal({ assignment: toPlanning(source.data), score: parsed.data.score, learningDays, assignments: weekAssignments.data.map(toPlanning), dailyCapacityMinutes: student.data.daily_capacity_minutes });
            if (action) {
              const proposal = await supabase.from("adjustment_proposals").insert({ family_id: existing.data.family_id, student_id: existing.data.student_id, week_start: learningDays[0], reason: `${source.data.title} was confirmed at ${parsed.data.score}%.`, summary: `Add 15 minutes of focused ${source.data.subject} review without replacing curriculum work.`, snapshot_version: family.data.agent_context_version }).select("id").single();
              if (!proposal.error) await supabase.from("adjustment_actions").insert({ family_id: existing.data.family_id, proposal_id: proposal.data.id, assignment_id: existing.data.assignment_id, action_type: action.actionType, before_state: action.beforeState as Json, after_state: action.afterState as Json });
            }
          }
        }
      }
    } else {
      await supabase.from("assignments").update({ status: "doing" }).eq("id", existing.data.assignment_id).eq("family_id", existing.data.family_id);
    }
    await writeAuditEvent(createAdminClient(), { familyId: existing.data.family_id, actorId: parent.id, actorType: "parent", action: approved ? "assignment_review.approved" : "assignment_review.rejected", entityType: "assignment_review", entityId: id, metadata: { assignment_id: existing.data.assignment_id, score: approved ? parsed.data.score : null } });
    return NextResponse.json({ review: review.data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that review." }, { status: 500 });
  }
}

function toPlanning(item: { id: string; title: string; subject: string; scheduled_date: string | null; estimated_minutes: number | null; status: string; curriculum_unit_id: string | null; sequence_number: number | null }) {
  return { id: item.id, title: item.title, subject: item.subject, scheduledDate: item.scheduled_date, estimatedMinutes: item.estimated_minutes, status: item.status as "planned" | "doing" | "submitted" | "completed" | "skipped" | "needs_review", curriculumUnitId: item.curriculum_unit_id, sequenceNumber: item.sequence_number };
}
