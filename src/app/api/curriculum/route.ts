import { after, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { inferCourseIdentityFromName, normalizeCourseIdentity } from "@/lib/curriculum/course-identity";
import { curriculumResearchResultSchema } from "@/lib/curriculum/curriculum-research";
import { applyCurriculumScopeSuggestion } from "@/lib/curriculum/scope-ingestion";
import { scopeSuggestionFingerprint } from "@/lib/curriculum/scope-suggestion";
import { ensureCurriculumScope, resizeCurriculumScope, rewriteUntouchedPlaceholderTitles } from "@/lib/curriculum/scope-store";
import { queueWebScopeSuggestion } from "@/lib/curriculum/scope-suggestion-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { referenceUrlSchema } from "@/lib/security/reference-url";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const schema = z.object({
  curriculumUnitId: z.uuid().nullable().optional(),
  familyId: z.uuid(), studentId: z.uuid(), subject: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200),
  sequenceLabel: z.string().trim().min(1).max(40).default("Lesson"), targetLessonCount: z.number().int().min(1).max(500).default(100),
  estimatedMinutes: z.number().int().min(5).max(480).default(40), weeklyFrequency: z.number().int().min(1).max(7).default(5),
  attentionMode: z.enum(["unspecified", "parent_led", "independent", "flexible"]).default("unspecified"),
  parentAttentionMinutes: z.number().int().min(1).max(480).nullable().optional(), curriculumUrl: referenceUrlSchema.nullable().optional(),
  publisher: optionalText(120), productName: optionalText(200), gradeLabel: optionalText(80), editionLabel: optionalText(120), isbn: optionalText(32),
  research: z.object({ result: curriculumResearchResultSchema, mode: z.enum(["detected", "generic"]) }).strict().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.attentionMode === "flexible" && !value.parentAttentionMinutes) context.addIssue({ code: "custom", path: ["parentAttentionMinutes"], message: "Add the minutes spent together." });
  if (value.attentionMode !== "flexible" && value.parentAttentionMinutes) context.addIssue({ code: "custom", path: ["parentAttentionMinutes"], message: "Minutes together only apply to flexible support." });
});

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the curriculum details and try again." }, { status: 400 });
    const input = parsed.data;
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", input.familyId).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle();
    if (!membership.data) return NextResponse.json({ error: "You do not have access to this family." }, { status: 403 });
    const student = await supabase.from("students").select("id").eq("id", input.studentId).eq("family_id", input.familyId).maybeSingle();
    if (!student.data) return NextResponse.json({ error: "Choose a learner in this family." }, { status: 400 });
    const inferred = inferCourseIdentityFromName(input.title, input.subject);
    const researchedIdentity = input.research?.result.proposal.identity;
    const explicitIdentity = normalizeCourseIdentity({ publisher: input.publisher ?? researchedIdentity?.publisher ?? inferred.publisher, productName: input.productName ?? researchedIdentity?.productName ?? inferred.productName, subject: input.subject, gradeLabel: input.gradeLabel ?? researchedIdentity?.gradeLabel ?? inferred.gradeLabel, editionLabel: input.editionLabel ?? researchedIdentity?.editionLabel, isbn: input.isbn ?? researchedIdentity?.isbn }, input.isbn || input.editionLabel ? "parent_input" : input.research ? "web_search" : "parent_input");
    const unitValues = {
      subject: input.subject, title: input.title, curriculum_url: input.curriculumUrl ?? null, sequence_label: input.sequenceLabel,
      default_minutes: input.estimatedMinutes, target_lesson_count: input.targetLessonCount,
      schedule_rule: { weeklyFrequency: input.weeklyFrequency }, attention_mode: input.attentionMode,
      parent_attention_minutes: input.attentionMode === "flexible" ? input.parentAttentionMinutes ?? null : null,
      publisher: explicitIdentity.publisher, product_name: explicitIdentity.productName, grade_label: explicitIdentity.gradeLabel,
      edition_label: explicitIdentity.editionLabel, isbn: explicitIdentity.isbn, identity_status: explicitIdentity.status,
    };
    const unitColumns = "id,family_id,student_id,subject,title,sequence_label,default_minutes,target_lesson_count,publisher,product_name,grade_label,edition_label,isbn,identity_status";
    const existing = input.curriculumUnitId
      ? await supabase.from("curriculum_units").select(unitColumns).eq("id", input.curriculumUnitId).eq("family_id", input.familyId).eq("student_id", input.studentId).maybeSingle()
      : null;
    if (existing?.error) throw existing.error;
    if (input.curriculumUnitId && !existing?.data) return NextResponse.json({ error: "That curriculum could not be found." }, { status: 404 });

    if (existing?.data) {
      const resize = await resizeCurriculumScope({ supabase, unit: existing.data, parentId: parent.id, targetLessonCount: input.targetLessonCount });
      if (!resize.allowed) return NextResponse.json({ error: resize.reason }, { status: 409 });
    }

    const unit = input.curriculumUnitId
      ? await supabase.from("curriculum_units").update(unitValues).eq("id", input.curriculumUnitId).eq("family_id", input.familyId).eq("student_id", input.studentId).select(unitColumns).single()
      : await supabase.from("curriculum_units").insert({ family_id: input.familyId, student_id: input.studentId, created_by: parent.id, ...unitValues, next_sequence_number: input.targetLessonCount + 1 }).select(unitColumns).single();
    if (unit.error) throw unit.error;
    if (!input.curriculumUnitId) {
      await ensureCurriculumScope({ supabase, unit: unit.data, parentId: parent.id });
    } else if (existing?.data && (existing.data.title !== unit.data.title || existing.data.sequence_label !== unit.data.sequence_label)) {
      await rewriteUntouchedPlaceholderTitles({ supabase, unit: unit.data });
    }
    if (!input.curriculumUnitId && input.research?.mode === "detected") {
      const proposedItems = input.research.result.proposal.items.filter((item) => item.sequenceNumber <= input.targetLessonCount);
      const suggestion = await supabase.from("curriculum_scope_suggestions").insert({
        family_id: input.familyId,
        curriculum_unit_id: unit.data.id,
        requested_by: parent.id,
        status: "ready",
        publisher: explicitIdentity.publisher,
        product_name: explicitIdentity.productName,
        grade_label: explicitIdentity.gradeLabel,
        edition_label: explicitIdentity.editionLabel,
        isbn: explicitIdentity.isbn,
        identity_status: explicitIdentity.status,
        source_kind: "web_search",
        source_fingerprint: scopeSuggestionFingerprint({ identity: explicitIdentity, sourceKind: "web_search", courseTitle: input.title }),
        source_urls: input.research.result.sources,
        confidence: input.research.result.proposal.confidence,
        assumptions: input.research.result.proposal.assumptions,
        proposed_target_count: input.targetLessonCount,
        proposed_items: proposedItems,
        before_snapshot: { identity: explicitIdentity, targetLessonCount: input.targetLessonCount, preCreationResearch: true, pacing: input.research.result.pacing, expandedFromContainers: input.research.result.structure.expandedFromContainers },
      }).select("id").single();
      if (suggestion.error) throw suggestion.error;
      await applyCurriculumScopeSuggestion({
        supabase,
        suggestionId: suggestion.data.id,
        parentId: parent.id,
        targetLessonCount: input.targetLessonCount,
        selections: proposedItems.map((item) => ({ sequenceNumber: item.sequenceNumber })),
      });
    } else if (!input.research) {
      after(() => queueWebScopeSuggestion({ familyId: input.familyId, curriculumUnitId: unit.data.id, requestedBy: parent.id }));
    }
    await writeAuditEvent(createAdminClient(), { familyId: input.familyId, actorId: parent.id, actorType: "parent", action: input.curriculumUnitId ? "curriculum_unit.updated" : "curriculum_unit.created", entityType: "curriculum_unit", entityId: unit.data.id, metadata: { target_lesson_count: input.targetLessonCount, scheduled_assignment_count: 0, identity_status: explicitIdentity.status, researched_before_creation: Boolean(input.research), research_mode: input.research?.mode ?? null } });
    return NextResponse.json({ unit: unit.data, assignmentCount: input.targetLessonCount, scheduledCount: 0 }, { status: input.curriculumUnitId ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    const invalidIsbn = error instanceof Error && /ISBN/.test(error.message);
    return NextResponse.json({ error: invalidIsbn ? error.message : "Klio could not add that curriculum." }, { status: invalidIsbn ? 400 : 500 });
  }
}
