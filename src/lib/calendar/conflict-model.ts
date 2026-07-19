import { z } from "zod";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const conflictInputSchema = z.object({
  studentId: z.uuid().nullable(),
  conflictDate: z.iso.date(),
  allDay: z.boolean(),
  startsAt: z.string().regex(hhmm).nullable(),
  endsAt: z.string().regex(hhmm).nullable(),
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.allDay && (value.startsAt !== null || value.endsAt !== null)) {
    context.addIssue({ code: "custom", message: "All-day conflicts cannot include times.", path: ["startsAt"] });
  }
  if (!value.allDay && (!value.startsAt || !value.endsAt || value.endsAt <= value.startsAt)) {
    context.addIssue({ code: "custom", message: "Choose an end time later than the start time.", path: ["endsAt"] });
  }
});

export type ConflictInput = z.infer<typeof conflictInputSchema>;

export function conflictDTO(row: {
  id: string; student_id: string | null; conflict_date: string; all_day: boolean; starts_at: string | null; ends_at: string | null;
  title: string; note: string | null; created_at: string; updated_at: string;
}) {
  return { id: row.id, studentId: row.student_id, conflictDate: row.conflict_date, allDay: row.all_day, startsAt: trimDatabaseTime(row.starts_at), endsAt: trimDatabaseTime(row.ends_at), title: row.title, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function trimDatabaseTime(value: string | null) { return value ? value.slice(0, 5) : null; }
