import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ProactiveEventKind } from "./evaluate";

export async function enqueueProactiveEvaluation(input: {
  familyId: string;
  studentId?: string | null;
  requestedBy?: string | null;
  eventKind: ProactiveEventKind;
  entityType: string;
  entityId?: string | null;
  idempotencyKey: string;
}) {
  const admin = createAdminClient();
  const inserted = await admin.from("proactive_evaluations").insert({
    family_id: input.familyId,
    student_id: input.studentId ?? null,
    requested_by: input.requestedBy ?? null,
    event_kind: input.eventKind,
    entity_type: input.entityType.slice(0, 80),
    entity_id: input.entityId ?? null,
    idempotency_key: input.idempotencyKey,
  }).select("id,status,outcome").single();
  if (!inserted.error) return { evaluation: inserted.data, duplicate: false };
  if (inserted.error.code !== "23505") throw inserted.error;
  const existing = await admin.from("proactive_evaluations").select("id,status,outcome")
    .eq("family_id", input.familyId).eq("idempotency_key", input.idempotencyKey).single();
  if (existing.error) throw existing.error;
  return { evaluation: existing.data, duplicate: true };
}
