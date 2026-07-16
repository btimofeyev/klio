import { redirect } from "next/navigation";
import { after } from "next/server";
import { AppNav, MobileNav } from "@/components/app-nav";
import { getWorkspace } from "@/lib/data/workspace";
import { recoverAgentJobs } from "@/lib/agent/jobs";
import { getFamilyAttention } from "@/lib/data/attention";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspace();
  if (!workspace) redirect("/onboarding");
  after(() => recoverAgentJobs(workspace.family.id));
  const attention = await getFamilyAttention(workspace.family.id);
  return (
    <div className="app-shell">
      <AppNav familyName={workspace.family.name} students={workspace.students} attentionCount={attention.total} />
      <main className="app-main">{children}</main>
      <MobileNav familyName={workspace.family.name} students={workspace.students} attentionCount={attention.total} />
    </div>
  );
}
