export function agentEventLabel(kind: string, payload: unknown) {
  const value = payload as { tool?: string } | null;
  if (kind === "turn.queued") return "Added to Klio’s work queue";
  if (kind === "turn.started") return "Read the current family workspace";
  if (kind === "tool.requested") return workspaceToolLabel(value?.tool, false);
  if (kind === "tool.completed") return workspaceToolLabel(value?.tool, true);
  if (kind === "clarification.requested") return "One detail is needed";
  if (kind === "turn.completed") return "Finished the requested work";
  if (kind === "turn.failed") return "Couldn’t finish this job";
  return "Prepared the result";
}

function workspaceToolLabel(tool: string | undefined, completed: boolean) {
  const labels: Record<string, string> = {
    file_capture: "Filed the learning evidence", create_reminder: "Added the reminder", ask_parent: "Prepared one question",
    update_subject_summary_draft: "Drafted the subject summary", build_dashboard: "Built the learning dashboard",
    draft_weekly_plan: "Drafted the weekly plan", create_lesson: "Created the lesson",
    create_practice_activity: "Created the practice activity", build_portfolio: "Built the portfolio",
    update_records_draft: "Prepared the family records",
  };
  const label = labels[tool ?? ""] ?? "Used the family workspace";
  return completed ? label : label.replace(/^(Filed|Added|Prepared|Drafted|Built|Created)/, "Working on");
}
