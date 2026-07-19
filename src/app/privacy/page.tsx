import { KlioWordmark } from "@/components/klio-wordmark";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <KlioWordmark />
      <article>
        <p className="eyebrow">Plain-language prototype policy</p>
        <h1>Privacy at Klio</h1>
        <p>Klio stores parent account information, learner names and context, uploaded evidence, agent-created drafts, approvals, and audit history so a family can maintain its homeschool workspace.</p>
        <h2>Your family workspace is private</h2>
        <p>Database and file access are restricted by family membership. Files are kept in a private bucket and are never exposed through public URLs.</p>
        <h2>How the agent uses data</h2>
        <p>When you ask Klio to work with selected evidence, that evidence and relevant learner context are sent to the configured OpenAI API project. Klio does not use student data for advertising. Agent outputs remain drafts until a parent approves them.</p>
        <h2>Voice input</h2>
        <p>When you use voice input, Klio sends the recording to the configured OpenAI API project immediately after recording stops so it can be transcribed. This happens before you send the resulting editable draft. Klio processes the audio for that request but does not save the recording to your family workspace; the returned text remains in your draft until you choose to send it.</p>
        <h2>Export and deletion</h2>
        <p>The prototype includes a portfolio export. Before public launch, Klio will also provide a guided full-workspace deletion flow and finalized legal terms.</p>
      </article>
    </main>
  );
}
