import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { applyCurriculumScopeSuggestion, processCurriculumScopeSuggestion } from "@/lib/curriculum/scope-ingestion";
import { curriculumPacingFromSnapshot } from "@/lib/curriculum/curriculum-pacing";
import { queueWebScopeSuggestion } from "@/lib/curriculum/scope-suggestion-store";
import { buildScopeSuggestionDiff, courseScopeSuggestionOutputSchema, scopeSuggestionConfidenceWording } from "@/lib/curriculum/scope-suggestion";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry"), suggestionId: z.uuid() }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
]);
const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss"), suggestionId: z.uuid() }).strict(),
  z.object({
    action: z.literal("apply"),
    suggestionId: z.uuid(),
    targetLessonCount: z.number().int().min(1).max(500).optional(),
    selections: z.array(z.object({
      sequenceNumber: z.number().int().min(1).max(500),
      title: z.string().trim().min(1).max(200).optional(),
      kind: z.enum(["lesson", "assessment", "review", "project", "activity"]).optional(),
      path: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
      minutes: z.number().int().min(5).max(480).nullable().optional(),
    }).strict()).max(500),
  }).strict(),
]);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const supabase = await createClient();
    const unit = await supabase.from("curriculum_units").select("id,family_id,subject,target_lesson_count").eq("id", id).maybeSingle();
    if (!unit.data) return NextResponse.json({ error: "Curriculum not found." }, { status: 404 });
    const course = unit.data;
    const webSuggestion = await queueWebScopeSuggestion({ familyId: course.family_id, curriculumUnitId: course.id, requestedBy: parent.id, process: false });
    if (webSuggestion?.status === "queued") after(() => processCurriculumScopeSuggestion(webSuggestion.id));
    const [suggestions, assignments] = await Promise.all([
      supabase.from("curriculum_scope_suggestions").select("*").eq("family_id", course.family_id).eq("curriculum_unit_id", id).order("created_at", { ascending: false }),
      supabase.from("assignments").select("id,sequence_number,title,status,scheduled_date,curriculum_item_state").eq("family_id", course.family_id).eq("curriculum_unit_id", id).not("sequence_number", "is", null).order("sequence_number"),
    ]);
    if (suggestions.error ?? assignments.error) throw suggestions.error ?? assignments.error;
    const stableAssignments = assignments.data.flatMap((assignment) => assignment.sequence_number === null ? [] : [{ id: assignment.id, sequenceNumber: assignment.sequence_number, title: assignment.title, status: assignment.status, scheduledDate: assignment.scheduled_date, curriculumItemState: assignment.curriculum_item_state }]);
    return NextResponse.json({ suggestions: suggestions.data.map((suggestion) => {
      const pacing = curriculumPacingFromSnapshot(suggestion.before_snapshot);
      if (suggestion.status !== "ready") return { ...suggestion, pacing, diff: [], confidenceWording: null };
      const proposal = courseScopeSuggestionOutputSchema.safeParse({ identity: { publisher: suggestion.publisher, productName: suggestion.product_name, subject: course.subject, gradeLabel: suggestion.grade_label, editionLabel: suggestion.edition_label, isbn: suggestion.isbn }, targetLessonCount: suggestion.proposed_target_count ?? course.target_lesson_count, assumptions: suggestion.assumptions, items: suggestion.proposed_items, confidence: suggestion.confidence ?? 0 });
      return { ...suggestion, pacing, diff: proposal.success ? buildScopeSuggestionDiff({ assignments: stableAssignments, proposal: proposal.data }) : [], confidenceWording: scopeSuggestionConfidenceWording(Number(suggestion.confidence ?? 0)) };
    }) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not load the scope suggestions." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid curriculum research action." }, { status: 400 });
    const supabase = await createClient();
    if (parsed.data.action === "refresh") {
      const unit = await supabase.from("curriculum_units").select("id,family_id").eq("id", id).maybeSingle();
      if (!unit.data) return NextResponse.json({ error: "Curriculum not found." }, { status: 404 });
      const queued = await queueWebScopeSuggestion({ familyId: unit.data.family_id, curriculumUnitId: unit.data.id, requestedBy: parent.id, process: false, force: true });
      if (!queued) return NextResponse.json({ error: "Curriculum not found." }, { status: 404 });
      if (queued.status === "queued") after(() => processCurriculumScopeSuggestion(queued.id));
      return NextResponse.json({ suggestion: queued }, { status: queued.status === "queued" ? 202 : 200 });
    }
    const suggestion = await supabase.from("curriculum_scope_suggestions").select("id,status").eq("id", parsed.data.suggestionId).eq("curriculum_unit_id", id).maybeSingle();
    if (!suggestion.data) return NextResponse.json({ error: "Scope suggestion not found." }, { status: 404 });
    if (suggestion.data.status !== "failed") return NextResponse.json({ error: "Only a failed suggestion can be retried." }, { status: 409 });
    const queued = await supabase.from("curriculum_scope_suggestions").update({ status: "queued", error_code: null }).eq("id", suggestion.data.id).eq("status", "failed").select("id,status").single();
    if (queued.error) throw queued.error;
    after(() => processCurriculumScopeSuggestion(queued.data.id));
    return NextResponse.json({ suggestion: queued.data }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not refresh that scope suggestion." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = decisionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid scope decision." }, { status: 400 });
    const supabase = await createClient();
    const suggestion = await supabase.from("curriculum_scope_suggestions").select("id,family_id,status,source_kind,source_evidence_ids").eq("id", parsed.data.suggestionId).eq("curriculum_unit_id", id).maybeSingle();
    if (!suggestion.data) return NextResponse.json({ error: "Scope suggestion not found." }, { status: 404 });
    if (parsed.data.action === "dismiss") {
      const dismissed = await supabase.from("curriculum_scope_suggestions").update({ status: "dismissed", reviewed_by: parent.id, reviewed_at: new Date().toISOString() }).eq("id", suggestion.data.id).eq("status", "ready").select("id,status").maybeSingle();
      if (dismissed.error) throw dismissed.error;
      if (!dismissed.data) return NextResponse.json({ error: "That proposal is no longer ready for review." }, { status: 409 });
      await writeAuditEvent(createAdminClient(), { familyId: suggestion.data.family_id, actorId: parent.id, actorType: "parent", action: "curriculum_scope.suggestion_dismissed", entityType: "curriculum_unit", entityId: id, metadata: { suggestion_id: suggestion.data.id, source_kind: suggestion.data.source_kind, evidence_ids: suggestion.data.source_evidence_ids } });
      return NextResponse.json({ suggestion: dismissed.data });
    }
    const result = await applyCurriculumScopeSuggestion({ supabase, suggestionId: suggestion.data.id, parentId: parent.id, selections: parsed.data.selections, targetLessonCount: parsed.data.targetLessonCount });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    const message = error instanceof Error ? error.message : "";
    if (/CONFLICT|PROTECTED|STALE|SCHEDULE_|OVERLAP/.test(message)) return NextResponse.json({ error: message.includes("TARGET_CONFLICT:") ? message.split("TARGET_CONFLICT:")[1] : "That proposal conflicts with protected or newly changed curriculum work." }, { status: 409 });
    return NextResponse.json({ error: "Klio could not apply that scope suggestion." }, { status: 500 });
  }
}
