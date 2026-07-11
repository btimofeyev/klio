import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const schema = z.object({ familyId: z.uuid(), categoryId: z.uuid() });

export async function POST(request: Request, { params }: RouteContext<"/api/evidence/[id]/category">) {
  try {
    const parent = await requireParentApi();
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a folder." }, { status: 400 });
    const supabase = await createClient();
    const [{ data: membership }, { data: evidence }, { data: category }] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("evidence_items").select("id, title, raw_text, evidence_categories(document_type, tags, confidence, categories(name))").eq("id", id).eq("family_id", parsed.data.familyId).maybeSingle(),
      supabase.from("categories").select("id, name").eq("id", parsed.data.categoryId).eq("family_id", parsed.data.familyId).maybeSingle(),
    ]);
    if (!membership) return NextResponse.json({ error: "You do not have access to that record." }, { status: 403 });
    if (!evidence || !category) return NextResponse.json({ error: "Record or folder not found." }, { status: 404 });
    const previous = evidence.evidence_categories[0];
    if (previous?.categories.name === category.name) return NextResponse.json({ moved: true });

    const admin = createAdminClient();
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
    await writeAuditEvent(admin, { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "evidence.folder_corrected", entityType: "evidence_item", entityId: id, metadata: { from: previous?.categories.name ?? null, to: category.name, cues } });
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
