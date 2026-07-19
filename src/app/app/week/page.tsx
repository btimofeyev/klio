import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";
import { z } from "zod";

export default async function ThisWeekPage({ searchParams }: { searchParams: Promise<{ date?: string; student?: string; view?: string }> }) {
  const { date, student, view } = await searchParams;
  const requestedDate = z.iso.date().safeParse(date).success ? date : undefined;
  const requestedStudent = z.uuid().safeParse(student).success ? student : undefined;
  const calendarMode = view === "month" ? "month" : "week";
  const workspace = await getOperationsWorkspace({ surface: "week", anchorDate: requestedDate, studentId: requestedStudent, calendarMode });
  if (!workspace) return null;
  return <OperationsWorkspace surface="week" workspace={workspace} initialSelectedDate={workspace.selectedDate} initialStudentId={workspace.selectedStudentId ?? undefined} initialCalendarMode={workspace.calendarMode ?? "week"} />;
}
