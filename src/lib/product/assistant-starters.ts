export const supportedAssistantIntents = [
  "general",
  "organize",
  "understand",
  "update_records",
  "next_step",
  "weekly_plan",
  "lesson",
  "summary",
  "practice",
  "portfolio",
] as const;

export type AssistantIntent = (typeof supportedAssistantIntents)[number];

export const assistantStarterGroupOrder = ["run_day", "teach", "review", "plan_document"] as const;
export type AssistantStarterGroupId = (typeof assistantStarterGroupOrder)[number];

export const assistantStarterIds = [
  "family_briefing",
  "organize_today",
  "teach_next_lesson",
  "practice_from_mistakes",
  "review_recent_learning",
  "plan_week",
  "portfolio_update",
] as const;
export type AssistantStarterId = (typeof assistantStarterIds)[number];

export type AssistantStarterContext = {
  learnerName?: string | null;
  assignmentTitle?: string | null;
  subject?: string | null;
  workspaceDate?: string | null;
};

export type AssistantStarterDefinition = {
  id: AssistantStarterId;
  groupId: AssistantStarterGroupId;
  label: string;
  detail: string;
  requiresLearner: boolean;
  intent: AssistantIntent;
};

export type ResolvedAssistantStarter = AssistantStarterDefinition & {
  prompt: string;
  disabled: boolean;
  disabledReason: string | null;
};

export const assistantStarterGroups: ReadonlyArray<{ id: AssistantStarterGroupId; label: string }> = [
  { id: "run_day", label: "Run the day" },
  { id: "teach", label: "Teach" },
  { id: "review", label: "Review" },
  { id: "plan_document", label: "Plan and document" },
];

export const assistantStarterCatalog: ReadonlyArray<AssistantStarterDefinition> = [
  {
    id: "family_briefing",
    groupId: "run_day",
    label: "Brief me on the family",
    detail: "See what is planned, overdue, waiting for review, and most useful to handle first.",
    requiresLearner: false,
    intent: "summary",
  },
  {
    id: "organize_today",
    groupId: "run_day",
    label: "Organize today",
    detail: "Put one learner’s lessons into a realistic, non-overlapping teaching order.",
    requiresLearner: true,
    intent: "weekly_plan",
  },
  {
    id: "teach_next_lesson",
    groupId: "teach",
    label: "Help me teach the next lesson",
    detail: "Get a concise explanation, teaching sequence, emphasis, and understanding check.",
    requiresLearner: true,
    intent: "lesson",
  },
  {
    id: "practice_from_mistakes",
    groupId: "teach",
    label: "Build practice from approved mistakes",
    detail: "Create focused practice only when reviewed evidence supports it.",
    requiresLearner: true,
    intent: "practice",
  },
  {
    id: "review_recent_learning",
    groupId: "review",
    label: "Review recent learning",
    detail: "Separate what approved records show from what is still uncertain.",
    requiresLearner: false,
    intent: "summary",
  },
  {
    id: "plan_week",
    groupId: "plan_document",
    label: "Plan the rest of the week",
    detail: "Prepare a capacity-aware plan that preserves commitments and flags decisions.",
    requiresLearner: false,
    intent: "weekly_plan",
  },
  {
    id: "portfolio_update",
    groupId: "plan_document",
    label: "Prepare a portfolio update",
    detail: "Draft a parent-reviewable update from the strongest approved work this term.",
    requiresLearner: true,
    intent: "portfolio",
  },
];

const starterById = new Map(assistantStarterCatalog.map((starter) => [starter.id, starter]));

export function resolveAssistantStarter(id: AssistantStarterId, context: AssistantStarterContext): ResolvedAssistantStarter {
  const starter = starterById.get(id);
  if (!starter) throw new Error(`Unknown assistant starter: ${id}`);
  const disabled = starter.requiresLearner && !context.learnerName;
  return {
    ...starter,
    prompt: starterPrompt(id, context),
    disabled,
    disabledReason: disabled ? "Choose a learner" : null,
  };
}

export function resolveAssistantStarterCatalog(context: AssistantStarterContext) {
  return assistantStarterIds.map((id) => resolveAssistantStarter(id, context));
}

export function rankAssistantStarterIds(context: AssistantStarterContext): AssistantStarterId[] {
  if (context.assignmentTitle && context.learnerName) {
    return ["teach_next_lesson", "practice_from_mistakes", "review_recent_learning"];
  }
  if (context.learnerName) {
    return ["organize_today", "teach_next_lesson", "review_recent_learning"];
  }
  return ["family_briefing", "plan_week", "review_recent_learning"];
}

export function resolveTopAssistantStarters(context: AssistantStarterContext) {
  return rankAssistantStarterIds(context).map((id) => resolveAssistantStarter(id, context));
}

export function assistantStarterShortLabel(id: AssistantStarterId, context: AssistantStarterContext) {
  if (id === "teach_next_lesson") return context.assignmentTitle ? "Help teach this lesson" : "Help teach the next lesson";
  return starterById.get(id)?.label ?? id;
}

function starterPrompt(id: AssistantStarterId, context: AssistantStarterContext) {
  const learner = context.learnerName?.trim();
  const assignment = assignmentLabel(context);
  switch (id) {
    case "family_briefing":
      return learner
        ? `Give me a briefing for ${learner} today. Tell me what is planned, overdue, waiting for review, and what I should handle first. Do not change anything.`
        : "Give me a family briefing for today. Tell me what each learner has planned, what is overdue, what needs review, and what I should handle first. Do not change anything.";
    case "organize_today": {
      if (!learner) return "Choose a learner to organize today.";
      const date = readableWorkspaceDate(context.workspaceDate);
      return `Organize ${learner}’s lessons for today${date ? ` (${date})` : ""} into a realistic teaching order with non-overlapping times. Preserve curriculum order, lesson lengths, and the other learners’ schedules.`;
    }
    case "teach_next_lesson":
      if (!learner) return "Choose a learner to get help teaching the next lesson.";
      return assignment
        ? `Help me teach ${learner}’s ‘${assignment}’ lesson. Give me a short explanation, a practical teaching sequence, what to emphasize, and one quick understanding check. Do not create extra work unless I ask.`
        : `Help me teach ${learner}’s next scheduled${context.subject ? ` ${context.subject}` : ""} lesson. Give me a short explanation, a practical teaching sequence, what to emphasize, and one quick understanding check. Do not create extra work unless I ask.`;
    case "practice_from_mistakes": {
      if (!learner) return "Choose a learner to build focused practice.";
      const assignmentContext = assignment ? ` related to ${learner}’s ‘${assignment}’ lesson` : "";
      return `Build focused practice for ${learner} from approved mistakes in their recent work${assignmentContext}. Use only reviewed evidence, do not introduce unrelated skills, and skip the practice if there is not enough evidence. Do not invent a weakness or put correct answers in learner instructions or hints.`;
    }
    case "review_recent_learning":
      return learner
        ? `Review ${learner}’s recent approved learning records. Separate what the evidence clearly shows from what remains uncertain, and suggest no more than three useful next steps. Do not infer mastery from unreviewed work or change anything unless I ask in a follow-up.`
        : "Review the family’s recent approved learning records. Separate what the evidence clearly shows from what remains uncertain, and suggest no more than three useful next steps. Do not infer mastery from unreviewed work or change anything unless I ask in a follow-up.";
    case "plan_week":
      return learner
        ? `Plan the rest of this week for ${learner} using current assignments, unfinished work, learner capacity, curriculum sequence, reminders, and approved results. Preserve existing commitments and flag anything that needs my decision.`
        : "Plan the rest of this week for the family using current assignments, unfinished work, learner capacity, curriculum sequence, reminders, and approved results. Preserve existing commitments and flag anything that needs my decision.";
    case "portfolio_update":
      return learner
        ? `Prepare a parent-reviewable portfolio update for ${learner} from approved work in the current term. Use the strongest original evidence, distinguish completed work from interpretation, and do not include unreviewed conclusions. Leave it for my review; do not approve or publish it.`
        : "Choose a learner to prepare a portfolio update.";
  }
}

function assignmentLabel(context: AssistantStarterContext) {
  const title = context.assignmentTitle?.trim();
  const subject = context.subject?.trim();
  if (!title) return null;
  if (!subject || title.toLocaleLowerCase("en-US").includes(subject.toLocaleLowerCase("en-US"))) return title;
  return `${subject} · ${title}`;
}

function readableWorkspaceDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
