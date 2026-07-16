import { after, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assignmentHandoffNeedsAgent, assignmentSubmissionDeclaresCompletion, assignmentSubmissionOutcome } from "@/lib/assignments/submission-routing";
import { refreshAssignmentReviewDraft } from "@/lib/assignments/draft-review";
import { enqueueProactiveEvaluation } from "@/lib/proactive/evaluate";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";
import { enqueueWorkspaceTurn } from "@/lib/agent/workspace/turns";
import { processWorkspaceTurn } from "@/lib/agent/workspace/runtime";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ evidenceIds: z.array(postgresUuidSchema).max(20).default([]), note: z.string().trim().max(5000).nullable().optional() }).strict()
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
    const completionDeclared = assignmentSubmissionDeclaresCompletion(parsed.data.note);
    const submission = await supabase.from("assignment_submissions").insert({ family_id: currentAssignment.family_id, assignment_id: id, student_id: currentAssignment.student_id, submitted_by: parent.id, note: parsed.data.note ?? null, status: outcome === "needs_review" ? "ready_for_review" : "reviewed" }).select("id,submitted_at").single();
    if (submission.error) throw submission.error;
    if (parsed.data.evidenceIds.length) {
      const links = await supabase.from("assignment_submission_evidence").insert(parsed.data.evidenceIds.map((evidenceId) => ({ family_id: currentAssignment.family_id, submission_id: submission.data.id, evidence_id: evidenceId })));
      if (links.error) throw links.error;
    }
    if (outcome === "comment") {
      await writeAuditEvent(createAdminClient(), {
        familyId: currentAssignment.family_id,
        actorId: parent.id,
        actorType: "parent",
        action: "assignment.note_added",
        entityType: "assignment",
        entityId: id,
        metadata: { submission_id: submission.data.id, evidence_count: parsed.data.evidenceIds.length },
      });
      if (parsed.data.evidenceIds[0]) {
        await enqueueProactiveEvaluation({
          familyId: currentAssignment.family_id,
          studentId: currentAssignment.student_id,
          requestedBy: parent.id,
          eventKind: "capture_filed",
          entityType: "evidence_item",
          entityId: parsed.data.evidenceIds[0],
          idempotencyKey: `assignment-note:${submission.data.id}`,
        });
      }
      const turn = await enqueueAssignmentFollowThrough({
        familyId: currentAssignment.family_id, studentId: currentAssignment.student_id, assignmentId: id,
        assignmentTitle: currentAssignment.title, subject: currentAssignment.subject, requestedBy: parent.id,
        submissionId: submission.data.id, evidenceIds: parsed.data.evidenceIds, note: parsed.data.note,
        completionRecorded: false, reviewId: null,
      });
      return NextResponse.json({ outcome, submission: submission.data, assignment: currentAssignment, turn }, { status: 201 });
    }
    if (outcome === "completed") {
      const completedAt = currentAssignment.completed_at ?? submission.data.submitted_at;
      const updated = await supabase.from("assignments").update({ status: "completed", completed_at: completedAt, submitted_at: submission.data.submitted_at }).eq("id", id).eq("family_id", currentAssignment.family_id).select("id,status,completed_at").single();
      if (updated.error) throw updated.error;
      const plan = await supabase.from("weekly_plan_items").update({ completed_at: completedAt }).eq("assignment_id", id).eq("family_id", currentAssignment.family_id);
      if (plan.error) throw plan.error;
      await writeAuditEvent(createAdminClient(), { familyId: currentAssignment.family_id, actorId: parent.id, actorType: "parent", action: "assignment.completion_recorded", entityType: "assignment", entityId: id, metadata: { submission_id: submission.data.id, evidence_count: parsed.data.evidenceIds.length } });
      await Promise.all([
        enqueueProactiveEvaluation({ familyId: currentAssignment.family_id, studentId: currentAssignment.student_id, requestedBy: parent.id, eventKind: "assignment_submitted", entityType: "assignment_submission", entityId: submission.data.id, idempotencyKey: `assignment-submitted:${submission.data.id}` }),
        enqueueProactiveEvaluation({ familyId: currentAssignment.family_id, studentId: currentAssignment.student_id, requestedBy: parent.id, eventKind: "assignment_completed", entityType: "assignment", entityId: id, idempotencyKey: `assignment-completed-by-submission:${submission.data.id}` }),
      ]);
      const turn = await enqueueAssignmentFollowThrough({
        familyId: currentAssignment.family_id, studentId: currentAssignment.student_id, assignmentId: id,
        assignmentTitle: currentAssignment.title, subject: currentAssignment.subject, requestedBy: parent.id,
        submissionId: submission.data.id, evidenceIds: parsed.data.evidenceIds, note: parsed.data.note,
        completionRecorded: true, reviewId: null,
      });
      return NextResponse.json({ outcome, submission: submission.data, assignment: updated.data, turn }, { status: 201 });
    }
    const noteScoreMatch = parsed.data.note?.match(/(?:score|grade)?\s*[:=-]?\s*(100|[1-9]?\d)\s*%/i) ?? null;
    const evidenceText = (evidence.data ?? []).flatMap((item) => [item.raw_text, item.extracted_text]).filter(Boolean).join("\n");
    const evidenceScoreMatch = evidenceText.match(/(?:score|grade)?\s*[:=-]?\s*(100|[1-9]?\d)\s*%/i);
    const scoreMatch = noteScoreMatch ?? evidenceScoreMatch;
    const draftScore = scoreMatch ? Number(scoreMatch[1]) : null;
    const scoreOrigin = noteScoreMatch ? "explicit_parent" as const : evidenceScoreMatch ? "imported_explicit" as const : "agent_inferred" as const;
    const review = await supabase.from("assignment_reviews").insert({
      family_id: currentAssignment.family_id, assignment_id: id, submission_id: submission.data.id, student_id: currentAssignment.student_id, status: "draft",
      draft_score: draftScore, draft_feedback: draftScore === null ? "Klio is reviewing the submitted work." : `The submitted record indicates ${draftScore}%.`,
      uncertainty_flags: draftScore === null ? [] : ["The score came from parent-provided source material and still needs confirmation."],
      score_origin: scoreOrigin, grading_state: "provisional",
      written_review_required: draftScore === null, written_review_completed: false,
      evidence_strength: draftScore === null ? "curriculum" : "parent_report",
    }).select("id,draft_score,draft_feedback,status").single();
    if (review.error) throw review.error;
    after(async () => {
      try {
        await refreshAssignmentReviewDraft(review.data.id);
      } catch {
        await createAdminClient().from("assignment_reviews").update({
          draft_feedback: draftScore === null ? "Klio could not confidently assess this source. Add the result you want to keep." : `The submitted record indicates ${draftScore}%. Add any feedback you want to keep.`,
          uncertainty_flags: draftScore === null ? ["Automatic review was unavailable for this source."] : ["The score came from parent-provided source material and still needs confirmation."],
        }).eq("id", review.data.id).eq("family_id", currentAssignment.family_id).eq("status", "draft");
      }
    });
    const nextStatus = currentAssignment.status === "completed" || completionDeclared ? "completed" : "needs_review";
    const completedAt = completionDeclared ? currentAssignment.completed_at ?? submission.data.submitted_at : currentAssignment.completed_at;
    const updated = await supabase.from("assignments").update({ status: nextStatus, submitted_at: submission.data.submitted_at, completed_at: completedAt }).eq("id", id).eq("family_id", currentAssignment.family_id);
    if (updated.error) throw updated.error;
    if (completionDeclared) {
      const plan = await supabase.from("weekly_plan_items").update({ completed_at: completedAt }).eq("assignment_id", id).eq("family_id", currentAssignment.family_id);
      if (plan.error) throw plan.error;
    }
    await writeAuditEvent(createAdminClient(), { familyId: currentAssignment.family_id, actorId: parent.id, actorType: "parent", action: "assignment.submitted", entityType: "assignment", entityId: id, metadata: { submission_id: submission.data.id, review_id: review.data.id, evidence_count: parsed.data.evidenceIds.length, completion_recorded: completionDeclared } });
    await Promise.all([
      enqueueProactiveEvaluation({ familyId: currentAssignment.family_id, studentId: currentAssignment.student_id, requestedBy: parent.id, eventKind: "assignment_submitted", entityType: "assignment_submission", entityId: submission.data.id, idempotencyKey: `assignment-submitted:${submission.data.id}` }),
      ...(completionDeclared ? [enqueueProactiveEvaluation({ familyId: currentAssignment.family_id, studentId: currentAssignment.student_id, requestedBy: parent.id, eventKind: "assignment_completed", entityType: "assignment", entityId: id, idempotencyKey: `assignment-completed-by-submission:${submission.data.id}` })] : []),
    ]);
    const turn = await enqueueAssignmentFollowThrough({
      familyId: currentAssignment.family_id, studentId: currentAssignment.student_id, assignmentId: id,
      assignmentTitle: currentAssignment.title, subject: currentAssignment.subject, requestedBy: parent.id,
      submissionId: submission.data.id, evidenceIds: parsed.data.evidenceIds, note: parsed.data.note,
      completionRecorded: completionDeclared, reviewId: review.data.id,
    });
    return NextResponse.json({ outcome, completionRecorded: completionDeclared, submission: submission.data, review: review.data, draftedByKlio: false, turn }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not submit that work." }, { status: 500 });
  }
}

async function enqueueAssignmentFollowThrough(input: {
  familyId: string;
  studentId: string;
  assignmentId: string;
  assignmentTitle: string;
  subject: string;
  requestedBy: string;
  submissionId: string;
  evidenceIds: string[];
  note?: string | null;
  completionRecorded: boolean;
  reviewId: string | null;
}) {
  if (!assignmentHandoffNeedsAgent(input.note) || serverEnv.klioAgentRuntime !== "codex_app_server") return null;
  const request = [
    `The parent handed you ${input.assignmentTitle} (${input.assignmentId}) for ${input.subject}.`,
    input.completionRecorded ? "The host already recorded the parent's explicit completion; do not record it again." : "The host saved the parent's note with the assignment.",
    input.reviewId ? `A provisional review exists as ${input.reviewId}; do not treat it as an approved result.` : "No approved assignment result was supplied.",
    `Parent request: ${input.note?.trim() ?? "Follow through on this assignment handoff."}`,
    "Perform the remaining operational follow-through. If focused practice is requested but the demonstrated skill or mistakes are not specific enough, ask one precise question instead of creating generic practice or silently doing nothing.",
  ].join("\n");
  const workspace = await enqueueWorkspaceTurn({
    familyId: input.familyId,
    requestedBy: input.requestedBy,
    evidenceIds: input.evidenceIds,
    studentId: input.studentId,
    trigger: "parent_message",
    goal: "general",
    idempotencyKey: `assignment-follow-through:${input.submissionId}`,
    request,
    taskName: `Following up on ${input.assignmentTitle}`,
    subject: input.subject,
    expectedOutput: "Grounded support, a safe workspace change, or one precise question",
  });
  if (serverEnv.klioAgentInline && !workspace.duplicate) after(() => processWorkspaceTurn(workspace.turn.id));
  return workspace.turn;
}
