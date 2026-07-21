import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { buildGenericScope, evaluateTargetChange } from "./scope";

type Client = SupabaseClient<Database>;
type ScopeUnit = Pick<Database["public"]["Tables"]["curriculum_units"]["Row"],
  "id" | "family_id" | "student_id" | "title" | "subject" | "sequence_label" | "default_minutes" | "target_lesson_count">;

export async function ensureCurriculumScope(input: {
  supabase: Client;
  unit: ScopeUnit;
  parentId: string;
  targetLessonCount?: number;
}) {
  const targetLessonCount = input.targetLessonCount ?? input.unit.target_lesson_count;
  const rows = buildGenericScope({ courseTitle: input.unit.title, sequenceLabel: input.unit.sequence_label, targetLessonCount });
  for (let start = 0; start < rows.length; start += 100) {
    const inserted = await input.supabase.from("assignments").upsert(rows.slice(start, start + 100).map((row) => ({
      family_id: input.unit.family_id,
      student_id: input.unit.student_id,
      curriculum_unit_id: input.unit.id,
      created_by: input.parentId,
      created_by_type: "parent" as const,
      title: row.title,
      subject: input.unit.subject,
      sequence_number: row.sequenceNumber,
      status: "planned" as const,
      scheduled_date: null,
      scheduled_time: null,
      estimated_minutes: input.unit.default_minutes,
      source_kind: "curriculum" as const,
      curriculum_item_kind: row.curriculumItemKind,
      curriculum_item_state: row.curriculumItemState,
      curriculum_path: row.curriculumPath,
    })), { onConflict: "curriculum_unit_id,sequence_number", ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
  }
  const updated = await input.supabase.from("curriculum_units")
    .update({ target_lesson_count: targetLessonCount, next_sequence_number: targetLessonCount + 1 })
    .eq("id", input.unit.id).eq("family_id", input.unit.family_id).eq("student_id", input.unit.student_id);
  if (updated.error) throw updated.error;
  return {
    allowed: true as const,
    targetLessonCount,
    appendSequenceNumbers: targetLessonCount > input.unit.target_lesson_count
      ? Array.from({ length: targetLessonCount - input.unit.target_lesson_count }, (_, index) => input.unit.target_lesson_count + index + 1)
      : [],
    removeAssignmentIds: [],
    reason: null,
  };
}

export async function resizeCurriculumScope(input: {
  supabase: Client;
  unit: ScopeUnit;
  parentId: string;
  targetLessonCount: number;
}) {
  if (input.targetLessonCount >= input.unit.target_lesson_count) {
    return ensureCurriculumScope({ ...input, targetLessonCount: input.targetLessonCount });
  }
  const trailing = await input.supabase.from("assignments")
    .select("id,sequence_number,title,status,scheduled_date,curriculum_item_state")
    .eq("family_id", input.unit.family_id).eq("curriculum_unit_id", input.unit.id)
    .gt("sequence_number", input.targetLessonCount).order("sequence_number", { ascending: false });
  if (trailing.error) throw trailing.error;
  const ids = trailing.data.map((item) => item.id);
  const [materials, submissions, reviews] = ids.length ? await Promise.all([
    input.supabase.from("assignment_materials").select("assignment_id").eq("family_id", input.unit.family_id).in("assignment_id", ids),
    input.supabase.from("assignment_submissions").select("assignment_id").eq("family_id", input.unit.family_id).in("assignment_id", ids),
    input.supabase.from("assignment_reviews").select("assignment_id").eq("family_id", input.unit.family_id).in("assignment_id", ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const error = materials.error ?? submissions.error ?? reviews.error;
  if (error) throw error;
  const counts = (values: Array<{ assignment_id: string }>) => values.reduce((map, row) => map.set(row.assignment_id, (map.get(row.assignment_id) ?? 0) + 1), new Map<string, number>());
  const materialCounts = counts(materials.data ?? []);
  const submissionCounts = counts(submissions.data ?? []);
  const reviewCounts = counts(reviews.data ?? []);
  const decision = evaluateTargetChange({
    currentTarget: input.unit.target_lesson_count,
    nextTarget: input.targetLessonCount,
    courseTitle: input.unit.title,
    sequenceLabel: input.unit.sequence_label,
    assignments: trailing.data.map((item) => ({ id: item.id, sequenceNumber: item.sequence_number, title: item.title, status: item.status, scheduledDate: item.scheduled_date, curriculumItemState: item.curriculum_item_state, materialCount: materialCounts.get(item.id) ?? 0, submissionCount: submissionCounts.get(item.id) ?? 0, reviewCount: reviewCounts.get(item.id) ?? 0 })),
  });
  if (!decision.allowed) return decision;
  if (decision.removeAssignmentIds.length) {
    const removed = await input.supabase.from("assignments").delete().eq("family_id", input.unit.family_id).eq("curriculum_unit_id", input.unit.id).in("id", decision.removeAssignmentIds).is("scheduled_date", null).eq("status", "planned").eq("curriculum_item_state", "placeholder").select("id");
    if (removed.error) throw removed.error;
    if (removed.data.length !== decision.removeAssignmentIds.length) return { allowed: false as const, reason: "The trailing lessons changed while Klio was checking them. Refresh and try again.", appendSequenceNumbers: [], removeAssignmentIds: [] };
  }
  const updated = await input.supabase.from("curriculum_units").update({ target_lesson_count: input.targetLessonCount, next_sequence_number: input.targetLessonCount + 1 }).eq("id", input.unit.id).eq("family_id", input.unit.family_id);
  if (updated.error) throw updated.error;
  return decision;
}

export async function rewriteUntouchedPlaceholderTitles(input: {
  supabase: Client;
  unit: ScopeUnit;
}) {
  const placeholders = await input.supabase.from("assignments")
    .select("id,sequence_number")
    .eq("family_id", input.unit.family_id)
    .eq("curriculum_unit_id", input.unit.id)
    .eq("status", "planned")
    .is("scheduled_date", null)
    .eq("curriculum_item_state", "placeholder")
    .order("sequence_number", { ascending: true });
  if (placeholders.error) throw placeholders.error;

  for (const placeholder of placeholders.data) {
    if (placeholder.sequence_number === null) continue;
    const title = buildGenericScope({
      courseTitle: input.unit.title,
      sequenceLabel: input.unit.sequence_label,
      targetLessonCount: placeholder.sequence_number,
    }).at(-1)?.title;
    if (!title) continue;
    const updated = await input.supabase.from("assignments")
      .update({ title })
      .eq("id", placeholder.id)
      .eq("family_id", input.unit.family_id)
      .eq("status", "planned")
      .is("scheduled_date", null)
      .eq("curriculum_item_state", "placeholder");
    if (updated.error) throw updated.error;
  }
}
