import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";

export default async function AdjustmentsPage() {
  const workspace = await getOperationsWorkspace({ surface: "adjustments" });
  if (!workspace) return null;
  return <OperationsWorkspace surface="adjustments" workspace={workspace} />;
}
