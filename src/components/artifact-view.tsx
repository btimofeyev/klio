import { AlertCircle, Check, Clock, Sparkles } from "lucide-react";
import { launchPracticeAction, reviewEntityAction } from "@/app/app/actions";
import type { Json } from "@/lib/supabase/database.types";

type Content = {
  overview?: string;
  sections?: Array<{ heading: string; body: string; items: string[] }>;
  suggested_actions?: string[];
  plan_items?: Array<{ title: string; description: string }>;
  uncertainty_flags?: string[];
  practice?: { instructions: string; questions: Array<{ prompt: string; choices: string[] }> } | null;
};

export function ArtifactView({ artifact }: {
  artifact: { id: string; family_id: string; student_id: string | null; type: string; title: string; summary: string | null; content: Json; rationale: string | null; status: string; created_at: string };
}) {
  const content = artifact.content as Content;
  return (
    <article className="artifact-document">
      <header className="artifact-document-header">
        <div><p className="eyebrow"><Sparkles size={12} /> Klio {artifact.type.replaceAll("_", " ")}</p><h1>{artifact.title}</h1></div>
        <span className={`artifact-status ${artifact.status}`}>{artifact.status}</span>
      </header>
      {artifact.summary ? <p className="artifact-deck">{artifact.summary}</p> : null}
      {content.uncertainty_flags?.length ? (
        <aside className="uncertainty"><AlertCircle size={17} /><div><strong>Keep in mind</strong>{content.uncertainty_flags.map((flag) => <p key={flag}>{flag}</p>)}</div></aside>
      ) : null}
      {content.overview ? <section><p>{content.overview}</p></section> : null}
      {content.sections?.map((section) => (
        <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p>{section.items.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}</section>
      ))}
      {content.suggested_actions?.length ? <section><h2>Suggested next moves</h2><ol>{content.suggested_actions.map((item) => <li key={item}>{item}</li>)}</ol></section> : null}
      {artifact.rationale ? <footer><strong>Why Klio suggested this</strong><p>{artifact.rationale}</p></footer> : null}
      {artifact.type === "practice" && artifact.status === "approved" && content.practice ? (
        <form action={launchPracticeAction} className="practice-launch"><input type="hidden" name="artifactId" value={artifact.id} /><button className="primary-button">Start practice</button></form>
      ) : null}
      {artifact.status === "draft" ? (
        <div className="review-bar">
          <p><Clock size={16} /> Review before adding this to your family record.</p>
          <form action={reviewEntityAction}>
            <input type="hidden" name="familyId" value={artifact.family_id} /><input type="hidden" name="entityId" value={artifact.id} />
            <input type="hidden" name="entityType" value="artifact" /><input type="hidden" name="decision" value="rejected" />
            <button className="reject-button">Reject</button>
          </form>
          <form action={reviewEntityAction}>
            <input type="hidden" name="familyId" value={artifact.family_id} /><input type="hidden" name="entityId" value={artifact.id} />
            <input type="hidden" name="entityType" value="artifact" /><input type="hidden" name="decision" value="approved" />
            <button className="approve-button"><Check size={16} /> Approve</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}
