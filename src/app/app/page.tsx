import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";
import { z } from "zod";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; student?: string; artifact?: string; practice?: string }> }) {
  const { date, student, artifact, practice } = await searchParams;
  const requestedDate = z.iso.date().safeParse(date).success ? date : undefined;
  const requestedStudent = z.uuid().safeParse(student).success ? student : undefined;
  const workspace = await getOperationsWorkspace({ surface: "today", anchorDate: requestedDate, studentId: requestedStudent });
  if (!workspace) return null;
  const selectedArtifact = workspace.artifacts.some((item) => item.id === artifact) ? artifact : undefined;
  const selectedPractice = workspace.practiceSessions.some((item) => item.id === practice && ["ready", "in_progress"].includes(item.status)) ? practice : undefined;
  return <OperationsWorkspace key={`${workspace.selectedDate}:${workspace.selectedStudentId ?? "all"}:${selectedPractice ?? selectedArtifact ?? "today"}`} surface="today" workspace={workspace} initialSelectedDate={workspace.selectedDate} initialStudentId={workspace.selectedStudentId ?? undefined} initialArtifactId={selectedArtifact} initialPracticeSessionId={selectedPractice} />;
}
