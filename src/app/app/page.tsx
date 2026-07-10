import { InboxWorkspace } from "@/components/inbox-workspace";
import { getWorkspace } from "@/lib/data/workspace";

export default async function InboxPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  return (
    <InboxWorkspace
      familyId={workspace.family.id}
      familyName={workspace.family.name}
      students={workspace.students}
      initialEvidence={workspace.evidence}
      initialArtifacts={workspace.artifacts}
    />
  );
}
