import Link from "next/link";
import { ArrowRight, BookOpen, Camera, Mic, Sparkles } from "lucide-react";
import { getCurrentParent } from "@/lib/auth/require-parent";
import { redirect } from "next/navigation";
import { KlioWordmark } from "@/components/klio-wordmark";

export default async function HomePage() {
  const parent = await getCurrentParent();
  if (parent) redirect("/app");

  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <KlioWordmark />
        <Link className="text-link" href="/login">Sign in</Link>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">A working memory for your homeschool</p>
          <h1>Drop in the day.<br />Klio carries it forward.</h1>
          <p className="hero-lede">
            Notes, worksheets, voice clips, and grades become useful plans,
            lessons, and learning records—with you in control.
          </p>
          <Link className="primary-button" href="/login?mode=signup">
            Start your family workspace <ArrowRight size={17} />
          </Link>
        </div>

        <div className="hero-capture" aria-label="Example Klio capture surface">
          <div className="capture-paper">
            <div className="capture-line" />
            <p>We finished chapter four of The Wild Robot. Nora wondered why Roz chose to stay...</p>
            <div className="capture-tools">
              <span><Camera size={16} /> Photo</span>
              <span><Mic size={16} /> Voice</span>
              <span><BookOpen size={16} /> File</span>
              <span className="capture-send"><Sparkles size={15} /> Add to Klio</span>
            </div>
          </div>
          <div className="paper-shadow shadow-one" />
          <div className="paper-shadow shadow-two" />
        </div>
      </section>

      <section className="landing-proof">
        <p>One quiet place for the fragments that make up a real education.</p>
        <div className="proof-flow">
          <span>Capture</span><i />
          <span>Understand</span><i />
          <span>Create</span><i />
          <span>Approve</span>
        </div>
      </section>
    </main>
  );
}
