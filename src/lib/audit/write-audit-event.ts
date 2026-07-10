import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

type AuditInput = {
  familyId: string;
  actorId?: string | null;
  actorType: "parent" | "agent" | "system";
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Json;
};

export async function writeAuditEvent(
  supabase: SupabaseClient<Database>,
  input: AuditInput,
) {
  const { error } = await supabase.from("audit_events").insert({
    family_id: input.familyId,
    actor_id: input.actorId ?? null,
    actor_type: input.actorType,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) throw error;
}
