import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { applyCurriculumMaterialSuggestion, processCurriculumMaterialSuggestion } from "@/lib/curriculum/material-ingestion";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const retrySchema = z.object({ action: z.literal("retry"), suggestionId: z.uuid() }).strict();
const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss"), suggestionId: z.uuid() }).strict(),
  z.object({
    action: z.literal("apply"),
    suggestionId: z.uuid(),
    edits: z.object({
      title: z.string().trim().min(1).max(200).optional(),
      itemKind: z.enum(["lesson", "assessment", "review", "project", "activity"]).optional(),
      instructions: z.string().trim().max(1000).optional(),
      minutes: z.number().int().min(5).max(480).optional(),
      path: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
    }).strict().optional(),
  }).strict(),
]);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireParentApi();
    const { id } = await context.params;
    const supabase = await createClient();
    const assignment = await supabase.from("assignments").select("id,family_id,curriculum_unit_id").eq("id", id).maybeSingle();
    if (!assignment.data?.curriculum_unit_id) return NextResponse.json({ error: "Curriculum assignment not found." }, { status: 404 });
    const [materials, suggestions] = await Promise.all([
      supabase.from("assignment_materials").select("assignment_id,evidence_id,role,position,created_at,evidence_items(id,title,kind,mime_type,file_size,processing_status,created_at)").eq("family_id", assignment.data.family_id).eq("assignment_id", id).order("position"),
      supabase.from("curriculum_material_suggestions").select("id,evidence_id,status,proposed_title,proposed_kind,proposed_instructions,proposed_minutes,proposed_path,confidence,rationale,uncertainty_flags,error_code,created_at,updated_at").eq("family_id", assignment.data.family_id).eq("assignment_id", id).order("created_at", { ascending: false }),
    ]);
    if (materials.error ?? suggestions.error) throw materials.error ?? suggestions.error;
    return NextResponse.json({ materials: materials.data, suggestions: suggestions.data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not load the lesson material." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireParentApi();
    const { id } = await context.params;
    const parsed = retrySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a suggestion to retry." }, { status: 400 });
    const supabase = await createClient();
    const suggestion = await supabase.from("curriculum_material_suggestions").select("id,status").eq("id", parsed.data.suggestionId).eq("assignment_id", id).maybeSingle();
    if (!suggestion.data) return NextResponse.json({ error: "Material suggestion not found." }, { status: 404 });
    if (suggestion.data.status !== "failed") return NextResponse.json({ error: "Only a failed suggestion can be retried." }, { status: 409 });
    const queued = await supabase.from("curriculum_material_suggestions").update({ status: "queued", error_code: null }).eq("id", suggestion.data.id).eq("status", "failed").select("id,status").single();
    if (queued.error) throw queued.error;
    after(() => processCurriculumMaterialSuggestion(queued.data.id));
    return NextResponse.json({ suggestion: queued.data }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not retry that material." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const { id } = await context.params;
    const parsed = decisionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid material decision." }, { status: 400 });
    const supabase = await createClient();
    const suggestion = await supabase.from("curriculum_material_suggestions").select("id,family_id,assignment_id,status,evidence_id").eq("id", parsed.data.suggestionId).eq("assignment_id", id).maybeSingle();
    if (!suggestion.data) return NextResponse.json({ error: "Material suggestion not found." }, { status: 404 });
    if (parsed.data.action === "dismiss") {
      const dismissed = await supabase.from("curriculum_material_suggestions").update({ status: "dismissed", reviewed_by: parent.id, reviewed_at: new Date().toISOString() })
        .eq("id", suggestion.data.id).eq("status", "ready").select("id,status").maybeSingle();
      if (dismissed.error) throw dismissed.error;
      if (!dismissed.data) return NextResponse.json({ error: "That suggestion is no longer ready for review." }, { status: 409 });
      await writeAuditEvent(createAdminClient(), { familyId: suggestion.data.family_id, actorId: parent.id, actorType: "parent", action: "curriculum_material.suggestion_dismissed", entityType: "assignment", entityId: id, metadata: { suggestion_id: suggestion.data.id, evidence_id: suggestion.data.evidence_id } });
      return NextResponse.json({ suggestion: dismissed.data });
    }
    const result = await applyCurriculumMaterialSuggestion({ supabase, suggestionId: suggestion.data.id, parentId: parent.id, edits: parsed.data.edits });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    const message = error instanceof Error ? error.message : "";
    if (/STALE|SCHEDULE_|OVERLAP/.test(message)) return NextResponse.json({ error: /STALE/.test(message) ? "That suggestion is stale. Refresh the lesson before applying it." : "The new duration does not fit the current schedule." }, { status: 409 });
    return NextResponse.json({ error: "Klio could not apply that material suggestion." }, { status: 500 });
  }
}
