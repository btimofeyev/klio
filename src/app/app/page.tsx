import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; student?: string }> }) {
  const workspace = await getOperationsWorkspace();
  if (!workspace) return null;
  const { date, student } = await searchParams;
  const selectedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const selectedStudent = workspace.students.some((learner) => learner.id === student) ? student : undefined;
  return <OperationsWorkspace surface="today" workspace={workspace} initialSelectedDate={selectedDate} initialStudentId={selectedStudent} />;
}
