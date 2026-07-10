import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentApi } from "@/lib/auth/require-parent";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const inputSchema = z.object({ familyId: z.uuid(), studentId: z.uuid(), text: z.string().max(20000).optional(), kind: z.enum(["note", "grade", "book", "activity"]).default("note") });
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/webm", "audio/mpeg", "audio/mp4", "audio/wav", "text/csv"]);

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const rate = checkRateLimit(`evidence:${parent.id}`, 30, 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many captures. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    const form = await request.formData();
    const parsed = inputSchema.safeParse({
      familyId: form.get("familyId"), studentId: form.get("studentId"),
      text: typeof form.get("text") === "string" ? form.get("text") : undefined,
      kind: typeof form.get("kind") === "string" ? form.get("kind") : "note",
    });
    if (!parsed.success) return NextResponse.json({ error: "The capture is missing required details." }, { status: 400 });

    const fileValue = form.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    if (!file && !parsed.data.text?.trim()) return NextResponse.json({ error: "Add a note, photo, voice clip, or file." }, { status: 400 });
    if (file && (file.size > 50 * 1024 * 1024 || !allowedTypes.has(file.type))) {
      return NextResponse.json({ error: "That file type or size is not supported." }, { status: 400 });
    }

    const supabase = await createClient();
    const [{ data: membership }, { data: student }] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("students").select("id").eq("id", parsed.data.studentId).eq("family_id", parsed.data.familyId).maybeSingle(),
    ]);
    if (!membership || !student) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });

    const id = crypto.randomUUID();
    let storagePath: string | null = null;
    if (file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "capture";
      storagePath = `${parsed.data.familyId}/${id}/${safeName}`;
      const { error: uploadError } = await supabase.storage.from("family-evidence").upload(storagePath, file, { upsert: false, contentType: file.type });
      if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 });
    }

    const kind = file ? inferKind(file) : parsed.data.kind;
    const title = parsed.data.text?.trim().slice(0, 120) || file?.name || null;
    const { error: evidenceError } = await supabase.from("evidence_items").insert({
      id, family_id: parsed.data.familyId, created_by: parent.id, kind,
      title, raw_text: parsed.data.text?.trim() || null, storage_path: storagePath,
      mime_type: file?.type || null, file_size: file?.size || null,
      provenance: { source: "klio_inbox", original_filename: file?.name ?? null },
    });
    if (evidenceError) {
      if (storagePath) await supabase.storage.from("family-evidence").remove([storagePath]);
      return NextResponse.json({ error: evidenceError.message }, { status: 400 });
    }

    const { error: linkError } = await supabase.from("evidence_students").insert({ evidence_id: id, student_id: parsed.data.studentId, family_id: parsed.data.familyId });
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 400 });

    await writeAuditEvent(createAdminClient(), {
      familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent",
      action: "evidence.captured", entityType: "evidence_item", entityId: id,
      metadata: { kind, has_file: Boolean(file), has_text: Boolean(parsed.data.text?.trim()) },
    });
    return NextResponse.json({ id, status: "received" }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not save this capture." }, { status: 500 });
  }
}

function inferKind(file: File | null) {
  if (!file) return "note" as const;
  if (file.type.startsWith("image/")) return "photo" as const;
  if (file.type.startsWith("audio/")) return "voice" as const;
  if (file.type === "text/csv") return "csv_import" as const;
  return "document" as const;
}
