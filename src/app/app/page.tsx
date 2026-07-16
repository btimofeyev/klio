import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; student?: string; artifact?: string; practice?: string }> }) {
  const workspace = await getOperationsWorkspace();
  if (!workspace) return null;
  const { date, student, artifact, practice } = await searchParams;
  const selectedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const selectedStudent = workspace.students.some((learner) => learner.id === student) ? student : undefined;
  const selectedArtifact = workspace.artifacts.some((item) => item.id === artifact) ? artifact : undefined;
  const selectedPractice = workspace.practiceSessions.some((item) => item.id === practice && ["ready", "in_progress"].includes(item.status)) ? practice : undefined;
  return <OperationsWorkspace key={selectedPractice ?? selectedArtifact ?? "today"} surface="today" workspace={workspace} initialSelectedDate={selectedDate} initialStudentId={selectedStudent} initialArtifactId={selectedArtifact} initialPracticeSessionId={selectedPractice} />;
}
