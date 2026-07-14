import { redirect } from "next/navigation";
import { after } from "next/server";
import { AppNav, MobileNav } from "@/components/app-nav";
import { getWorkspace } from "@/lib/data/workspace";
import { recoverAgentJobs } from "@/lib/agent/jobs";
import { createClient } from "@/lib/supabase/server";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspace();
  if (!workspace) redirect("/onboarding");
  after(() => recoverAgentJobs(workspace.family.id));
  const supabase = await createClient();
  const reviewCount = await supabase.from("assignment_reviews").select("id", { count: "exact", head: true }).eq("family_id", workspace.family.id).eq("status", "draft");
  const attentionCount = (reviewCount.count ?? 0) + workspace.pendingApprovals;
  return (
    <div className="app-shell">
      <AppNav familyName={workspace.family.name} students={workspace.students} attentionCount={attentionCount} />
      <main className="app-main">{children}</main>
      <MobileNav familyName={workspace.family.name} students={workspace.students} attentionCount={attentionCount} />
    </div>
  );
}
