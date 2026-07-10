import type { Metadata } from "next";
import { KlioWordmark } from "@/components/klio-wordmark";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const mode = (await searchParams).mode === "signup" ? "signup" : "signin";

  return (
    <main className="auth-shell">
      <aside className="auth-aside">
        <KlioWordmark />
        <p className="auth-quote">The day is full of learning. Keep what matters.</p>
        <small>Private by default · Parent controlled</small>
      </aside>
      <section className="auth-main"><AuthForm mode={mode} /></section>
    </main>
  );
}
