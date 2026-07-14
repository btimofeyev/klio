import { redirect } from "next/navigation";
import { KlioWordmark } from "@/components/klio-wordmark";
import { requireParent } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";
import { signOutAction } from "@/app/login/actions";

export default async function OnboardingPage() {
  const parent = await requireParent();
  const supabase = await createClient();
  const { data } = await supabase.from("family_members").select("family_id").eq("user_id", parent.id).limit(1).maybeSingle();
  if (data) redirect("/app");

  return <main className="onboarding-shell">
    <header className="onboarding-topbar">
      <KlioWordmark />
      <form action={signOutAction}><button type="submit">Sign out</button></form>
    </header>
    <OnboardingForm />
  </main>;
}
