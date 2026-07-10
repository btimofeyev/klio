import { NextResponse } from "next/server";
import Papa from "papaparse";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const form = await request.formData();
    const familyId = z.uuid().parse(form.get("familyId"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Choose a CSV smaller than 5 MB." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() });
    if (!parsed.meta.fields?.length || !parsed.data.length) return NextResponse.json({ error: "The CSV has no usable rows." }, { status: 400 });
    const importId = crypto.randomUUID();
    const path = `${familyId}/imports/${importId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error: uploadError } = await supabase.storage.from("family-evidence").upload(path, file, { contentType: "text/csv" });
    if (uploadError) throw uploadError;
    const parseErrors = parsed.errors.slice(0, 20).map(({ type, code, message, row }) => ({ type, code, message, row: row ?? null }));
    const { error } = await supabase.from("imports").insert({ id: importId, family_id: familyId, created_by: parent.id, storage_path: path, status: "previewed", validation_results: { row_count: parsed.data.length, parse_errors: parseErrors } });
    if (error) throw error;
    return NextResponse.json({ importId, headers: parsed.meta.fields, rows: parsed.data.slice(0, 8), totalRows: parsed.data.length });
  } catch { return NextResponse.json({ error: "Klio could not preview this CSV." }, { status: 400 }); }
}
