import { NextResponse } from "next/server";
import Papa from "papaparse";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";

const schema = z.object({ familyId: z.uuid(), importId: z.uuid(), studentId: z.uuid(), mapping: z.object({ title: z.string(), subject: z.string(), score: z.string().min(1), date: z.string() }) });

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    const { data: record } = await supabase.from("imports").select("id, storage_path, status").eq("id", input.importId).eq("family_id", input.familyId).neq("status", "confirmed").maybeSingle();
    const { data: student } = await supabase.from("students").select("id").eq("id", input.studentId).eq("family_id", input.familyId).maybeSingle();
    if (!record || !student) return NextResponse.json({ error: "Import or learner not found." }, { status: 404 });
    const admin = createAdminClient();
    const { data: blob, error: downloadError } = await admin.storage.from("family-evidence").download(record.storage_path);
    if (downloadError) throw downloadError;
    const parsed = Papa.parse<Record<string, string>>(await blob.text(), { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() });
    const now = new Date().toISOString();
    const evidence = parsed.data.map((row, index) => {
      const parsedDate = input.mapping.date && row[input.mapping.date] ? new Date(row[input.mapping.date]) : new Date();
      return { id: crypto.randomUUID(), family_id: input.familyId, created_by: parent.id, kind: "grade" as const,
        title: input.mapping.title ? row[input.mapping.title]?.slice(0, 200) || `Grade row ${index + 1}` : `Grade row ${index + 1}`,
        raw_text: JSON.stringify({ score: row[input.mapping.score], subject: input.mapping.subject ? row[input.mapping.subject] : null, source_row: index + 2 }),
        source_at: Number.isNaN(parsedDate.getTime()) ? now : parsedDate.toISOString(), processing_status: "ready" as const,
        provenance: { import_id: input.importId, source_row: index + 2 } };
    });
    const { error: evidenceError } = await admin.from("evidence_items").insert(evidence);
    if (evidenceError) throw evidenceError;
    await admin.from("evidence_students").insert(evidence.map((item) => ({ evidence_id: item.id, student_id: input.studentId, family_id: input.familyId })));
    const parseErrors = parsed.errors.slice(0, 20).map(({ type, code, message, row }) => ({ type, code, message, row: row ?? null }));
    await admin.from("imports").update({ status: "confirmed", mapping: input.mapping, confirmed_at: now, validation_results: { row_count: evidence.length, parse_errors: parseErrors } }).eq("id", input.importId);
    await writeAuditEvent(admin, { familyId: input.familyId, actorId: parent.id, actorType: "parent", action: "grades.imported", entityType: "import", entityId: input.importId, metadata: { records_created: evidence.length } });
    return NextResponse.json({ created: evidence.length });
  } catch { return NextResponse.json({ error: "Klio could not confirm this import." }, { status: 400 }); }
}
