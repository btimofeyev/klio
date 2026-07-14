import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assignmentSubmissionOutcome } from "@/lib/assignments/submission-routing";
import { refreshAssignmentReviewDraft } from "@/lib/assignments/draft-review";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ evidenceIds: z.array(z.uuid()).max(20).default([]), note: z.string().trim().max(5000).nullable().optional() }).strict()
  .refine((value) => value.evidenceIds.length > 0 || Boolean(value.note), "Add a note or at least one capture.");

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Add a note or choose a saved capture." }, { status: 400 });
    const supabase = await createClient();
    const assignment = await supabase.from("assignments").select("id,family_id,student_id,title,subject,status,completed_at").eq("id", id).maybeSingle();
    if (!assignment.data) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    const currentAssignment = assignment.data;
    const evidence = parsed.data.evidenceIds.length ? await supabase.from("evidence_items").select("id,title,raw_text,extracted_text,kind,storage_path").eq("family_id", currentAssignment.family_id).in("id", parsed.data.evidenceIds) : { data: [], error: null };
    if (evidence.error || (evidence.data?.length ?? 0) !== parsed.data.evidenceIds.length) return NextResponse.json({ error: "One or more captures are unavailable." }, { status: 400 });
    const outcome = assignmentSubmissionOutcome({
      note: parsed.data.note,
      evidence: (evidence.data ?? []).map((item) => ({ kind: item.kind, storagePath: item.storage_path })),
    });
    const submission = await supabase.from("assignment_submissions").insert({ family_id: currentAssignment.family_id, assignment_id: id, student_id: currentAssignment.student_id, submitted_by: parent.id, note: parsed.data.note ?? null, status: outcome === "completed" ? "reviewed" : "ready_for_review" }).select("id,submitted_at").single();
    if (submission.error) throw submission.error;
    if (parsed.data.evidenceIds.length) {
      const links = await supabase.from("assignment_submission_evidence").insert(parsed.data.evidenceIds.map((evidenceId) => ({ family_id: currentAssignment.family_id, submission_id: submission.data.id, evidence_id: evidenceId })));
      if (links.error) throw links.error;
    }
    if (outcome === "completed") {
      const completedAt = currentAssignment.completed_at ?? submission.data.submitted_at;
      const updated = await supabase.from("assignments").update({ status: "completed", completed_at: completedAt, submitted_at: submission.data.submitted_at }).eq("id", id).eq("family_id", currentAssignment.family_id).select("id,status,completed_at").single();
      if (updated.error) throw updated.error;
      const plan = await supabase.from("weekly_plan_items").update({ completed_at: completedAt }).eq("assignment_id", id).eq("family_id", currentAssignment.family_id);
      if (plan.error) throw plan.error;
      await writeAuditEvent(createAdminClient(), { familyId: currentAssignment.family_id, actorId: parent.id, actorType: "parent", action: "assignment.completion_recorded", entityType: "assignment", entityId: id, metadata: { submission_id: submission.data.id, evidence_count: parsed.data.evidenceIds.length } });
      return NextResponse.json({ outcome, submission: submission.data, assignment: updated.data }, { status: 201 });
    }
    const sourceText = [parsed.data.note, ...(evidence.data ?? []).flatMap((item) => [item.raw_text, item.extracted_text])].filter(Boolean).join("\n");
    const scoreMatch = sourceText.match(/(?:score|grade)?\s*[:=-]?\s*(100|[1-9]?\d)\s*%/i);
    const draftScore = scoreMatch ? Number(scoreMatch[1]) : null;
    const review = await supabase.from("assignment_reviews").insert({
      family_id: currentAssignment.family_id, assignment_id: id, submission_id: submission.data.id, student_id: currentAssignment.student_id, status: "draft",
      draft_score: draftScore, draft_feedback: draftScore === null ? "Klio is reviewing the submitted work." : `The submitted record indicates ${draftScore}%.`,
      uncertainty_flags: draftScore === null ? [] : ["The score came from parent-provided source material and still needs confirmation."],
    }).select("id,draft_score,draft_feedback,status").single();
    if (review.error) throw review.error;
    let draftedReview: unknown = review.data;
    let draftedByKlio = false;
    try {
      draftedReview = await refreshAssignmentReviewDraft(review.data.id);
      draftedByKlio = true;
    } catch {
      await supabase.from("assignment_reviews").update({
        draft_feedback: draftScore === null ? "Klio could not confidently assess this source. Add the result you want to keep." : `The submitted record indicates ${draftScore}%. Add any feedback you want to keep.`,
        uncertainty_flags: draftScore === null ? ["Automatic review was unavailable for this source."] : ["The score came from parent-provided source material and still needs confirmation."],
      }).eq("id", review.data.id).eq("family_id", currentAssignment.family_id);
    }
    const nextStatus = currentAssignment.status === "completed" ? "completed" : "needs_review";
    const updated = await supabase.from("assignments").update({ status: nextStatus, submitted_at: submission.data.submitted_at }).eq("id", id).eq("family_id", currentAssignment.family_id);
    if (updated.error) throw updated.error;
    await writeAuditEvent(createAdminClient(), { familyId: currentAssignment.family_id, actorId: parent.id, actorType: "parent", action: "assignment.submitted", entityType: "assignment", entityId: id, metadata: { submission_id: submission.data.id, review_id: review.data.id, evidence_count: parsed.data.evidenceIds.length } });
    return NextResponse.json({ outcome, submission: submission.data, review: draftedReview, draftedByKlio }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not submit that work." }, { status: 500 });
  }
}
