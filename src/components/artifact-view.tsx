import { AlertCircle, Check, Clock, Sparkles } from "lucide-react";
import { launchPracticeAction, reviewEntityAction } from "@/app/app/actions";
import type { Json } from "@/lib/supabase/database.types";
import { parsePracticeSpec } from "@/lib/practice/spec";
import { PracticePreview } from "@/components/practice-preview";

type ArtifactListEntry = string | Record<string, unknown>;

type Content = {
  overview?: string;
  sections?: Array<{ heading: string; body: string; items: string[] }>;
  suggested_actions?: string[];
  plan_items?: Array<{ title: string; description: string }>;
  uncertainty_flags?: string[];
  practice?: { instructions: string; questions: Array<{ prompt: string; choices: string[] }> } | null;
  student?: string;
  timeframe?: string;
  workedOn?: Array<{ area: string; status: string }>;
  unfinished?: ArtifactListEntry[];
  parentAttention?: ArtifactListEntry[];
  recordStatus?: Record<string, string | number | boolean | null>;
  recordNotes?: string;
  weekOf?: string;
  notes?: string;
  flexiblePlan?: Array<{ session: string; focus: string; activity: string; suggestedDuration?: string }>;
  planningBasis?: ArtifactListEntry[];
  decisionsNeeded?: ArtifactListEntry[];
};

export function ArtifactView({ artifact }: {
  artifact: { id: string; family_id: string; student_id: string | null; type: string; title: string; summary: string | null; content: Json; rationale: string | null; status: string; created_at: string };
}) {
  const content = artifact.content as Content;
  const practiceSpec = parsePracticeSpec(content.practice);
  return (
    <article className="artifact-document">
      <header className="artifact-document-header">
        <div><p className="eyebrow"><Sparkles size={12} /> Klio {artifact.type.replaceAll("_", " ")}</p><h1>{artifact.title}</h1></div>
        <span className={`artifact-status ${artifact.status}`}>{artifact.status}</span>
      </header>
      {artifact.summary ? <p className="artifact-deck">{artifact.summary}</p> : null}
      {content.uncertainty_flags?.length ? (
        <aside className="uncertainty"><AlertCircle size={17} /><div><strong>Keep in mind</strong>{content.uncertainty_flags.map((flag, index) => <p key={entryKey(flag, index)}>{flag}</p>)}</div></aside>
      ) : null}
      {content.overview ? <section><p>{content.overview}</p></section> : null}
      {content.timeframe || content.student ? <section className="artifact-context-line">{content.student ? <span>{content.student}</span> : null}{content.timeframe ? <span>{content.timeframe}</span> : null}</section> : null}
      {content.workedOn?.length ? <section><h2>Learning this week</h2><div className="artifact-status-list">{content.workedOn.map((item, index) => <article key={entryKey(item, index)}><strong>{item.area}</strong><p>{item.status}</p></article>)}</div></section> : null}
      {content.recordStatus ? <section><h2>Workspace status</h2><dl className="artifact-fact-grid">{Object.entries(content.recordStatus).map(([label, value]) => <div key={label}><dt>{humanize(label)}</dt><dd>{displayValue(value)}</dd></div>)}</dl></section> : null}
      {content.unfinished?.length ? <section><h2>Still open</h2><ul>{content.unfinished.map((item, index) => <li key={entryKey(item, index)}>{displayEntry(item, ["area", "task"])}</li>)}</ul></section> : null}
      {content.parentAttention?.length ? <section><h2>Needs your attention</h2><ol>{content.parentAttention.map((item, index) => <li key={entryKey(item, index)}>{displayEntry(item, ["area", "decision"])}</li>)}</ol></section> : null}
      {content.flexiblePlan?.length ? <section><h2>Plan for the week</h2><div className="artifact-plan-list">{content.flexiblePlan.map((item, index) => <article key={entryKey(item, index)}><header><span>{item.session}</span>{item.suggestedDuration ? <small>{item.suggestedDuration}</small> : null}</header><h3>{item.focus}</h3><p>{item.activity}</p></article>)}</div></section> : null}
      {content.planningBasis?.length ? <section><h2>Based on</h2><ul>{content.planningBasis.map((item, index) => <li key={entryKey(item, index)}>{displayEntry(item)}</li>)}</ul></section> : null}
      {content.decisionsNeeded?.length ? <section><h2>Your decisions</h2><ol>{content.decisionsNeeded.map((item, index) => <li key={entryKey(item, index)}>{displayEntry(item, ["area", "decision"])}</li>)}</ol></section> : null}
      {content.recordNotes ? <aside className="artifact-note"><strong>Record note</strong><p>{content.recordNotes}</p></aside> : null}
      {content.notes ? <aside className="artifact-note"><strong>Planning note</strong><p>{content.notes}</p></aside> : null}
      {content.sections?.map((section, sectionIndex) => (
        <section key={entryKey(section, sectionIndex)}><h2>{section.heading}</h2><p>{section.body}</p>{section.items?.length ? <ul>{section.items.map((item, index) => <li key={entryKey(item, index)}>{item}</li>)}</ul> : null}</section>
      ))}
      {content.suggested_actions?.length ? <section><h2>Suggested next moves</h2><ol>{content.suggested_actions.map((item, index) => <li key={entryKey(item, index)}>{item}</li>)}</ol></section> : null}
      {artifact.type === "practice" && practiceSpec ? <PracticePreview value={content.practice} document /> : null}
      {artifact.rationale ? <footer><strong>Why Klio suggested this</strong><p>{artifact.rationale}</p></footer> : null}
      {artifact.type === "practice" && artifact.status === "approved" && practiceSpec ? (
        <form action={launchPracticeAction} className="practice-launch"><input type="hidden" name="artifactId" value={artifact.id} /><button className="primary-button">Start practice</button></form>
      ) : null}
      {artifact.type === "practice" && artifact.status === "approved" && !practiceSpec ? <aside className="uncertainty"><AlertCircle size={17} /><div><strong>This practice needs rebuilding</strong><p>Klio saved the activity as a worksheet instead of an interactive practice. Create it again to launch it here.</p></div></aside> : null}
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

function humanize(value: string) { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }

function entryKey(value: unknown, index: number) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return `${index}-${serialized?.slice(0, 120) ?? "item"}`;
}

function displayEntry(entry: ArtifactListEntry, preferredKeys: string[] = []) {
  if (typeof entry === "string") return entry;
  const orderedKeys = [...preferredKeys, ...Object.keys(entry).filter((key) => !preferredKeys.includes(key))];
  const parts = orderedKeys.map((key) => displayValue(entry[key])).filter(Boolean);
  return parts.join(" — ") || "Details unavailable";
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (typeof value === "object") return Object.values(value).map(displayValue).filter(Boolean).join(" — ");
  return "";
}
