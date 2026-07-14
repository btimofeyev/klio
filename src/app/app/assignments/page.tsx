import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";

export default async function AssignmentsPage() {
  const workspace = await getOperationsWorkspace();
  if (!workspace) return null;
  return <OperationsWorkspace surface="assignments" workspace={workspace} />;
}
