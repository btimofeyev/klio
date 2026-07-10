import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/auth/require-parent";

export async function getArtifact(id: string) {
  await requireParent();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, family_id, student_id, type, title, summary, content, rationale, status, created_at, updated_at, artifact_sources(evidence_id), weekly_plan_items(id, title, description, scheduled_date, estimated_minutes, subject, completed_at, position)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
