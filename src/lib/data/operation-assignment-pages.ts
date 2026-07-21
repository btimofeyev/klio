import { z } from "zod";
import { monthGrid } from "@/lib/calendar/month";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";

export const SCHEDULED_ASSIGNMENT_PAGE_SIZE = 100;
export const CURRICULUM_ASSIGNMENT_PAGE_SIZE = 50;
export const MAX_ASSIGNMENT_PAGE_SIZE = 100;

export const ASSIGNMENT_SELECT_COLUMNS = [
  "id",
  "family_id",
  "student_id",
  "curriculum_unit_id",
  "title",
  "subject",
  "instructions",
  "sequence_number",
  "status",
  "scheduled_date",
  "due_at",
  "scheduled_time",
  "estimated_minutes",
  "completed_at",
  "submitted_at",
  "source_kind",
  "attention_mode",
  "parent_attention_minutes",
  "curriculum_item_kind",
  "curriculum_item_state",
  "curriculum_path",
  "curriculum_scope_suggestion_id",
].join(",");

const calendarDateSchema = z.iso.date();
const scheduledTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);

const scheduledCursorSchema = z.object({
  v: z.literal(1),
  date: calendarDateSchema,
  time: scheduledTimeSchema.nullable(),
  id: postgresUuidSchema,
}).strict();

const curriculumCursorSchema = z.object({
  v: z.literal(1),
  sequence: z.number().int().nullable(),
  id: postgresUuidSchema,
}).strict();

export type ScheduledAssignmentCursor = z.infer<typeof scheduledCursorSchema>;
export type CurriculumAssignmentCursor = z.infer<typeof curriculumCursorSchema>;
export type OperationsCalendarSurface = "today" | "week" | "month";

export function operationsDateRange(surface: OperationsCalendarSurface, anchorDate: string) {
  const parsed = calendarDateSchema.parse(anchorDate);
  if (surface === "today") return { from: parsed, to: parsed };
  if (surface === "month") {
    const days = monthGrid(parsed);
    return { from: days[0].date, to: days.at(-1)!.date };
  }

  const anchor = new Date(`${parsed}T00:00:00.000Z`);
  const mondayOffset = (anchor.getUTCDay() + 6) % 7;
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: formatUtcDate(monday), to: formatUtcDate(sunday) };
}

export function encodeScheduledAssignmentCursor(cursor: ScheduledAssignmentCursor) {
  return encodeCursor(scheduledCursorSchema.parse(cursor));
}

export function decodeScheduledAssignmentCursor(cursor: string) {
  return scheduledCursorSchema.parse(decodeCursor(cursor));
}

export function encodeCurriculumAssignmentCursor(cursor: CurriculumAssignmentCursor) {
  return encodeCursor(curriculumCursorSchema.parse(cursor));
}

export function decodeCurriculumAssignmentCursor(cursor: string) {
  return curriculumCursorSchema.parse(decodeCursor(cursor));
}

export function pageWithLookahead<T>(
  rows: readonly T[],
  limit: number,
  cursorFor: (row: T) => string,
) {
  const safeLimit = Math.min(MAX_ASSIGNMENT_PAGE_SIZE, Math.max(1, Math.trunc(limit)));
  const items = rows.slice(0, safeLimit);
  return {
    items,
    nextCursor: rows.length > safeLimit && items.length ? cursorFor(items.at(-1)!) : null,
  };
}

export function dedupeAssignmentsById<T extends { id: string }>(rows: readonly T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function encodeCursor(value: object) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: string) {
  if (!cursor || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error("Invalid assignment cursor.");
  }
  let json: string;
  try {
    json = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid assignment cursor.");
  }
  if (!json || Buffer.byteLength(json, "utf8") > 768) throw new Error("Invalid assignment cursor.");
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error("Invalid assignment cursor.");
  }
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
