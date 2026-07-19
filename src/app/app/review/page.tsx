import { OperationsWorkspace } from "@/components/operations-workspace";
import { getOperationsWorkspace } from "@/lib/data/operations";

export default async function ReviewGradesPage() {
  const workspace = await getOperationsWorkspace({ surface: "review" });
  if (!workspace) return null;
  return <OperationsWorkspace surface="review" workspace={workspace} />;
}
