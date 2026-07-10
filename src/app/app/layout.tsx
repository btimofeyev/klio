import { redirect } from "next/navigation";
import { AppNav, MobileNav } from "@/components/app-nav";
import { getWorkspace } from "@/lib/data/workspace";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspace();
  if (!workspace) redirect("/onboarding");
  return (
    <div className="app-shell">
      <AppNav familyName={workspace.family.name} pending={workspace.pendingApprovals} />
      <main className="app-main">{children}</main>
      <MobileNav pending={workspace.pendingApprovals} />
    </div>
  );
}
