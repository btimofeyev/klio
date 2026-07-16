export const autonomyActions = [
  "organize_submitted_work",
  "record_explicit_completion",
  "create_ordinary_reminders",
  "build_supplemental_practice",
  "schedule_supplemental_practice",
  "move_unfinished_work",
  "maintain_curriculum_sequence",
  "remove_unnecessary_practice",
  "draft_feedback",
  "record_explicit_parent_scores",
  "record_inferred_grades",
  "major_schedule_changes",
  "change_curriculum_direction",
  "delete_source_records",
] as const;

export type AutonomyAction = (typeof autonomyActions)[number];
export type AutonomyLevel = "automatic" | "automatic_with_undo" | "confirm" | "ask" | "never";
export type AutonomyPreset = "helpful" | "proactive" | "ask_first" | "custom";
export type AutonomyPolicy = Record<AutonomyAction, AutonomyLevel>;

export type AutonomyActionDefinition = {
  action: AutonomyAction;
  label: string;
  handler: string;
  risk: "low" | "moderate" | "high" | "forbidden";
  undo: boolean;
  exposed: boolean;
  allowedLevels: readonly AutonomyLevel[];
};

const ordinary = ["automatic", "automatic_with_undo", "confirm", "ask", "never"] as const;
const draftOnly = ["automatic", "confirm", "ask", "never"] as const;
const parentBoundary = ["confirm", "ask", "never"] as const;

export const autonomyActionRegistry: Record<AutonomyAction, AutonomyActionDefinition> = {
  organize_submitted_work: definition("organize_submitted_work", "Organize submitted work", "file_capture", "low", false, draftOnly),
  record_explicit_completion: definition("record_explicit_completion", "Record a completion I report", "record_explicit_completion", "low", false, draftOnly),
  create_ordinary_reminders: definition("create_ordinary_reminders", "Create ordinary reminders", "create_reminder", "low", false, draftOnly),
  build_supplemental_practice: definition("build_supplemental_practice", "Build focused practice from reviewed work", "create_supplemental_practice", "low", false, draftOnly),
  schedule_supplemental_practice: definition("schedule_supplemental_practice", "Schedule focused practice within capacity", "apply_klio_adjustment", "moderate", true, ordinary),
  move_unfinished_work: definition("move_unfinished_work", "Move unfinished work within the week", "move_unfinished_work", "moderate", true, ordinary),
  maintain_curriculum_sequence: definition("maintain_curriculum_sequence", "Keep curriculum lessons in order", "move_unfinished_work", "low", true, ordinary),
  remove_unnecessary_practice: definition("remove_unnecessary_practice", "Remove extra practice after finalized improvement", "undo_klio_adjustment", "moderate", true, ordinary),
  draft_feedback: definition("draft_feedback", "Draft feedback for submitted work", "draft_assignment_review", "low", false, draftOnly),
  record_explicit_parent_scores: definition("record_explicit_parent_scores", "Record scores I explicitly provide", "record_explicit_parent_score", "low", false, draftOnly),
  record_inferred_grades: definition("record_inferred_grades", "Record a Klio-inferred grade", "planning_proposal:record_inferred_grade", "high", false, parentBoundary),
  major_schedule_changes: definition("major_schedule_changes", "Make major schedule changes", "planning_proposal:prepare_term", "high", false, parentBoundary),
  change_curriculum_direction: definition("change_curriculum_direction", "Change curriculum direction", "planning_proposal:create_curriculum", "high", false, parentBoundary),
  delete_source_records: { action: "delete_source_records", label: "Delete source records", handler: "unavailable", risk: "forbidden", undo: false, exposed: false, allowedLevels: ["never"] },
};

export const exposedAutonomyActions = autonomyActions
  .map((action) => autonomyActionRegistry[action])
  .filter((definition) => definition.exposed);

export const recommendedPolicy: AutonomyPolicy = {
  organize_submitted_work: "automatic",
  record_explicit_completion: "automatic",
  create_ordinary_reminders: "automatic",
  build_supplemental_practice: "automatic",
  schedule_supplemental_practice: "automatic_with_undo",
  move_unfinished_work: "automatic_with_undo",
  maintain_curriculum_sequence: "automatic",
  remove_unnecessary_practice: "automatic_with_undo",
  draft_feedback: "automatic",
  record_explicit_parent_scores: "automatic",
  record_inferred_grades: "confirm",
  major_schedule_changes: "confirm",
  change_curriculum_direction: "ask",
  delete_source_records: "never",
};

const helpfulPolicy: AutonomyPolicy = {
  ...recommendedPolicy,
  schedule_supplemental_practice: "confirm",
  move_unfinished_work: "confirm",
  remove_unnecessary_practice: "confirm",
};

const askFirstPolicy: AutonomyPolicy = Object.fromEntries(
  autonomyActions.map((action) => [action, action === "delete_source_records" ? "never" : "confirm"]),
) as AutonomyPolicy;
askFirstPolicy.change_curriculum_direction = "ask";

export function policyForPreset(preset: AutonomyPreset, custom?: Partial<AutonomyPolicy> | null): AutonomyPolicy {
  const base = preset === "helpful" ? helpfulPolicy : preset === "ask_first" ? askFirstPolicy : recommendedPolicy;
  if (preset !== "custom") return { ...base };
  return { ...recommendedPolicy, ...sanitizePolicy(custom) };
}

export function sanitizePolicy(value: unknown): Partial<AutonomyPolicy> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set<AutonomyLevel>(["automatic", "automatic_with_undo", "confirm", "ask", "never"]);
  return Object.fromEntries(autonomyActions.flatMap((action) => {
    const level = (value as Record<string, unknown>)[action];
    if (typeof level !== "string" || !allowed.has(level as AutonomyLevel)) return [];
    return [[action, enforceAllowedLevel(action, level as AutonomyLevel)]];
  })) as Partial<AutonomyPolicy>;
}

export function policyDecision(policy: AutonomyPolicy, action: AutonomyAction) {
  const level = enforceAllowedLevel(action, policy[action]);
  return {
    action,
    level,
    appliesAutomatically: level === "automatic" || level === "automatic_with_undo",
    undoRequired: level === "automatic_with_undo",
    parentConfirmationRequired: level === "confirm",
    interaction: level === "ask" ? "clarification" as const : level === "confirm" ? "proposal" as const : "none" as const,
    denied: level === "never",
    handler: autonomyActionRegistry[action].handler,
  };
}

function definition(
  action: AutonomyAction,
  label: string,
  handler: string,
  risk: AutonomyActionDefinition["risk"],
  undo: boolean,
  allowedLevels: readonly AutonomyLevel[],
): AutonomyActionDefinition {
  return { action, label, handler, risk, undo, exposed: true, allowedLevels };
}

function enforceAllowedLevel(action: AutonomyAction, level: AutonomyLevel): AutonomyLevel {
  const allowed = autonomyActionRegistry[action].allowedLevels;
  if (allowed.includes(level)) return level;
  if (allowed.includes("confirm")) return "confirm";
  if (allowed.includes("ask")) return "ask";
  return "never";
}
