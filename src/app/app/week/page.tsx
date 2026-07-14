import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";

export default async function ThisWeekPage() {
  const workspace = await getOperationsWorkspace();
  if (!workspace) return null;
  return <OperationsWorkspace surface="week" workspace={workspace} />;
}
