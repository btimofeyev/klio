import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function RecordsPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data: observations } = await supabase.from("skill_observations").select("id, student_id, subject, skill_label, status, rationale, approval_status, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false });
  const grouped = new Map(workspace.students.map((student) => [student.id, observations?.filter((item) => item.student_id === student.id) ?? []]));
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
      <section className="evidence-archive"><h2>Evidence archive</h2>
        {workspace.evidence.map((item) => <div className="archive-row" key={item.id}><FileText size={15} /><div><strong>{item.title || item.rawText?.slice(0, 70) || item.kind}</strong><span>{new Date(item.sourceAt).toLocaleDateString()} · {item.kind}</span></div>{item.storagePath ? <a className="text-link" href={`/api/evidence/${item.id}/download`}>Original</a> : null}</div>)}
      </section>
    </div>
  );
}
