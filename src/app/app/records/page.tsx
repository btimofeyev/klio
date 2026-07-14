import Link from "next/link";
import { BookOpen, Camera, ChevronLeft, FileText, Folder, Mic, Paperclip, Sparkles } from "lucide-react";
import { getWorkspace, type EvidenceDTO } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";

type RecordSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RecordsPage({ searchParams }: { searchParams: RecordSearchParams }) {
  const workspace = await getWorkspace();
  if (!workspace) return null;

  const query = await searchParams;
  const requestedStudent = single(query.student);
  const selectedStudent = workspace.students.find((student) => student.id === requestedStudent) ?? null;
  const familyView = !selectedStudent;
  if (!workspace.students.length) return null;

  const supabase = await createClient();
  const [evidenceResult, subjectsResult] = await Promise.all([
    supabase.from("evidence_items")
      .select("id, capture_submission_id, capture_route, kind, title, raw_text, mime_type, storage_path, source_at, processing_status, created_at, evidence_students(student_id), evidence_categories(document_type, tags, confidence, categories(id, name, slug))")
      .eq("family_id", workspace.family.id)
      .neq("capture_route", "reminder")
      .order("source_at", { ascending: false })
      .limit(300),
    supabase.from("student_subjects").select("student_id,name").eq("family_id", workspace.family.id).eq("status", "active"),
  ]);
  if (evidenceResult.error) throw evidenceResult.error;
  if (subjectsResult.error) throw subjectsResult.error;
  const evidenceRows = evidenceResult.data;

  const evidence = (evidenceRows ?? []).map((item): EvidenceDTO => ({
    id: item.id,
    captureSubmissionId: item.capture_submission_id,
    captureRoute: item.capture_route,
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
  })).filter((item) => familyView || item.studentIds.includes(selectedStudent.id));

  const unfiled = evidence.filter((item) => !item.categories.length);
  const folderCounts = new Map(workspace.categories.map((category) => [category.id, evidence.filter((item) => item.categories.some((filing) => filing.id === category.id)).length]));
  const learnerSubjects = new Set(subjectsResult.data.filter((subject) => familyView || subject.student_id === selectedStudent.id).map((subject) => subject.name.toLowerCase()));
  const evidenceCategoryIds = new Set(evidence.flatMap((item) => item.categories.map((category) => category.id)));
  const categories = workspace.categories.filter((category) => learnerSubjects.has(category.name.toLowerCase()) || evidenceCategoryIds.has(category.id)).sort((a, b) => subjectOrder(a.name) - subjectOrder(b.name) || a.name.localeCompare(b.name));
  const requestedFolder = single(query.folder);
  const activeCategory = categories.find((category) => category.id === requestedFolder)
    ?? categories.find((category) => (folderCounts.get(category.id) ?? 0) > 0)
    ?? categories[0]
    ?? null;
  const showUnfiled = requestedFolder === "unfiled" || (!activeCategory && unfiled.length > 0);
  const visibleEvidence = showUnfiled ? unfiled : evidence.filter((item) => item.categories.some((filing) => filing.id === activeCategory?.id));
  const activeName = showUnfiled ? "Needs your help" : activeCategory?.name ?? "Learning";

  return (
    <main className="folder-library">
      <header className="folder-library-header">
        <Link href="/app" className="folder-back"><ChevronLeft size={15} /> Home</Link>
        <div>
          <p>Learning folders</p>
          <h1>{familyView ? "Family learning" : `${selectedStudent.displayName}’s learning`}</h1>
          <span>Books, notes, worksheets, and activities—filed by subject.</span>
        </div>
        <Link href={familyView ? "/app/portfolio" : `/app/portfolio?student=${selectedStudent.id}`} className="folder-tools-link"><Sparkles size={13} /> Create portfolio</Link>
      </header>

      <nav className="learner-tabs" aria-label="Choose a learner">
        <Link className={familyView ? "active" : ""} href="/app/records"><i>F</i>Family</Link>
        {workspace.students.map((student) => <Link className={student.id === selectedStudent?.id ? "active" : ""} href={`/app/records?student=${student.id}`} key={student.id}><i>{student.displayName.charAt(0)}</i>{student.displayName}</Link>)}
      </nav>

      <div className="folder-library-layout">
        <aside className="subject-folders">
          <h2>Subjects</h2>
          <nav aria-label={familyView ? "Family subject folders" : `${selectedStudent.displayName}’s subject folders`}>
            {categories.map((category) => {
              const count = folderCounts.get(category.id) ?? 0;
              return <Link className={!showUnfiled && activeCategory?.id === category.id ? "active" : ""} href={recordHref(selectedStudent?.id, category.id)} key={category.id}><Folder size={16} /><span>{category.name}</span><b>{count}</b></Link>;
            })}
            {unfiled.length ? <Link className={showUnfiled ? "active needs-help" : "needs-help"} href={recordHref(selectedStudent?.id, "unfiled")}><Folder size={16} /><span>Needs your help</span><b>{unfiled.length}</b></Link> : null}
          </nav>
        </aside>

        <section className="subject-records" aria-labelledby="active-folder-title">
          <header>
            <div><p>Subject folder</p><h2 id="active-folder-title">{activeName}</h2></div>
            <span>{visibleEvidence.length} {visibleEvidence.length === 1 ? "item" : "items"}</span>
          </header>

          {visibleEvidence.length ? groupByMonth(visibleEvidence).map(([month, items]) => <section className="record-month" key={month}>
            <h3>{month}</h3>
            <div>{items.map((item) => <article className="learning-entry" key={item.id}>
              <time dateTime={item.sourceAt}><strong>{new Date(item.sourceAt).getDate()}</strong><span>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(new Date(item.sourceAt))}</span></time>
              <div className="learning-entry-icon">{kindIcon(item.kind)}</div>
              <div className="learning-entry-copy"><h4>{entryTitle(item)}</h4><p>{familyView ? `${formatStudentNames(item.studentIds, workspace.students)} · ` : ""}{entryDetail(item)}</p></div>
              {item.storagePath ? <a href={`/api/evidence/${item.id}/download`}>Open original</a> : null}
            </article>)}</div>
          </section>) : <div className="folder-empty"><BookOpen size={22} /><h3>This folder is ready.</h3><p>Learning filed under {activeName} will appear here in date order.</p><Link href="/app">Add learning</Link></div>}
        </section>
      </div>
    </main>
  );
}

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function recordHref(studentId: string | undefined, folder: string) { const params = new URLSearchParams({ folder }); if (studentId) params.set("student", studentId); return `/app/records?${params.toString()}`; }
function formatStudentNames(studentIds: string[], students: Array<{ id: string; displayName: string }>) { const names = students.filter((student) => studentIds.includes(student.id)).map((student) => student.displayName); return names.length ? new Intl.ListFormat("en", { style: "short", type: "conjunction" }).format(names) : "Family"; }
function subjectOrder(name: string) { const order = ["english", "reading", "writing", "math", "science", "history", "arts", "life skills", "other"]; const index = order.indexOf(name.toLowerCase()); return index === -1 ? 50 : index; }
function groupByMonth(items: EvidenceDTO[]) { const groups = new Map<string, EvidenceDTO[]>(); items.forEach((item) => { const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(item.sourceAt)); groups.set(label, [...(groups.get(label) ?? []), item]); }); return [...groups.entries()]; }
function entryTitle(item: EvidenceDTO) { return (item.title || item.rawText || kindLabel(item.kind)).replace(/^Link:\s*/i, "").slice(0, 120); }
function entryDetail(item: EvidenceDTO) { const type = item.categories[0]?.documentType || kindLabel(item.kind); const text = item.rawText && item.rawText !== item.title ? item.rawText.slice(0, 150) : null; return text ? `${type} · ${text}` : type; }
function kindLabel(kind: string) { return ({ photo: "Photo", voice: "Voice note", document: "File", note: "Note", grade: "Grade", book: "Book", activity: "Activity", csv_import: "Imported record" } as Record<string,string>)[kind] ?? kind.replaceAll("_", " "); }
function kindIcon(kind: string) { if (kind === "photo") return <Camera size={16} />; if (kind === "voice") return <Mic size={16} />; if (kind === "document" || kind === "csv_import") return <Paperclip size={16} />; return <FileText size={16} />; }
