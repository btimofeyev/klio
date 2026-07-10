import { CreditCard, UserPlus } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { addStudentAction } from "../actions";

export default async function SettingsPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data: subscription } = await supabase.from("subscriptions").select("status, current_period_end").eq("family_id", workspace.family.id).maybeSingle();
  return (
    <div className="section-page settings-page">
      <header><p className="eyebrow">Workspace</p><h1>Settings</h1><p>Manage learners, privacy, and billing for {workspace.family.name}.</p></header>
      <section><h2><UserPlus size={17} /> Add a learner</h2>
        <form action={addStudentAction} className="settings-form"><input type="hidden" name="familyId" value={workspace.family.id} />
          <div className="field"><label htmlFor="displayName">First name</label><input id="displayName" name="displayName" required /></div>
          <div className="field"><label htmlFor="gradeBand">Learning stage</label><select id="gradeBand" name="gradeBand" defaultValue="k-2"><option value="pre-k">Pre-K</option><option value="k-2">K–2</option><option value="3-5">3–5</option><option value="6-8">6–8</option><option value="9-12">9–12</option><option value="other">Other</option></select></div>
          <div className="field full"><label htmlFor="learningPreferences">Helpful context</label><textarea id="learningPreferences" name="learningPreferences" rows={3} /></div>
          <button className="outline-button">Add learner</button>
        </form>
      </section>
      <section><h2><CreditCard size={17} /> Billing</h2><div className="billing-line"><div><strong>{subscription?.status === "active" ? "Klio membership" : "Prototype access"}</strong><p>{subscription ? `Subscription is ${subscription.status}.` : "Stripe is ready to connect when keys and a price are configured."}</p></div>
        <form action="/api/stripe/checkout" method="post"><input type="hidden" name="familyId" value={workspace.family.id} /><button className="outline-button">{subscription?.status === "active" ? "Manage billing" : "Start membership"}</button></form>
      </div></section>
      <section><h2>Privacy</h2><p className="settings-copy">Klio stores student records in your private family workspace. Agent drafts never update approved learning records without parent review. You can export your portfolio from Records.</p><a className="text-link" href="/privacy">Read the privacy summary</a></section>
    </div>
  );
}
