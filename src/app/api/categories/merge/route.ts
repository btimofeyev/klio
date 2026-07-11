import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const schema = z.object({ familyId: z.uuid(), sourceId: z.uuid(), targetId: z.uuid() }).refine((value) => value.sourceId !== value.targetId);

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose two different folders." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id")
      .eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to those folders." }, { status: 403 });
    const admin = createAdminClient();
    const [{ data: categories }, { data: links, error: linksError }] = await Promise.all([
      admin.from("categories").select("id, name").eq("family_id", parsed.data.familyId).in("id", [parsed.data.sourceId, parsed.data.targetId]),
      admin.from("evidence_categories").select("evidence_id, category_id, document_type, tags, confidence").eq("family_id", parsed.data.familyId).in("category_id", [parsed.data.sourceId, parsed.data.targetId]),
    ]);
    if (categories?.length !== 2) return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    if (linksError) throw linksError;
    const source = categories.find((category) => category.id === parsed.data.sourceId)!;
    const targetLinks = new Map(links?.filter((link) => link.category_id === parsed.data.targetId).map((link) => [link.evidence_id, link]) ?? []);
    const merged = (links ?? []).filter((link) => link.category_id === parsed.data.sourceId).map((link) => {
      const target = targetLinks.get(link.evidence_id);
      return {
        family_id: parsed.data.familyId,
        evidence_id: link.evidence_id,
        category_id: parsed.data.targetId,
        assigned_by: "parent" as const,
        document_type: target?.document_type ?? link.document_type,
        confidence: target?.confidence ?? link.confidence,
        tags: [...new Set([...(target?.tags ?? []), ...link.tags])].slice(0, 12),
      };
    });
    if (merged.length) {
      const { error } = await admin.from("evidence_categories").upsert(merged, { onConflict: "evidence_id,category_id" });
      if (error) throw error;
    }
    await admin.from("organization_corrections").update({ to_category_id: parsed.data.targetId }).eq("family_id", parsed.data.familyId).eq("to_category_id", parsed.data.sourceId);
    const { error: deleteError } = await supabase.from("categories").delete().eq("id", parsed.data.sourceId).eq("family_id", parsed.data.familyId);
    if (deleteError) throw deleteError;
    await writeAuditEvent(admin, { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "category.merged", entityType: "category", entityId: parsed.data.targetId, metadata: { source_id: parsed.data.sourceId, source_name: source.name } });
    return NextResponse.json({ merged: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not merge those folders." }, { status: 500 });
  }
}
