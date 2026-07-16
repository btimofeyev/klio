import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueProactiveEvaluation, processProactiveEvaluation } from "@/lib/proactive/evaluate";

const schema = z.object({
  decision: z.enum(["approve", "reject", "return"]), score: z.number().min(0).max(100).nullable(), scoreLabel: z.string().trim().max(40).nullable().optional(),
  feedback: z.string().trim().max(5000), rubric: z.array(z.object({ criterion: z.string().max(160), level: z.string().max(80), note: z.string().max(500).optional() })).max(20).default([]),
  masterySignals: z.array(z.object({ skill: z.string().max(160), status: z.enum(["emerging", "developing", "secure", "needs-review"]) })).max(20).default([]),
  returnReason: z.string().trim().max(2000).nullable().optional(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the score and feedback." }, { status: 400 });
    const admin = createAdminClient();
    const existing = await admin.from("assignment_reviews").select("id,family_id,assignment_id,submission_id,student_id,status,draft_score").eq("id", id).maybeSingle();
    if (!existing.data) return NextResponse.json({ error: "Review not found." }, { status: 404 });
    const approved = parsed.data.decision === "approve";
    const skillKey = parsed.data.masterySignals[0]?.skill
      ? parsed.data.masterySignals[0].skill.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : null;
    const finalized = await admin.rpc("finalize_assignment_review", {
      p_review_id: id,
      p_actor_id: parent.id,
      p_decision: parsed.data.decision,
      p_values: {
        score: approved ? parsed.data.score : null,
        scoreLabel: approved ? parsed.data.scoreLabel ?? null : null,
        feedback: parsed.data.feedback,
        rubric: parsed.data.rubric,
        masterySignals: parsed.data.masterySignals,
        skillKey,
        comparableKey: skillKey,
        scoreEdited: approved && Number(existing.data.draft_score) !== Number(parsed.data.score),
        returnReason: parsed.data.returnReason ?? null,
      },
    });
    if (finalized.error) throw finalized.error;
    if (approved) {
      const evaluation = await enqueueProactiveEvaluation({
        familyId: existing.data.family_id, studentId: existing.data.student_id, requestedBy: parent.id,
        eventKind: "grade_approved", entityType: "assignment_review", entityId: id,
        idempotencyKey: `grade-approved:${id}`,
      });
      if (!evaluation.duplicate) after(() => processProactiveEvaluation(evaluation.evaluation.id));
    }
    return NextResponse.json({ review: finalized.data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save that review." }, { status: 500 });
  }
}
