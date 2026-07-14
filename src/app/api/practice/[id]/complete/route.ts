import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { scoreDynamicPractice } from "@/lib/practice/score";
import { normalizePracticeSpec, practiceAnswerSchema } from "@/lib/practice/spec";
import type { Json } from "@/lib/supabase/database.types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const body = z.object({ answers: z.array(practiceAnswerSchema).min(1).max(30) }).parse(await request.json());
    const supabase = await createClient();
    const { data: session } = await supabase.from("practice_sessions").select("id, family_id, student_id, spec, status").eq("id", (await params).id).eq("status", "ready").maybeSingle();
    const spec = session ? normalizePracticeSpec(session.spec) : null;
    if (!session || !spec) return NextResponse.json({ error: "Practice not found." }, { status: 404 });
    if (body.answers.length !== spec.activities.length) return NextResponse.json({ error: "Complete every activity." }, { status: 400 });
    const { score, masteryMet, reviewNeeded } = scoreDynamicPractice(spec, body.answers);
    const evidenceId = crypto.randomUUID();
    const { error: evidenceError } = await supabase.from("evidence_items").insert({
      id: evidenceId, family_id: session.family_id, created_by: parent.id, kind: "practice_result",
      title: `Practice result · ${score}%`, raw_text: JSON.stringify({ session_id: session.id, subject: spec.subject, skill_key: spec.skill_key, score, mastery_met: masteryMet, review_needed: reviewNeeded, answers: body.answers }), processing_status: "ready",
      provenance: { practice_session_id: session.id },
    });
    if (evidenceError) throw evidenceError;
    await supabase.from("evidence_students").insert({ evidence_id: evidenceId, student_id: session.student_id, family_id: session.family_id });
    const admin = createAdminClient();
    await admin.from("practice_results").insert({ family_id: session.family_id, practice_session_id: session.id, student_id: session.student_id, answers: JSON.parse(JSON.stringify(body.answers)) as Json, score, mastery_met: masteryMet, evidence_id: evidenceId });
    await admin.from("practice_sessions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", session.id);
    await writeAuditEvent(admin, { familyId: session.family_id, actorId: parent.id, actorType: "parent", action: "practice.completed", entityType: "practice_session", entityId: session.id, metadata: { score, mastery_met: masteryMet, evidence_id: evidenceId } });
    return NextResponse.json({ score, masteryMet, reviewNeeded });
  } catch { return NextResponse.json({ error: "Klio could not save this result." }, { status: 400 }); }
}
