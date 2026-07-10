import { redirect } from "next/navigation";
import { KlioWordmark } from "@/components/klio-wordmark";
import { requireParent } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const parent = await requireParent();
  const supabase = await createClient();
  const { data } = await supabase.from("family_members").select("family_id").eq("user_id", parent.id).limit(1).maybeSingle();
  if (data) redirect("/app");

  return <main className="onboarding-shell"><KlioWordmark /><OnboardingForm /></main>;
}
