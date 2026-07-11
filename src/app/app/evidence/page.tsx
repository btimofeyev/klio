import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";

export default async function EvidencePage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  return <div className="section-page"><header className="section-page-header"><div><p className="eyebrow">Source material</p><h1>Evidence</h1><p>Notes, photos, voice clips, files, and imports captured for your learners.</p></div><Link className="outline-button" href="/app/records">Open full records</Link></header><section className="evidence-archive"><header><div><p className="eyebrow">Recently added</p><h2>All evidence</h2></div><span>{workspace.evidence.length}</span></header>{workspace.evidence.length ? workspace.evidence.map((item) => <Link className="archive-row" href="/app/records" key={item.id}><FileText size={15} /><div><strong>{item.title || item.rawText?.slice(0,80) || item.kind}</strong><span>{item.categories[0]?.name ?? item.kind.replaceAll("_"," ")} · {new Date(item.createdAt).toLocaleDateString()}</span></div><ChevronRight size={14} /></Link>) : <p className="section-empty">No evidence captured yet.</p>}</section></div>;
}
