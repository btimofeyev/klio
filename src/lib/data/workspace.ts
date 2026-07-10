import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/auth/require-parent";

export type StudentDTO = {
  id: string;
  displayName: string;
  gradeBand: string | null;
  learningPreferences: string | null;
};

export type EvidenceDTO = {
  id: string;
  kind: string;
  title: string | null;
  rawText: string | null;
  mimeType: string | null;
  storagePath: string | null;
  sourceAt: string;
  status: string;
  createdAt: string;
  studentIds: string[];
};

export type ArtifactDTO = {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  content: unknown;
  rationale: string | null;
  status: string;
  createdAt: string;
  studentId: string | null;
};

export const getWorkspace = cache(async () => {
  const parent = await requireParent();
  const supabase = await createClient();

  const { data: membership, error: membershipError } = await supabase
    .from("family_members")
    .select("family_id, role")
    .eq("user_id", parent.id)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return null;

  const familyId = membership.family_id;
  const [familyResult, studentsResult, evidenceResult, artifactsResult, approvalsResult] = await Promise.all([
    supabase.from("families").select("id, name, timezone").eq("id", familyId).single(),
    supabase.from("students").select("id, display_name, grade_band, learning_preferences").eq("family_id", familyId).eq("active", true).order("created_at"),
    supabase.from("evidence_items").select("id, kind, title, raw_text, mime_type, storage_path, source_at, processing_status, created_at, evidence_students(student_id)").eq("family_id", familyId).order("created_at", { ascending: false }).limit(40),
    supabase.from("artifacts").select("id, type, title, summary, content, rationale, status, created_at, student_id").eq("family_id", familyId).order("created_at", { ascending: false }).limit(20),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "pending"),
  ]);

  if (familyResult.error) throw familyResult.error;
  if (studentsResult.error) throw studentsResult.error;
  if (evidenceResult.error) throw evidenceResult.error;
  if (artifactsResult.error) throw artifactsResult.error;

  return {
    parent,
    family: familyResult.data,
    role: membership.role,
    students: studentsResult.data.map((student): StudentDTO => ({
      id: student.id,
      displayName: student.display_name,
      gradeBand: student.grade_band,
      learningPreferences: student.learning_preferences,
    })),
    evidence: evidenceResult.data.map((item): EvidenceDTO => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      rawText: item.raw_text,
      mimeType: item.mime_type,
      storagePath: item.storage_path,
      sourceAt: item.source_at,
      status: item.processing_status,
      createdAt: item.created_at,
      studentIds: item.evidence_students.map((link) => link.student_id),
    })),
    artifacts: artifactsResult.data.map((artifact): ArtifactDTO => ({
      id: artifact.id,
      type: artifact.type,
      title: artifact.title,
      summary: artifact.summary,
      content: artifact.content,
      rationale: artifact.rationale,
      status: artifact.status,
      createdAt: artifact.created_at,
      studentId: artifact.student_id,
    })),
    pendingApprovals: approvalsResult.count ?? 0,
  };
});
