import { z } from "zod";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";
import { workspaceToolNames } from "./contracts";
import { workspaceToolLabel } from "./presentation";

export const publicResultKindSchema = z.enum([
  "completed", "draft_ready", "proposal", "clarification", "undoable", "needs_detail", "no_op", "partial",
]);

const targetTypeSchema = z.enum(["artifact", "assignment_review", "adjustment", "planning_proposal", "evidence", "goal", "curriculum", "week", "activity"]);
const actionSchema = z.object({
  verb: z.enum(["open", "approve", "reject", "edit", "undo", "answer"]),
  label: z.string().trim().min(1).max(80),
  targetType: targetTypeSchema,
  targetId: postgresUuidSchema.nullable(),
  href: z.string().startsWith("/app").max(300),
}).strict();

export const publicResultSchema = z.object({
  schemaVersion: z.literal(1),
  kind: publicResultKindSchema,
  message: z.string().trim().min(1).max(1000),
  understood: z.array(z.string().trim().min(1).max(300)).max(5),
  used: z.array(z.string().trim().min(1).max(300)).max(8),
  changed: z.array(z.string().trim().min(1).max(300)).max(8),
  remaining: z.array(z.string().trim().min(1).max(300)).max(5),
  actions: z.array(actionSchema).max(8),
}).strict();

export type PublicResult = z.infer<typeof publicResultSchema>;

export const modelTerminalSchema = z.object({
  kind: publicResultKindSchema,
  message: z.string().trim().min(1).max(1000),
  understood: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
  used: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  changed: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  remaining: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
});

export function normalizePublicResult(value: unknown): PublicResult {
  const parsed = publicResultSchema.safeParse(value);
  if (parsed.success) return {
    ...parsed.data,
    understood: parsed.data.understood.map(parentSafePhrase),
    used: parsed.data.used.map(parentSafePhrase),
    changed: parsed.data.changed.map(parentSafePhrase),
    remaining: parsed.data.remaining.map(parentSafePhrase),
  };
  const legacy = z.object({ message: z.string().trim().min(1).max(1000) }).passthrough().safeParse(value);
  return {
    schemaVersion: 1,
    kind: "completed",
    message: legacy.success ? legacy.data.message : "Klio finished this handoff.",
    understood: [], used: [], changed: [], remaining: [], actions: [],
  };
}

export function buildHostPublicResult(input: {
  terminal: z.infer<typeof modelTerminalSchema>;
  toolResults: unknown[];
  waitingForClarification: boolean;
}): PublicResult {
  const actions = input.toolResults.flatMap(actionFromToolResult).slice(0, 8);
  const kind = input.waitingForClarification ? "clarification" : inferKind(input.terminal.kind, input.toolResults);
  return publicResultSchema.parse({
    schemaVersion: 1,
    kind,
    message: input.terminal.message,
    understood: input.terminal.understood.map(parentSafePhrase),
    used: input.terminal.used.map(parentSafePhrase),
    changed: input.terminal.changed.map(parentSafePhrase),
    remaining: input.terminal.remaining.map(parentSafePhrase),
    actions,
  });
}

function parentSafePhrase(value: string) {
  const tool = workspaceToolNames.find((name) => value.trim() === name);
  if (tool) return workspaceToolLabel(tool, true);
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function inferKind(modelKind: z.infer<typeof publicResultKindSchema>, results: unknown[]) {
  if (results.some((result) => field(result, "outcome") === "draft" || field(result, "outcome") === "draft_ready")) return "draft_ready" as const;
  if (results.some((result) => field(result, "outcome") === "review_required")) return "proposal" as const;
  if (results.some((result) => Boolean(field(result, "undoAvailable")))) return "undoable" as const;
  return modelKind;
}

function actionFromToolResult(value: unknown): PublicResult["actions"] {
  const actions: PublicResult["actions"] = [];
  const artifactId = uuidField(value, "artifactId");
  const artifactType = field(value, "artifactType");
  const reviewId = uuidField(value, "reviewId");
  const proposalId = uuidField(value, "proposalId");
  const proposalKind = field(value, "proposalKind");
  const evidenceId = uuidField(value, "evidenceId");
  const questionThreadId = uuidField(value, "questionThreadId");
  const assignmentId = uuidField(value, "assignmentId");
  if (artifactId) actions.push(artifactType === "practice"
    ? { ...action("open", "Open practice", "artifact", artifactId), href: `/app?artifact=${encodeURIComponent(artifactId)}` }
    : action("open", "Open created work", "artifact", artifactId));
  if (reviewId) actions.push(action("open", "Review grade", "assignment_review", reviewId));
  if (proposalId) actions.push(field(value, "undoAvailable") === true
    ? action("undo", "Undo change", "adjustment", proposalId)
    : action("open", "Review proposal", typeof proposalKind === "string" ? "planning_proposal" : "adjustment", proposalId));
  if (evidenceId) actions.push(action("open", "Open source", "evidence", evidenceId));
  if (questionThreadId) actions.push(action("answer", "Answer question", "activity", questionThreadId));
  if (assignmentId) actions.push(action("open", "Open assignment", "activity", assignmentId));
  const presentedTargetType = field(value, "targetType");
  const presentedTargetId = uuidField(value, "targetId");
  if (presentedTargetId && typeof presentedTargetType === "string" && targetTypeSchema.safeParse(presentedTargetType).success) {
    actions.push(action("open", "Open details", presentedTargetType as PublicResult["actions"][number]["targetType"], presentedTargetId));
  }
  return actions;
}

function action(verb: PublicResult["actions"][number]["verb"], label: string, targetType: PublicResult["actions"][number]["targetType"], targetId: string) {
  return { verb, label, targetType, targetId, href: destination(targetType, targetId) };
}

function destination(targetType: PublicResult["actions"][number]["targetType"], targetId: string) {
  const route = {
    artifact: "/app/activity?artifact=", assignment_review: "/app/review?review=", adjustment: "/app/adjustments?proposal=", planning_proposal: "/app/adjustments?planning=",
    evidence: "/app/records?evidence=", goal: "/app/settings?goal=", curriculum: "/app/calendar?curriculum=",
    week: "/app/calendar?week=", activity: "/app/activity?record=",
  }[targetType];
  return `${route}${encodeURIComponent(targetId)}`;
}

function uuidField(value: unknown, key: string) {
  const candidate = field(value, key);
  return typeof candidate === "string" && postgresUuidSchema.safeParse(candidate).success ? candidate : null;
}

function field(value: unknown, key: string) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}
