import Link from "next/link";
import { ChevronRight, CreditCard, Download, FileText, Plus, Upload, Users } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const subscriptionResult = await supabase.from("subscriptions").select("status, current_period_end").eq("family_id", workspace.family.id).maybeSingle();
  if (subscriptionResult.error) throw subscriptionResult.error;
  const subscription = subscriptionResult.data;
  const year = new Date().getFullYear();

  return (
    <div className="section-page settings-page">
      <header><p className="eyebrow">Occasional tasks</p><h1>Family account</h1><p>Manage the people and account details for {workspace.family.name}.</p></header>

      <section className="learner-settings">
        <div className="learner-index-header">
          <div><h2><Users size={17} /> Learners</h2><p className="settings-copy">Each learner has their own subjects, curriculum, and weekly rhythm.</p></div>
          <Link className="outline-button learner-add-link" href="/app/settings/learners/new"><Plus size={15} /> Add learner</Link>
        </div>
        <div className="learner-index-list">
          {workspace.students.map((student) => {
            const subjects = student.subjects ?? [];
            const preview = subjects.slice(0, 3).map((subject) => subject.name).join(", ");
            const remaining = Math.max(subjects.length - 3, 0);
            return <Link className="learner-index-row" href={`/app/settings/learners/${student.id}`} key={student.id}>
              <span className="learner-index-avatar" aria-hidden="true">{student.displayName.charAt(0)}</span>
              <span className="learner-index-name"><strong>{student.displayName}</strong><small>{stageLabel(student.gradeBand)}</small></span>
              <span className="learner-index-subjects">{subjects.length ? <><strong>{subjects.length} {subjects.length === 1 ? "subject" : "subjects"}</strong><small>{preview}{remaining ? ` +${remaining} more` : ""}</small></> : <><strong>Setup needed</strong><small>Add subjects and curriculum</small></>}</span>
              <span className="learner-index-action">Learning setup <ChevronRight size={16} /></span>
            </Link>;
          })}
        </div>
      </section>

      <section><h2><CreditCard size={17} /> Billing</h2><div className="billing-line"><div><strong>{subscription?.status === "active" ? "Klio membership" : "Prototype access"}</strong><p>{subscription ? `Subscription is ${subscription.status}.` : "Stripe is ready to connect when keys and a price are configured."}</p></div>
        <form action="/api/stripe/checkout" method="post"><input type="hidden" name="familyId" value={workspace.family.id} /><button className="outline-button">{subscription?.status === "active" ? "Manage billing" : "Start membership"}</button></form>
      </div></section>
      <section><h2><FileText size={17} /> Files and exports</h2><p className="settings-copy">Import older records, inspect original captures, or export this year’s family portfolio.</p><div className="account-tools"><Link href="/app/import"><Upload size={15} /><span><strong>Import grades</strong><small>Add a CSV from another system</small></span></Link><Link href="/app/evidence"><FileText size={15} /><span><strong>All captures</strong><small>View raw notes, photos, and files</small></span></Link><a href={`/api/export?familyId=${workspace.family.id}&from=${year}-01-01&to=${year}-12-31`}><Download size={15} /><span><strong>Export this year</strong><small>Download the family portfolio</small></span></a></div></section>
      <section><h2>Privacy</h2><p className="settings-copy">Klio stores student records in your private family workspace. Klio’s suggestions never become approved learning context without your review.</p><a className="text-link" href="/privacy">Read the privacy summary</a></section>
    </div>
  );
}

function stageLabel(value: string | null) { return ({ "pre-k": "Pre-K", "k-2": "K–2", "3-5": "Grades 3–5", "6-8": "Grades 6–8", "9-12": "Grades 9–12", other: "Mixed stage" } as Record<string,string>)[value ?? ""] ?? "Learning stage"; }
