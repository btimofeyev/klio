import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewLearnerForm } from "@/components/new-learner-form";
import { getWorkspace } from "@/lib/data/workspace";

export default async function NewLearnerPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  return <div className="learner-route-page new-learner-page">
    <Link className="learner-route-back" href="/app/settings"><ArrowLeft size={15} /> Family account</Link>
    <header><p className="eyebrow">New learner</p><h1>Who are we learning with?</h1><p>Start with the basics. You’ll choose this learner’s subjects and curriculum next.</p></header>
    <section className="learner-route-paper"><NewLearnerForm familyId={workspace.family.id} /></section>
  </div>;
}
