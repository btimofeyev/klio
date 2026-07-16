import { Check, Lightbulb } from "lucide-react";
import { normalizePracticeSpec } from "@/lib/practice/spec";
import styles from "./practice-preview.module.css";

export { styles as practicePreviewStyles };

export function PracticePreview({ value, compact = false, document = false }: { value: unknown; compact?: boolean; document?: boolean }) {
  const practice = normalizePracticeSpec(value);
  if (!practice) return <p className={styles.empty}>This practice needs to be rebuilt before it can be used.</p>;

  const activityTypes = new Set(practice.activities.map((activity) => activity.type)).size;
  return <section className={`${styles.preview} ${compact ? styles.compact : ""} ${document ? styles.document : ""}`} data-testid="practice-preview">
    <header>
      <div><span>{practice.subject}</span><strong>{humanize(practice.skill_key)}</strong></div>
      <p>{practice.activities.length} activities · {activityTypes} activity types · {practice.mastery_percent}% goal</p>
    </header>
    <p className={styles.instructions}>{practice.instructions}</p>
    <ol>
      {practice.activities.map((activity, index) => <li key={activity.id}>
        <div><span>{index + 1}</span><small>{activityLabel(activity.type)}</small></div>
        <p>{activity.prompt}</p>
        {activity.type === "multiple_choice" ? <ul>{activity.choices.map((choice) => <li key={choice}>{choice}</li>)}</ul> : null}
        {activity.type === "written_response" ? <small className={styles.responseNote}>Write a short explanation.</small> : null}
        <details>
          <summary><Lightbulb size={13} />Parent answer guide</summary>
          <p>{activity.explanation}</p>
          {activity.type === "written_response" ? <ul>{activity.success_criteria.map((criterion) => <li key={criterion}><Check size={11} />{criterion}</li>)}</ul> : null}
        </details>
      </li>)}
    </ol>
  </section>;
}

function activityLabel(type: string) {
  return ({ multiple_choice: "Choose", short_answer: "Calculate", graph_line: "Graph", written_response: "Explain" } as Record<string, string>)[type] ?? "Practice";
}

function humanize(value: string) {
  return value.replaceAll(/[._-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
