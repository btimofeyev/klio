import Link from "next/link";
import { Download, Sparkles } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";

export default async function PortfolioPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const approved = workspace.artifacts.filter((artifact) => artifact.status === "approved");
  const year = new Date().getFullYear();
  return <div className="section-page"><header className="section-page-header"><div><p className="eyebrow">Shareable learning story</p><h1>Portfolio</h1><p>Approved summaries, plans, lessons, and practice created from your family’s evidence.</p></div><a className="outline-button" href={`/api/export?familyId=${workspace.family.id}&from=${year}-01-01&to=${year}-12-31`}><Download size={15} />Export year</a></header><section className="record-artifacts"><header><div><p className="eyebrow">Approved by you</p><h2>Portfolio pieces</h2></div><span>{approved.length}</span></header>{approved.length ? approved.map((artifact) => <Link href={`/app/artifacts/${artifact.id}`} className="record-artifact-row" key={artifact.id}><Sparkles size={15} /><div><strong>{artifact.title}</strong><small>{artifact.type.replaceAll("_"," ")}</small></div><span className="record-state approved">approved</span></Link>) : <p className="section-empty">Approved Klio records will collect here.</p>}</section></div>;
}
