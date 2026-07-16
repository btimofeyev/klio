import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { enqueueProactiveEvaluation } from "@/lib/proactive/evaluate";

const schema = z.object({
  familyId: z.uuid(),
  categoryId: z.uuid().optional(),
  categoryName: z.string().trim().min(1).max(80).optional(),
  studentId: z.uuid().optional(),
}).refine((value) => Boolean(value.categoryId) !== Boolean(value.categoryName), "Choose one folder.");

export async function POST(request: Request, { params }: RouteContext<"/api/evidence/[id]/category">) {
  try {
    const parent = await requireParentApi();
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a folder." }, { status: 400 });
    const supabase = await createClient();
    const [{ data: membership }, { data: evidence }, studentResult] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("evidence_items").select("id, title, raw_text, evidence_categories(document_type, tags, confidence, categories(name))").eq("id", id).eq("family_id", parsed.data.familyId).maybeSingle(),
      parsed.data.studentId
        ? supabase.from("students").select("id").eq("id", parsed.data.studentId).eq("family_id", parsed.data.familyId).eq("active", true).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!membership) return NextResponse.json({ error: "You do not have access to that record." }, { status: 403 });
    if (!evidence) return NextResponse.json({ error: "Record not found." }, { status: 404 });
    if (parsed.data.studentId && !studentResult.data) return NextResponse.json({ error: "Learner not found." }, { status: 404 });
    let category: { id: string; name: string } | null = null;
    if (parsed.data.categoryId) {
      const result = await supabase.from("categories").select("id, name").eq("id", parsed.data.categoryId).eq("family_id", parsed.data.familyId).maybeSingle();
      category = result.data;
    } else if (parsed.data.categoryName) {
      const slug = slugify(parsed.data.categoryName);
      const created = await supabase.from("categories").upsert(
        { family_id: parsed.data.familyId, name: parsed.data.categoryName, slug, created_by_type: "parent", created_by: parent.id },
        { onConflict: "family_id,slug", ignoreDuplicates: true },
      );
      if (created.error) throw created.error;
      const existing = await supabase.from("categories").select("id, name").eq("family_id", parsed.data.familyId).eq("slug", slug).single();
      if (existing.error) throw existing.error;
      category = existing.data;
    }
    if (!category) return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    const previous = evidence.evidence_categories[0];
    const admin = createAdminClient();
    if (previous?.categories.name !== category.name) {
      const { error: deleteError } = await admin.from("evidence_categories").delete().eq("family_id", parsed.data.familyId).eq("evidence_id", id);
      if (deleteError) throw deleteError;
      const { error: linkError } = await admin.from("evidence_categories").insert({
        family_id: parsed.data.familyId,
        evidence_id: id,
        category_id: category.id,
        assigned_by: "parent",
        document_type: previous?.document_type ?? "Record",
        tags: previous?.tags ?? [],
        confidence: previous?.confidence,
      });
      if (linkError) throw linkError;
    }
    if (parsed.data.studentId) {
      const { error: studentLinkError } = await admin.from("evidence_students").upsert({
        family_id: parsed.data.familyId,
        evidence_id: id,
        student_id: parsed.data.studentId,
      }, { onConflict: "evidence_id,student_id" });
      if (studentLinkError) throw studentLinkError;
      const { error: oldStudentError } = await admin.from("evidence_students").delete().eq("family_id", parsed.data.familyId).eq("evidence_id", id).neq("student_id", parsed.data.studentId);
      if (oldStudentError) throw oldStudentError;
    }
    const { error: evidenceError } = await admin.from("evidence_items").update({ capture_route: "learning", processing_status: "ready" }).eq("id", id).eq("family_id", parsed.data.familyId);
    if (evidenceError) throw evidenceError;

    const cues = buildCues(evidence.title, evidence.raw_text, previous?.tags ?? []);
    const { error: correctionError } = await supabase.from("organization_corrections").insert({
      family_id: parsed.data.familyId,
      evidence_id: id,
      from_category_name: previous?.categories.name ?? null,
      to_category_id: category.id,
      evidence_title: evidence.title,
      evidence_excerpt: evidence.raw_text?.slice(0, 500) ?? null,
      cues,
      created_by: parent.id,
    });
    if (correctionError) throw correctionError;
    await writeAuditEvent(admin, { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "evidence.folder_corrected", entityType: "evidence_item", entityId: id, metadata: { from: previous?.categories.name ?? null, to: category.name, student_id: parsed.data.studentId ?? null, cues } });
    await enqueueProactiveEvaluation({ familyId: parsed.data.familyId, studentId: parsed.data.studentId ?? null, requestedBy: parent.id, eventKind: "parent_correction", entityType: "evidence_item", entityId: id, idempotencyKey: `filing-correction:${id}:${category.id}:${parsed.data.studentId ?? "family"}` });
    return NextResponse.json({ moved: true, category });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not move that record." }, { status: 500 });
  }
}

function buildCues(title: string | null, rawText: string | null, tags: string[]) {
  const words = `${title ?? ""} ${rawText?.slice(0, 300) ?? ""}`.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [];
  return [...new Set([...tags.map((tag) => tag.toLowerCase()), ...words])].slice(0, 16);
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}
