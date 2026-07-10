import { getWorkspace } from "@/lib/data/workspace";
import { GradeImport } from "@/components/grade-import";

export default async function ImportPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  return <div className="section-page"><header><p className="eyebrow">Non-destructive import</p><h1>Import grades</h1><p>Preview a CSV, map its columns, then confirm. Klio preserves the original file and creates new evidence records.</p></header><GradeImport familyId={workspace.family.id} students={workspace.students} /></div>;
}
