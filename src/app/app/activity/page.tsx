import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { reviewEntityAction } from "../actions";

export default async function ActivityPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const [{ data: observations }, { data: events }] = await Promise.all([
    supabase.from("skill_observations").select("id, subject, skill_label, status, rationale, confidence, created_at").eq("family_id", workspace.family.id).eq("approval_status", "draft").order("created_at", { ascending: false }),
    supabase.from("audit_events").select("id, action, entity_type, metadata, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const draftArtifacts = workspace.artifacts.filter((artifact) => artifact.status === "draft");
  return (
    <div className="section-page">
      <header><p className="eyebrow">Parent review</p><h1>Activity</h1><p>See what Klio proposed and what changed in your workspace.</p></header>
      <section className="review-section"><h2>Waiting for you</h2>
        {!draftArtifacts.length && !observations?.length ? <p className="section-empty">Nothing needs review.</p> : null}
        {draftArtifacts.map((artifact) => <Link href={`/app/artifacts/${artifact.id}`} className="review-row" key={artifact.id}><Sparkles size={17} /><div><strong>{artifact.title}</strong><span>Draft {artifact.type.replaceAll("_", " ")}</span></div><b>Review</b></Link>)}
        {observations?.map((observation) => (
          <div className="review-row observation" key={observation.id}><span className="subject-mark">{observation.subject.slice(0, 1)}</span><div><strong>{observation.skill_label}</strong><span>{observation.status} · {Math.round((observation.confidence ?? 0) * 100)}% confidence</span><p>{observation.rationale}</p></div>
            <form action={reviewEntityAction}><input type="hidden" name="familyId" value={workspace.family.id} /><input type="hidden" name="entityId" value={observation.id} /><input type="hidden" name="entityType" value="skill_observation" /><input type="hidden" name="decision" value="approved" /><button className="icon-approve" aria-label="Approve observation"><Check size={16} /></button></form>
          </div>
        ))}
      </section>
      <section className="history-section"><h2>Audit history</h2>{events?.map((event) => <div className="history-row" key={event.id}><time>{new Date(event.created_at).toLocaleString()}</time><strong>{event.action.replaceAll(".", " ")}</strong><span>{event.entity_type.replaceAll("_", " ")}</span></div>)}</section>
    </div>
  );
}
