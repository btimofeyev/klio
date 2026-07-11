import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { ReviewWorkspace, type ReviewArtifact, type ReviewObservation } from "@/components/review-workspace";

export default async function ActivityPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const [{ data: artifacts, error: artifactError }, { data: observations, error: observationError }, { data: events }] = await Promise.all([
    supabase.from("artifacts").select("id, title, summary, type, created_at, student_id").eq("family_id", workspace.family.id).eq("status", "draft").order("created_at", { ascending: false }).limit(200),
    supabase.from("skill_observations").select("id, student_id, subject, skill_label, status, rationale, confidence, created_at").eq("family_id", workspace.family.id).eq("approval_status", "draft").order("created_at", { ascending: false }).limit(300),
    supabase.from("audit_events").select("id, action, entity_type, metadata, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(40),
  ]);
  if (artifactError) throw artifactError;
  if (observationError) throw observationError;
  const studentNames = new Map(workspace.students.map((student) => [student.id, student.displayName]));
  const reviewArtifacts: ReviewArtifact[] = (artifacts ?? []).map((artifact) => ({ id: artifact.id, title: artifact.title, summary: artifact.summary, type: artifact.type, createdAt: artifact.created_at, studentName: artifact.student_id ? studentNames.get(artifact.student_id) ?? null : null }));
  const reviewObservations: ReviewObservation[] = (observations ?? []).map((observation) => ({ id: observation.id, subject: observation.subject, skillLabel: observation.skill_label, status: observation.status as ReviewObservation["status"], rationale: observation.rationale, confidence: observation.confidence, createdAt: observation.created_at, studentName: studentNames.get(observation.student_id) ?? null }));
  return (
    <div className="section-page activity-page">
      <header><p className="eyebrow">Parent review</p><h1>Review</h1><p>Edit Klio’s drafts, then approve or reject several decisions together.</p></header>
      <section className="review-section"><h2>Waiting for you</h2><ReviewWorkspace familyId={workspace.family.id} initialArtifacts={reviewArtifacts} initialObservations={reviewObservations} /></section>
      <section className="history-section"><h2>Audit history</h2>{events?.map((event) => <div className="history-row" key={event.id}><time>{new Date(event.created_at).toLocaleString()}</time><strong>{event.action.replaceAll(".", " ")}</strong><span>{event.entity_type.replaceAll("_", " ")}</span></div>)}</section>
    </div>
  );
}
