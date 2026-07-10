import Link from "next/link";
import { Download, FileText, Folder, FolderOpen } from "lucide-react";
import { getWorkspace, type EvidenceDTO } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function RecordsPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data: observations } = await supabase.from("skill_observations").select("id, student_id, subject, skill_label, status, rationale, approval_status, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false });
  const grouped = new Map(workspace.students.map((student) => [student.id, observations?.filter((item) => item.student_id === student.id) ?? []]));
  const categorizedEvidenceIds = new Set(workspace.evidence.filter((item) => item.categories.length).map((item) => item.id));
  const uncategorized = workspace.evidence.filter((item) => !categorizedEvidenceIds.has(item.id));
  const year = new Date().getFullYear();
  return (
    <div className="section-page">
      <header className="section-page-header"><div><p className="eyebrow">Durable family context</p><h1>Learning records</h1><p>Source-backed observations stay distinct from Klio’s drafts.</p></div>
        <div className="header-actions"><Link className="outline-button" href="/app/import"><FileText size={15} /> Import grades</Link><a className="outline-button" href={`/api/export?familyId=${workspace.family.id}&from=${year}-01-01&to=${year}-12-31`}><Download size={15} /> Export portfolio</a></div>
      </header>
      {workspace.students.map((student) => (
        <section className="student-record" key={student.id}>
          <header><div className="student-initial">{student.displayName.slice(0, 1)}</div><div><h2>{student.displayName}</h2><span>{student.gradeBand?.toUpperCase() || "Learning path"}</span></div></header>
          {student.learningPreferences ? <p className="student-context">{student.learningPreferences}</p> : null}
          <div className="skill-list">
            {grouped.get(student.id)?.length ? grouped.get(student.id)?.map((observation) => (
              <div className="skill-row" key={observation.id}><span className={`skill-state ${observation.status}`} />
                <div><strong>{observation.skill_label}</strong><small>{observation.subject} · {observation.status}</small></div>
                <span className={`record-state ${observation.approval_status}`}>{observation.approval_status}</span>
              </div>
            )) : <p className="section-empty">No skill observations yet. Use Klio on an inbox item to begin.</p>}
          </div>
        </section>
      ))}
      <section className="evidence-archive">
        <header><div><p className="eyebrow">Organized by Klio</p><h2>Evidence folders</h2></div><span>{workspace.evidence.length} records</span></header>
        {workspace.categories.length ? (
          <div className="records-browser">
            <nav className="folder-rail" aria-label="Evidence folders">
              {workspace.categories.map((category) => (
                <a href={`#folder-${category.slug}`} key={category.id}><Folder size={14} /><span>{category.name}</span><b>{category.evidenceCount}</b></a>
              ))}
              {uncategorized.length ? <a href="#folder-inbox"><Folder size={14} /><span>Unfiled</span><b>{uncategorized.length}</b></a> : null}
            </nav>
            <div className="folder-contents">
              {workspace.categories.map((category) => {
                const evidence = workspace.evidence.filter((item) => item.categories.some((link) => link.id === category.id));
                return (
                  <section id={`folder-${category.slug}`} className="folder-section" key={category.id}>
                    <header><FolderOpen size={17} /><div><h3>{category.name}</h3><p>{category.description || "Evidence organized around this subject."}</p></div><span>{category.evidenceCount}</span></header>
                    {evidence.length ? evidence.map((item) => <EvidenceArchiveRow item={item} key={item.id} />) : <p className="section-empty">No recent records in this folder.</p>}
                  </section>
                );
              })}
              {uncategorized.length ? <section id="folder-inbox" className="folder-section"><header><FolderOpen size={17} /><div><h3>Unfiled</h3><p>Saved records Klio has not organized yet.</p></div><span>{uncategorized.length}</span></header>{uncategorized.map((item) => <EvidenceArchiveRow item={item} key={item.id} />)}</section> : null}
            </div>
          </div>
        ) : <p className="section-empty">Your first Klio-assisted capture will create the folders that fit your homeschool.</p>}
      </section>
    </div>
  );
}

function EvidenceArchiveRow({ item }: { item: EvidenceDTO }) {
  const filing = item.categories[0];
  return <div className="archive-row"><FileText size={15} /><div><strong>{item.title || item.rawText?.slice(0, 70) || item.kind}</strong><span>{new Date(item.sourceAt).toLocaleDateString()} · {filing?.documentType ?? item.kind}{filing?.tags.length ? ` · ${filing.tags.slice(0, 3).join(" · ")}` : ""}</span></div>{item.storagePath ? <a className="text-link" href={`/api/evidence/${item.id}/download`}>Original</a> : null}</div>;
}
