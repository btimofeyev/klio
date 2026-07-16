import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { scoreDynamicPractice } from "@/lib/practice/score";
import { normalizePracticeSpec, practiceAnswerSchema } from "@/lib/practice/spec";
import { buildPracticeOutcome } from "@/lib/practice/outcome";
import { reviewWrittenPractice } from "@/lib/practice/review-written";
import type { Json } from "@/lib/supabase/database.types";
import { enqueueProactiveEvaluation, processProactiveEvaluation } from "@/lib/proactive/evaluate";
import { subjectSlug } from "@/lib/onboarding/subjects";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const body = z.object({ answers: z.array(practiceAnswerSchema).min(1).max(30) }).parse(await request.json());
    const supabase = await createClient();
    const { data: session } = await supabase.from("practice_sessions").select("id, family_id, student_id, artifact_id, spec, status, students(display_name)").eq("id", (await params).id).in("status", ["ready", "in_progress", "completed"]).maybeSingle();
    const spec = session ? normalizePracticeSpec(session.spec) : null;
    if (!session || !spec) return NextResponse.json({ error: "Practice not found." }, { status: 404 });
    if (session.status === "completed") {
      const existing = await supabase.from("practice_results").select("score,mastery_met,written_review_required,scoring_state").eq("practice_session_id", session.id).eq("family_id", session.family_id).maybeSingle();
      if (!existing.data) return NextResponse.json({ error: "This practice is already complete." }, { status: 409 });
      const outcome = buildPracticeOutcome({ learnerName: session.students?.display_name ?? "Your learner", subject: spec.subject, skillKey: spec.skill_key, score: Number(existing.data.score), masteryMet: existing.data.mastery_met, reviewNeeded: existing.data.written_review_required });
      return NextResponse.json({ score: Number(existing.data.score), masteryMet: existing.data.mastery_met, reviewNeeded: existing.data.written_review_required, scoringState: existing.data.scoring_state, feedback: outcome.feedback, outcome: outcome.kind, duplicate: true });
    }
    if (body.answers.length !== spec.activities.length) return NextResponse.json({ error: "Complete every activity." }, { status: 400 });
    const writtenReview = await reviewWrittenPractice({ familyId: session.family_id, spec, answers: body.answers });
    const { score, masteryMet, reviewNeeded, scoringState } = scoreDynamicPractice(spec, body.answers, writtenReview.evaluations);
    const learnerName = session.students?.display_name ?? "Your learner";
    const outcome = buildPracticeOutcome({ learnerName, subject: spec.subject, skillKey: spec.skill_key, score, masteryMet, reviewNeeded });
    const evidenceId = crypto.randomUUID();
    const { error: evidenceError } = await supabase.from("evidence_items").insert({
      id: evidenceId, family_id: session.family_id, created_by: parent.id, kind: "practice_result",
      title: `Practice result · ${score}%`, raw_text: JSON.stringify({ session_id: session.id, subject: spec.subject, skill_key: spec.skill_key, score, mastery_met: masteryMet, review_needed: reviewNeeded, answers: body.answers }), processing_status: "ready",
      provenance: { practice_session_id: session.id },
    });
    if (evidenceError) throw evidenceError;
    await supabase.from("evidence_students").insert({ evidence_id: evidenceId, student_id: session.student_id, family_id: session.family_id });
    const admin = createAdminClient();
    const categorySlug = subjectSlug(spec.subject) || "subject";
    const categoryUpsert = await admin.from("categories").upsert({
      family_id: session.family_id,
      name: spec.subject,
      slug: categorySlug,
      description: `${spec.subject} learning records and source evidence.`,
      created_by_type: "agent",
    }, { onConflict: "family_id,slug", ignoreDuplicates: true });
    if (categoryUpsert.error) throw categoryUpsert.error;
    const category = await admin.from("categories").select("id").eq("family_id", session.family_id).eq("slug", categorySlug).single();
    if (category.error) throw category.error;
    const categoryLink = await admin.from("evidence_categories").upsert({
      family_id: session.family_id,
      evidence_id: evidenceId,
      category_id: category.data.id,
      assigned_by: "agent",
      document_type: "Practice result",
      tags: [spec.skill_key],
      confidence: 1,
    }, { onConflict: "evidence_id,category_id", ignoreDuplicates: true });
    if (categoryLink.error) throw categoryLink.error;
    const savedResult = await admin.from("practice_results").insert({
      family_id: session.family_id, practice_session_id: session.id, student_id: session.student_id,
      answers: JSON.parse(JSON.stringify(body.answers)) as Json, score, auto_score: score,
      final_score: scoringState === "final" ? score : null, mastery_met: masteryMet, evidence_id: evidenceId,
      scoring_state: scoringState, written_review_required: reviewNeeded, written_review_completed: !reviewNeeded,
      finalized_by: scoringState === "final" ? parent.id : null,
      finalized_at: scoringState === "final" ? new Date().toISOString() : null,
      comparable_key: `${spec.subject.toLocaleLowerCase("en-US")}:${spec.skill_key}`.slice(0, 200),
    }).select("id").single();
    if (savedResult.error) throw savedResult.error;
    await admin.from("practice_sessions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", session.id).eq("family_id", session.family_id);
    const activeInsights = await admin.from("klio_insights").select("id,action_ref").eq("family_id", session.family_id).eq("status", "active").limit(50);
    if (activeInsights.error) throw activeInsights.error;
    const replacedIds = activeInsights.data.filter((item) => {
      const action = item.action_ref && typeof item.action_ref === "object" && !Array.isArray(item.action_ref) ? item.action_ref as Record<string, unknown> : {};
      return action.practiceSessionId === session.id || (session.artifact_id && action.artifactId === session.artifact_id);
    }).map((item) => item.id);
    if (replacedIds.length) {
      const replaced = await admin.from("klio_insights").update({ status: "superseded", dismissed_at: new Date().toISOString(), dismissed_by: parent.id }).eq("family_id", session.family_id).in("id", replacedIds);
      if (replaced.error) throw replaced.error;
    }
    const insight = await admin.from("klio_insights").upsert({
      family_id: session.family_id,
      student_id: session.student_id,
      kind: "noticed",
      title: outcome.title,
      summary: outcome.summary,
      reason: "This update comes from the learner’s submitted focused-practice responses.",
      priority: outcome.priority,
      evidence_refs: [{ type: "practice_result", id: savedResult.data.id, score }],
      action_ref: {
        type: "practice_outcome",
        outcome: outcome.kind,
        practiceSessionId: session.id,
        artifactId: session.artifact_id,
        resultId: savedResult.data.id,
        ...(outcome.kind === "needs_support" ? { followUpOptions: ["extend_time", "create_more_practice"] } : {}),
      },
      dedupe_key: `practice-outcome:${savedResult.data.id}`,
    }, { onConflict: "family_id,dedupe_key" }).select("id,student_id,kind,title,summary,reason,priority,evidence_refs,action_ref,created_at").single();
    if (insight.error) throw insight.error;
    await writeAuditEvent(admin, { familyId: session.family_id, actorId: parent.id, actorType: "parent", action: "practice.completed", entityType: "practice_session", entityId: session.id, metadata: { score, mastery_met: masteryMet, evidence_id: evidenceId } });
    const evaluation = await enqueueProactiveEvaluation({ familyId: session.family_id, studentId: session.student_id, requestedBy: parent.id, eventKind: "practice_completed", entityType: "practice_result", entityId: savedResult.data.id, idempotencyKey: `practice-completed:${savedResult.data.id}` });
    if (!evaluation.duplicate) after(() => processProactiveEvaluation(evaluation.evaluation.id));
    return NextResponse.json({
      score, masteryMet, reviewNeeded, scoringState, feedback: writtenReview.learnerFeedback ?? outcome.feedback, outcome: outcome.kind,
      parentUpdate: {
        id: insight.data.id,
        studentId: insight.data.student_id,
        kind: insight.data.kind,
        title: insight.data.title,
        summary: insight.data.summary,
        reason: insight.data.reason,
        priority: insight.data.priority,
        evidenceRefs: Array.isArray(insight.data.evidence_refs) ? insight.data.evidence_refs : [],
        actionRef: insight.data.action_ref,
        createdAt: insight.data.created_at,
      },
    });
  } catch { return NextResponse.json({ error: "Klio could not save this result." }, { status: 400 }); }
}
