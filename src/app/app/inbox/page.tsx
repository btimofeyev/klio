import Link from "next/link";
import { ChevronRight, FileText, Inbox } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";

export default async function InboxPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const items = workspace.evidence.filter((item) => item.status !== "ready").slice(0, 30);
  return <div className="section-page"><header><p className="eyebrow">Incoming work</p><h1>Inbox</h1><p>Uploads and notes that Klio is processing or that still need your attention.</p></header><section className="evidence-archive"><header><div><p className="eyebrow">Unfinished</p><h2>Needs attention</h2></div><span>{items.length}</span></header>{items.length ? items.map((item) => <Link className="archive-row" href="/app/records" key={item.id}><FileText size={15} /><div><strong>{item.title || item.rawText?.slice(0, 80) || item.kind}</strong><span>{item.kind.replaceAll("_", " ")} · {item.status.replaceAll("_", " ")}</span></div><ChevronRight size={14} /></Link>) : <div className="large-empty"><Inbox size={26} /><h2>Inbox clear</h2><p>New captures will appear here while Klio organizes them.</p></div>}</section></div>;
}
