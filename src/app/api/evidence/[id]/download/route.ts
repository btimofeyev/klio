import { NextResponse } from "next/server";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireParentApi();
    const supabase = await createClient();
    const { data: item } = await supabase.from("evidence_items").select("storage_path").eq("id", (await params).id).maybeSingle();
    if (!item?.storage_path) return NextResponse.json({ error: "Original not found." }, { status: 404 });
    const { data, error } = await supabase.storage.from("family-evidence").createSignedUrl(item.storage_path, 60);
    if (error) throw error;
    return NextResponse.redirect(data.signedUrl, 302);
  } catch { return NextResponse.json({ error: "You do not have access to this file." }, { status: 403 }); }
}
