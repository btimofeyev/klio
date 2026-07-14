import { cookies } from "next/headers";
import { InboxWorkspace } from "@/components/inbox-workspace";
import { getWorkspace } from "@/lib/data/workspace";

export default async function CapturePage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const preferred = (await cookies()).get("klio-learner")?.value;
  const studentId = workspace.students.some((student) => student.id === preferred) ? preferred! : workspace.students[0]?.id;
  if (!studentId) return null;
  return <InboxWorkspace
    familyId={workspace.family.id}
    students={workspace.students}
    categories={workspace.categories}
    initialEvidence={workspace.evidence}
    initialReminders={workspace.reminders}
    initialArtifacts={workspace.artifacts}
    pendingApprovals={workspace.pendingApprovals}
    initialAgentTurn={workspace.latestAgentTurn}
    initialStudentId={studentId}
  />;
}
