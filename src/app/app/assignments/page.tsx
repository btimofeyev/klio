import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";
import { z } from "zod";

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ student?: string; unit?: string }> }) {
  const { student, unit } = await searchParams;
  const workspace = await getOperationsWorkspace({
    surface: "assignments",
    studentId: z.uuid().safeParse(student).success ? student : undefined,
    curriculumUnitId: z.uuid().safeParse(unit).success ? unit : undefined,
  });
  if (!workspace) return null;
  return <OperationsWorkspace key={`${workspace.selectedStudentId ?? "all"}:${workspace.selectedCurriculumUnitId ?? "no-unit"}`} surface="assignments" workspace={workspace} initialStudentId={workspace.selectedStudentId ?? undefined} />;
}
