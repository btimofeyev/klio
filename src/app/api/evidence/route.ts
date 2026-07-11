import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentApi } from "@/lib/auth/require-parent";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { enqueueAgentJob, safelyProcessAgentJob } from "@/lib/agent/jobs";
import type { AgentIntent } from "@/lib/agent/run-agent";

export const runtime = "nodejs";
export const maxDuration = 300;

const inputSchema = z.object({ familyId: z.uuid(), studentId: z.uuid(), text: z.string().max(20000).optional(), kind: z.enum(["note", "grade", "book", "activity"]).default("note") });
const intentsSchema = z.array(z.enum(["understand", "update_records", "next_step", "weekly_plan", "lesson", "summary", "practice", "portfolio"])).min(1).max(3);
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
    let intentInput: unknown = ["understand"];
    try { intentInput = JSON.parse(typeof form.get("intents") === "string" ? String(form.get("intents")) : '["understand"]'); } catch { intentInput = null; }
    const intents = intentsSchema.safeParse(intentInput);
    if (!intents.success) return NextResponse.json({ error: "Choose one to three Klio actions." }, { status: 400 });

    const files = form.getAll("file").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length && !parsed.data.text?.trim()) return NextResponse.json({ error: "Add a note, photo, voice clip, or file." }, { status: 400 });
    if (files.length > 10) return NextResponse.json({ error: "You can attach up to 10 files at once." }, { status: 400 });
    if (files.some((file) => file.size > 50 * 1024 * 1024 || !allowedTypes.has(file.type))) {
      return NextResponse.json({ error: "That file type or size is not supported." }, { status: 400 });
    }

    const supabase = await createClient();
    const [{ data: membership }, { data: student }] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("students").select("id").eq("id", parsed.data.studentId).eq("family_id", parsed.data.familyId).maybeSingle(),
    ]);
    if (!membership || !student) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });

    const captures = files.length ? files.map((file) => ({ id: crypto.randomUUID(), file })) : [{ id: crypto.randomUUID(), file: null }];
    const storagePaths: string[] = [];
    for (const { id, file } of captures) {
      if (!file) continue;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "capture";
      const storagePath = `${parsed.data.familyId}/${id}/${safeName}`;
      const { error: uploadError } = await supabase.storage.from("family-evidence").upload(storagePath, file, { upsert: false, contentType: file.type });
      if (uploadError) {
        if (storagePaths.length) await supabase.storage.from("family-evidence").remove(storagePaths);
        return NextResponse.json({ error: uploadError.message }, { status: 400 });
      }
      storagePaths.push(storagePath);
    }

    const text = parsed.data.text?.trim() || null;
    const evidence = captures.map(({ id, file }, index) => ({
      id, family_id: parsed.data.familyId, created_by: parent.id, kind: file ? inferKind(file) : parsed.data.kind,
      title: (index === 0 ? text?.slice(0, 120) : null) || file?.name || null,
      raw_text: index === 0 ? text : null, storage_path: file ? storagePaths[index] : null,
      mime_type: file?.type || null, file_size: file?.size || null,
      provenance: { source: "klio_inbox", original_filename: file?.name ?? null },
    }));
    const { error: evidenceError } = await supabase.from("evidence_items").insert(evidence);
    if (evidenceError) {
      if (storagePaths.length) await supabase.storage.from("family-evidence").remove(storagePaths);
      return NextResponse.json({ error: evidenceError.message }, { status: 400 });
    }

    const ids = captures.map(({ id }) => id);
    const { error: linkError } = await supabase.from("evidence_students").insert(ids.map((id) => ({ evidence_id: id, student_id: parsed.data.studentId, family_id: parsed.data.familyId })));
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 400 });

    await writeAuditEvent(createAdminClient(), {
      familyId: parsed.data.familyId, actorId: parent.id, actorType: "parent",
      action: "evidence.captured", entityType: "evidence_item", entityId: ids[0],
      metadata: { item_count: ids.length, has_file: Boolean(files.length), has_text: Boolean(text) },
    });
    const job = await enqueueAgentJob({
      familyId: parsed.data.familyId,
      parentId: parent.id,
      studentId: parsed.data.studentId,
      evidenceIds: ids,
      intents: intents.data as AgentIntent[],
    });
    after(() => safelyProcessAgentJob(job.id));
    return NextResponse.json({ id: ids[0], ids, status: "queued", job }, { status: 201 });
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
