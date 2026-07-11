import Link from "next/link";
import { Download, FileText, Search, Sparkles, X } from "lucide-react";
import { getWorkspace, type EvidenceDTO } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { OrganizationWorkspace } from "@/components/organization-workspace";

type RecordSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RecordsPage({ searchParams }: { searchParams: RecordSearchParams }) {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const query = await searchParams;
  const filters = {
    q: single(query.q).trim().toLowerCase(),
    folder: single(query.folder),
    student: single(query.student),
    type: single(query.type),
    status: single(query.status),
    from: single(query.from),
    to: single(query.to),
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const supabase = await createClient();
  const [{ data: evidenceRows, error: evidenceError }, { data: observationRows, error: observationError }, { data: artifactRows, error: artifactError }] = await Promise.all([
    supabase.from("evidence_items").select("id, kind, title, raw_text, extracted_text, mime_type, storage_path, source_at, processing_status, created_at, evidence_students(student_id), evidence_categories(document_type, tags, confidence, categories(id, name, slug))").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("skill_observations").select("id, student_id, subject, skill_label, status, rationale, approval_status, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("artifacts").select("id, student_id, type, title, summary, rationale, status, created_at").eq("family_id", workspace.family.id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (evidenceError) throw evidenceError;
  if (observationError) throw observationError;
  if (artifactError) throw artifactError;

  const studentNames = new Map(workspace.students.map((student) => [student.id, student.displayName]));
  const evidence = (evidenceRows ?? []).map((item) => ({
    dto: {
      id: item.id,
      kind: item.kind,
      title: item.title,
      rawText: item.raw_text,
      mimeType: item.mime_type,
      storagePath: item.storage_path,
      sourceAt: item.source_at,
      status: item.processing_status,
      createdAt: item.created_at,
      studentIds: item.evidence_students.map((link) => link.student_id),
      categories: item.evidence_categories.map((link) => ({ id: link.categories.id, name: link.categories.name, slug: link.categories.slug, documentType: link.document_type, tags: link.tags, confidence: link.confidence })),
    } satisfies EvidenceDTO,
    extractedText: item.extracted_text,
  })).filter(({ dto, extractedText }) => {
    const filing = dto.categories[0];
    const learnerText = dto.studentIds.map((id) => studentNames.get(id) ?? "").join(" ");
    const haystack = [dto.title, dto.rawText, extractedText, filing?.name, filing?.documentType, ...(filing?.tags ?? []), learnerText].filter(Boolean).join(" ").toLowerCase();
    return matchesText(haystack, filters.q)
      && (!filters.folder || filing?.id === filters.folder || (filters.folder === "unfiled" && !filing))
      && (!filters.student || dto.studentIds.includes(filters.student))
      && (!filters.type || dto.kind === filters.type || filing?.documentType?.toLowerCase() === filters.type.toLowerCase())
      && (!filters.status || dto.status === filters.status)
      && matchesDate(dto.sourceAt, filters.from, filters.to);
  }).map(({ dto }) => dto);

  const observations = (observationRows ?? []).filter((observation) => {
    const haystack = `${observation.subject} ${observation.skill_label} ${observation.rationale} ${studentNames.get(observation.student_id) ?? ""}`.toLowerCase();
    return matchesText(haystack, filters.q)
      && (!filters.student || observation.student_id === filters.student)
      && (!filters.type || observation.subject.toLowerCase() === filters.type.toLowerCase())
      && (!filters.status || observation.approval_status === filters.status)
      && matchesDate(observation.created_at, filters.from, filters.to);
  });
  const artifacts = (artifactRows ?? []).filter((artifact) => {
    const haystack = `${artifact.title} ${artifact.summary ?? ""} ${artifact.rationale ?? ""} ${artifact.type} ${artifact.student_id ? studentNames.get(artifact.student_id) ?? "" : ""}`.toLowerCase();
    return matchesText(haystack, filters.q)
      && (!filters.student || artifact.student_id === filters.student)
      && (!filters.type || artifact.type === filters.type)
      && (!filters.status || artifact.status === filters.status)
      && matchesDate(artifact.created_at, filters.from, filters.to);
  });
  const grouped = new Map(workspace.students.map((student) => [student.id, observations.filter((item) => item.student_id === student.id)]));
  const typeOptions = [...new Set([
    ...(evidenceRows ?? []).map((item) => item.kind),
    ...(evidenceRows ?? []).flatMap((item) => item.evidence_categories.map((link) => link.document_type).filter((value): value is string => Boolean(value))),
    ...(observationRows ?? []).map((item) => item.subject),
    ...(artifactRows ?? []).map((item) => item.type),
  ])].sort((a, b) => a.localeCompare(b));
  const year = new Date().getFullYear();

  return (
    <div className="section-page records-page">
      <header className="section-page-header"><div><p className="eyebrow">Durable family context</p><h1>Learning records</h1><p>Find evidence, correct Klio’s filing, and keep approved learning context distinct from drafts.</p></div>
        <div className="header-actions"><Link className="outline-button" href="/app/import"><FileText size={15} /> Import grades</Link><a className="outline-button" href={`/api/export?familyId=${workspace.family.id}&from=${year}-01-01&to=${year}-12-31`}><Download size={15} /> Export portfolio</a></div>
      </header>

      <form className="records-filter-bar" method="get">
        <label className="records-search"><span>Search records</span><div><Search size={16} /><input name="q" defaultValue={single(query.q)} placeholder="Notes, extracted text, tags, subjects…" /></div></label>
        <label><span>Folder</span><select name="folder" defaultValue={filters.folder}><option value="">All folders</option>{workspace.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}<option value="unfiled">Unfiled</option></select></label>
        <label><span>Learner</span><select name="student" defaultValue={filters.student}><option value="">All learners</option>{workspace.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label>
        <label><span>Type or subject</span><select name="type" defaultValue={filters.type}><option value="">All types</option>{typeOptions.map((type) => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Status</span><select name="status" defaultValue={filters.status}><option value="">All statuses</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="ready">Ready</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="failed">Failed</option></select></label>
        <label><span>From</span><input type="date" name="from" defaultValue={filters.from} /></label>
        <label><span>To</span><input type="date" name="to" defaultValue={filters.to} /></label>
        <div className="records-filter-actions"><button type="submit">Apply filters</button>{hasFilters ? <Link href="/app/records"><X size={13} /> Clear</Link> : null}</div>
      </form>
      {hasFilters ? <p className="filter-summary">Showing {evidence.length} evidence records, {observations.length} observations, and {artifacts.length} Klio drafts or artifacts.</p> : null}

      {workspace.students.filter((student) => !filters.student || student.id === filters.student).map((student) => (
        <section className="student-record" key={student.id}>
          <header><div className="student-initial">{student.displayName.slice(0, 1)}</div><div><h2>{student.displayName}</h2><span>{student.gradeBand?.toUpperCase() || "Learning path"}</span></div></header>
          {student.learningPreferences ? <p className="student-context">{student.learningPreferences}</p> : null}
          <div className="skill-list">{grouped.get(student.id)?.length ? grouped.get(student.id)?.map((observation) => <div className="skill-row" key={observation.id}><span className={`skill-state ${observation.status}`} /><div><strong>{observation.skill_label}</strong><small>{observation.subject} · {observation.status}</small></div><span className={`record-state ${observation.approval_status}`}>{observation.approval_status}</span></div>) : <p className="section-empty">No observations match these filters.</p>}</div>
        </section>
      ))}

      {(artifacts.length > 0 || !hasFilters) ? <section className="record-artifacts"><header><div><p className="eyebrow">Created from evidence</p><h2>Klio records</h2></div><span>{artifacts.length}</span></header>{artifacts.length ? artifacts.slice(0, 30).map((artifact) => <Link href={`/app/artifacts/${artifact.id}`} className="record-artifact-row" key={artifact.id}><Sparkles size={15} /><div><strong>{artifact.title}</strong><small>{artifact.type.replaceAll("_", " ")} · {artifact.student_id ? studentNames.get(artifact.student_id) : "Family"}</small></div><span className={`record-state ${artifact.status}`}>{artifact.status}</span></Link>) : <p className="section-empty">No Klio records match these filters.</p>}</section> : null}

      <section className="evidence-archive"><header><div><p className="eyebrow">Organized by Klio</p><h2>Evidence folders</h2></div><span>{evidence.length} matching records</span></header><OrganizationWorkspace key={`${workspace.categories.map((category) => `${category.id}:${category.name}:${category.evidenceCount}`).join("|")}:${evidence.map((item) => `${item.id}:${item.status}:${item.categories[0]?.id ?? "unfiled"}`).join("|")}`} familyId={workspace.family.id} initialCategories={workspace.categories} initialEvidence={evidence} /></section>
    </div>
  );
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function matchesText(haystack: string, query: string) {
  if (!query) return true;
  return query.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

function matchesDate(value: string, from: string, to: string) {
  const time = new Date(value).getTime();
  if (from && time < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}
