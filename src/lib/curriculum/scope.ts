import { z } from "zod";

export const DEFAULT_TARGET_LESSON_COUNT = 100;
export const MAX_TARGET_LESSON_COUNT = 500;

export const curriculumItemKindSchema = z.enum(["lesson", "assessment", "review", "project", "activity"]);
export type CurriculumItemKind = z.infer<typeof curriculumItemKindSchema>;

export const curriculumPathSchema = z.array(z.string().trim().min(1).max(100)).max(8);

export type ScopeSkeletonRow = {
  title: string;
  sequenceNumber: number;
  curriculumItemKind: CurriculumItemKind;
  curriculumItemState: "placeholder";
  curriculumPath: string[];
};

export type ScopeAssignmentState = {
  id: string;
  sequenceNumber: number | null;
  title: string;
  status: string;
  scheduledDate: string | null;
  curriculumItemState: string | null;
  materialCount?: number;
  submissionCount?: number;
  reviewCount?: number;
};

export type EligibleScopeItem = {
  id: string;
  curriculumUnitId: string;
  sequenceNumber: number;
  title: string;
  subject: string;
  status: string;
  scheduledDate: string | null;
  estimatedMinutes: number;
  curriculumItemKind: CurriculumItemKind;
  curriculumPath: string[];
  curriculumItemState: "placeholder" | "enriched";
};

export function genericScopeTitle(courseTitle: string, sequenceLabel: string, sequenceNumber: number) {
  const course = z.string().trim().min(1).max(200).parse(courseTitle);
  const label = z.string().trim().min(1).max(40).parse(sequenceLabel);
  const sequence = z.number().int().min(1).max(10000).parse(sequenceNumber);
  return `${course} · ${label} ${sequence}`;
}

export function buildGenericScope(input: { courseTitle: string; sequenceLabel?: string; targetLessonCount?: number }) {
  const target = z.number().int().min(1).max(MAX_TARGET_LESSON_COUNT).parse(input.targetLessonCount ?? DEFAULT_TARGET_LESSON_COUNT);
  const sequenceLabel = input.sequenceLabel ?? "Lesson";
  return Array.from({ length: target }, (_, index): ScopeSkeletonRow => ({
    title: genericScopeTitle(input.courseTitle, sequenceLabel, index + 1),
    sequenceNumber: index + 1,
    curriculumItemKind: "lesson",
    curriculumItemState: "placeholder",
    curriculumPath: [],
  }));
}

export function normalizeCurriculumPath(value: unknown) {
  return curriculumPathSchema.parse(value).map((label) => label.replace(/\s+/g, " "));
}

export function normalizeCurriculumItemKind(value: unknown): CurriculumItemKind {
  return curriculumItemKindSchema.parse(value);
}

export function isUntouchedPlaceholder(
  assignment: ScopeAssignmentState,
  input: { courseTitle: string; sequenceLabel: string },
) {
  return assignment.sequenceNumber !== null
    && assignment.status === "planned"
    && assignment.scheduledDate === null
    && assignment.curriculumItemState === "placeholder"
    && assignment.title === genericScopeTitle(input.courseTitle, input.sequenceLabel, assignment.sequenceNumber)
    && (assignment.materialCount ?? 0) === 0
    && (assignment.submissionCount ?? 0) === 0
    && (assignment.reviewCount ?? 0) === 0;
}

export function evaluateTargetChange(input: {
  currentTarget: number;
  nextTarget: number;
  assignments: ScopeAssignmentState[];
  courseTitle: string;
  sequenceLabel: string;
}) {
  const currentTarget = z.number().int().min(1).max(MAX_TARGET_LESSON_COUNT).parse(input.currentTarget);
  const nextTarget = z.number().int().min(1).max(MAX_TARGET_LESSON_COUNT).parse(input.nextTarget);
  if (nextTarget >= currentTarget) {
    return { allowed: true as const, appendSequenceNumbers: range(currentTarget + 1, nextTarget), removeAssignmentIds: [] as string[], reason: null };
  }
  const trailing = input.assignments
    .filter((item) => item.sequenceNumber !== null && item.sequenceNumber > nextTarget)
    .sort((a, b) => b.sequenceNumber! - a.sequenceNumber!);
  const protectedItem = trailing.find((item) => !isUntouchedPlaceholder(item, input));
  if (protectedItem) {
    return {
      allowed: false as const,
      appendSequenceNumbers: [] as number[],
      removeAssignmentIds: [] as string[],
      reason: `Lesson ${protectedItem.sequenceNumber} has schedule, source, submission, review, or progress history and cannot be removed.`,
    };
  }
  return { allowed: true as const, appendSequenceNumbers: [] as number[], removeAssignmentIds: trailing.map((item) => item.id), reason: null };
}

export function selectNextEligibleScopeItems(input: {
  items: EligibleScopeItem[];
  limitByCurriculumUnit: Map<string, number> | Record<string, number>;
  throughDate: string;
}) {
  const limits = input.limitByCurriculumUnit instanceof Map
    ? input.limitByCurriculumUnit
    : new Map(Object.entries(input.limitByCurriculumUnit));
  const groups = new Map<string, EligibleScopeItem[]>();
  for (const item of input.items) groups.set(item.curriculumUnitId, [...(groups.get(item.curriculumUnitId) ?? []), item]);
  const selected: EligibleScopeItem[] = [];
  for (const [unitId, items] of groups) {
    const limit = Math.max(0, limits.get(unitId) ?? 0);
    let count = 0;
    for (const item of items.sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.id.localeCompare(b.id))) {
      if (count >= limit) break;
      if (["completed", "skipped"].includes(item.status)) continue;
      if (item.status !== "planned") break;
      if (item.scheduledDate) {
        if (item.scheduledDate > input.throughDate) break;
        continue;
      }
      selected.push(item);
      count += 1;
    }
  }
  return selected.sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.curriculumUnitId.localeCompare(b.curriculumUnitId) || a.id.localeCompare(b.id));
}

export function classifyConfirmedMaterialChanges(input: {
  title?: string;
  kind?: CurriculumItemKind;
  instructions?: string | null;
  path?: string[];
  minutes?: number | null;
}) {
  return {
    descriptive: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.kind !== undefined ? { curriculumItemKind: input.kind } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
      ...(input.path !== undefined ? { curriculumPath: normalizeCurriculumPath(input.path) } : {}),
    },
    scheduleSensitive: input.minutes === undefined || input.minutes === null
      ? {}
      : { estimatedMinutes: z.number().int().min(5).max(480).parse(input.minutes) },
  };
}

export function assignmentAllowsDescriptiveRewrite(status: string) {
  return status === "planned";
}

function range(from: number, to: number) {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
