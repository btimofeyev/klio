import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const updateSchema = z.object({ familyId: z.uuid(), name: z.string().trim().min(1).max(80) });
const deleteSchema = z.object({ familyId: z.uuid() });

export async function PATCH(request: Request, { params }: RouteContext<"/api/categories/[id]">) {
  try {
    const parent = await requireParentApi();
    const { id } = await params;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a folder name." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id")
      .eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that folder." }, { status: 403 });
    const { data, error } = await supabase.from("categories").update({
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: `${parsed.data.name} learning records and source evidence.`,
      created_by_type: "parent",
      created_by: parent.id,
    }).eq("id", id).eq("family_id", parsed.data.familyId).select("id, name, slug, description").maybeSingle();
    if (error?.code === "23505") return NextResponse.json({ error: "A folder with that name already exists." }, { status: 409 });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    await writeAuditEvent(createAdminClient(), { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "category.renamed", entityType: "category", entityId: id, metadata: { name: data.name } });
    return NextResponse.json({ category: data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not rename that folder." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/categories/[id]">) {
  try {
    const parent = await requireParentApi();
    const { id } = await params;
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "A family is required." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id")
      .eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that folder." }, { status: 403 });
    const { data, error } = await supabase.from("categories").delete().eq("id", id).eq("family_id", parsed.data.familyId).select("id, name").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    await writeAuditEvent(createAdminClient(), { familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent", action: "category.deleted", entityType: "category", entityId: id, metadata: { name: data.name } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not delete that folder." }, { status: 500 });
  }
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "general";
}
