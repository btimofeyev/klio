import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { CourseIdentity } from "./course-identity";
import { processCurriculumScopeSuggestion } from "./scope-ingestion";
import { scopeSuggestionFingerprint } from "./scope-suggestion";

export async function queueWebScopeSuggestion(input: { familyId: string; curriculumUnitId: string; requestedBy: string; process?: boolean; force?: boolean }) {
  const admin = createAdminClient();
  const unit = await admin.from("curriculum_units").select("id,family_id,title,subject,publisher,product_name,grade_label,edition_label,isbn,identity_status,target_lesson_count").eq("id", input.curriculumUnitId).eq("family_id", input.familyId).maybeSingle();
  if (unit.error) throw unit.error;
  if (!unit.data) return null;
  const identity: CourseIdentity = {
    publisher: unit.data.publisher,
    productName: unit.data.product_name,
    subject: unit.data.subject,
    gradeLabel: unit.data.grade_label,
    editionLabel: unit.data.edition_label,
    isbn: unit.data.isbn,
    status: unit.data.identity_status === "verified" ? "verified" : unit.data.identity_status === "recognized" ? "recognized" : "generic",
  };
  const fingerprint = scopeSuggestionFingerprint({ identity, sourceKind: "web_search", courseTitle: unit.data.title });
  const existing = await admin.from("curriculum_scope_suggestions").select("id,status").eq("family_id", input.familyId).eq("curriculum_unit_id", input.curriculumUnitId).eq("source_fingerprint", fingerprint).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (["queued", "processing"].includes(existing.data.status)) {
      if (existing.data.status === "queued" && input.process !== false) return processCurriculumScopeSuggestion(existing.data.id);
      return existing.data;
    }
    if (!input.force) return existing.data;
    if (existing.data.status === "ready") {
      const superseded = await admin.from("curriculum_scope_suggestions").update({ status: "superseded" }).eq("id", existing.data.id).eq("status", "ready");
      if (superseded.error) throw superseded.error;
    }
  }
  const created = await admin.from("curriculum_scope_suggestions").insert({
    family_id: input.familyId,
    curriculum_unit_id: input.curriculumUnitId,
    requested_by: input.requestedBy,
    status: "queued",
    publisher: identity.publisher,
    product_name: identity.productName,
    grade_label: identity.gradeLabel,
    edition_label: identity.editionLabel,
    isbn: identity.isbn,
    identity_status: identity.status,
    source_kind: "web_search",
    source_fingerprint: fingerprint,
    confidence: null,
    assumptions: [],
    proposed_target_count: unit.data.target_lesson_count,
    proposed_items: [],
    source_urls: [],
    before_snapshot: { identity, courseTitle: unit.data.title, targetLessonCount: unit.data.target_lesson_count },
    model: null,
  }).select("id,status").single();
  if (created.error) throw created.error;
  return input.process === false ? created.data : processCurriculumScopeSuggestion(created.data.id);
}
