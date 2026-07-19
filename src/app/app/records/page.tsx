import Link from "next/link";
import { BookOpen, Camera, ChevronRight, Clock3, FileText, Folder, Mic, Paperclip, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { getWorkspace, type EvidenceDTO } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import styles from "./records-dashboard.module.css";

type RecordSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RecordsPage({ searchParams }: { searchParams: RecordSearchParams }) {
  const workspace = await getWorkspace();
  if (!workspace) return null;

  const query = await searchParams;
  const requestedStudent = single(query.student);
  const selectedStudent = workspace.students.find((student) => student.id === requestedStudent) ?? null;
  const familyView = !selectedStudent;
  const mobileView = single(query.view) === "progress" ? "progress" : "files";
  if (!workspace.students.length) return null;

  const supabase = await createClient();
  const [evidenceResult, subjectsResult, insightsResult, reviewsResult] = await Promise.all([
    supabase.from("evidence_items")
      .select("id, capture_submission_id, capture_route, kind, title, raw_text, mime_type, storage_path, source_at, processing_status, created_at, evidence_students(student_id), evidence_categories(document_type, tags, confidence, categories(id, name, slug))")
      .eq("family_id", workspace.family.id)
      .neq("capture_route", "reminder")
      .order("source_at", { ascending: false })
      .limit(300),
    supabase.from("student_subjects").select("student_id,name").eq("family_id", workspace.family.id).eq("status", "active"),
    supabase.from("klio_insights").select("id,student_id,title,summary,reason,evidence_refs,action_ref,created_at").eq("family_id", workspace.family.id).neq("status", "dismissed").in("kind", ["noticed", "adjusted", "practice_ready"]).order("priority", { ascending: false }).limit(12),
    supabase.from("assignment_reviews").select("id,student_id,assignment_id,score,skill_key,evidence_kind,reviewed_at").eq("family_id", workspace.family.id).eq("status", "approved").not("score", "is", null).order("reviewed_at", { ascending: false }).limit(30),
  ]);
  if (evidenceResult.error) throw evidenceResult.error;
  if (subjectsResult.error) throw subjectsResult.error;
  if (insightsResult.error) throw insightsResult.error;
  if (reviewsResult.error) throw reviewsResult.error;

  const evidence = (evidenceResult.data ?? []).map((item): EvidenceDTO => ({
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
  const progressInsights = insightsResult.data.filter((item) => familyView || item.student_id === selectedStudent.id).slice(0, 3);
  const recentReviews = reviewsResult.data.filter((item) => familyView || item.student_id === selectedStudent.id).slice(0, 6);

  return (
    <main className={`fixed-dashboard ${styles.dashboard} ${mobileView === "progress" ? styles.progressMode : ""}`}>
      <header className={styles.header}>
        <div><span>Records</span><h1>{familyView ? "Family progress" : `${selectedStudent.displayName}’s progress`}</h1><p>Approved work, Klio’s observations, and the original learning record.</p></div>
        <nav aria-label="Record tools"><Link href="/app/activity"><Clock3 size={15} />Activity</Link><Link className={styles.primaryAction} href={familyView ? "/app/portfolio" : `/app/portfolio?student=${selectedStudent.id}`}><Sparkles size={15} />Create portfolio</Link></nav>
      </header>

      <section className={styles.scopeBar}>
        <nav className={`${styles.learnerTabs} learner-tabs`} aria-label="Choose a learner">
          <Link className={familyView ? styles.active : ""} href={recordScopeHref(undefined, requestedFolder, mobileView)}><i>F</i>Family</Link>
          {workspace.students.map((student) => <Link className={student.id === selectedStudent?.id ? styles.active : ""} href={recordScopeHref(student.id, requestedFolder, mobileView)} key={student.id}><i>{student.displayName.charAt(0)}</i>{student.displayName}</Link>)}
        </nav>
        <nav className={styles.mobileViews} aria-label="Records view"><Link className={mobileView === "files" ? styles.active : ""} href={recordModeHref(selectedStudent?.id, requestedFolder, "files")}>Files</Link><Link className={mobileView === "progress" ? styles.active : ""} href={recordModeHref(selectedStudent?.id, requestedFolder, "progress")}>Progress</Link></nav>
      </section>

      <div className={styles.body}>
        <aside className={`${styles.folderRail} subject-folders`}>
          <header><h2>Subjects</h2><span>{evidence.length} records</span></header>
          <nav aria-label={familyView ? "Family subject folders" : `${selectedStudent.displayName}’s subject folders`}>
            {categories.map((category) => {
              const count = folderCounts.get(category.id) ?? 0;
              return <Link className={!showUnfiled && activeCategory?.id === category.id ? styles.active : ""} href={recordHref(selectedStudent?.id, category.id)} key={category.id}><Folder size={15} /><span>{category.name}</span><b>{count}</b></Link>;
            })}
            {unfiled.length ? <Link className={`${showUnfiled ? styles.active : ""} ${styles.needsHelp}`} href={recordHref(selectedStudent?.id, "unfiled")}><Folder size={15} /><span>Needs your help</span><b>{unfiled.length}</b></Link> : null}
          </nav>
        </aside>

        <section className={`${styles.recordsPane} subject-records`} aria-labelledby="active-folder-title">
          <header><div><span>Subject folder</span><h2 id="active-folder-title">{activeName}</h2></div><p>{visibleEvidence.length} {visibleEvidence.length === 1 ? "item" : "items"}</p></header>
          <div className={styles.recordScroller}>
            {visibleEvidence.length ? groupByMonth(visibleEvidence).map(([month, items]) => <section className={styles.recordMonth} key={month}>
              <h3>{month}</h3>
              <div>{items.map((item) => <article className={styles.learningEntry} key={item.id}>
                <time dateTime={item.sourceAt}><strong>{new Date(item.sourceAt).getDate()}</strong><span>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(new Date(item.sourceAt))}</span></time>
                <div className={styles.entryIcon}>{kindIcon(item.kind)}</div>
                <div className={styles.entryCopy}><h4>{entryTitle(item)}</h4><p>{familyView ? `${formatStudentNames(item.studentIds, workspace.students)} · ` : ""}{entryDetail(item)}</p></div>
                {item.storagePath ? <a href={`/api/evidence/${item.id}/download`}>Open original<ChevronRight size={13} /></a> : null}
              </article>)}</div>
            </section>) : <div className={styles.empty}><BookOpen size={22} /><h3>This folder is ready</h3><p>Learning filed under {activeName} will appear here in date order.</p><Link href="/app">Add learning</Link></div>}
          </div>
        </section>

        <aside className={styles.progressRail} aria-label="Learning progress">
          <header><span>Evidence-backed progress</span><h2>{progressInsights.length ? "What Klio is watching" : "No meaningful trend yet"}</h2><p>Draft reviews never count toward trends.</p></header>
          <div className={styles.insights}>
            {progressInsights.length ? progressInsights.map((insight) => {
              const refs = jsonArray(insight.evidence_refs);
              const action = jsonObject(insight.action_ref);
              return <article key={insight.id}><span>{insight.title.toLowerCase().includes("less consistent") ? <TrendingDown size={14} /> : <TrendingUp size={14} />}Klio noticed</span><h3>{insight.title}</h3><p>{insight.summary}</p><footer><small>{refs.length} supporting {refs.length === 1 ? "record" : "records"}</small>{typeof action.artifactId === "string" ? <Link href={`/app/artifacts/${action.artifactId}`}>Open practice<ChevronRight size={12} /></Link> : null}</footer>{insight.reason ? <details><summary>Why this counts</summary><p>{insight.reason}</p></details> : null}</article>;
            }) : <article className={styles.onTrack}><Sparkles size={16} /><h3>This week is on track</h3><p>Klio has not found enough related, approved evidence to call a trend. One low result will not trigger extra practice.</p></article>}
          </div>
          <section className={styles.results}><header><h3>Recent approved results</h3><span>{recentReviews.length}</span></header>{recentReviews.length ? recentReviews.map((review) => <div key={review.id}><strong>{Math.round(Number(review.score))}%</strong><p>{humanizeSkill(review.skill_key)}<small>{review.evidence_kind === "practice" ? "Supplemental practice" : "Curriculum work"}</small></p></div>) : <p>No approved scores yet.</p>}</section>
        </aside>
      </div>
    </main>
  );
}

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function recordHref(studentId: string | undefined, folder: string) { const params = new URLSearchParams({ folder }); if (studentId) params.set("student", studentId); return `/app/records?${params.toString()}`; }
function recordScopeHref(studentId: string | undefined, folder: string, view: string) { const params = new URLSearchParams(); if (studentId) params.set("student", studentId); if (folder) params.set("folder", folder); if (view === "progress") params.set("view", "progress"); const suffix = params.toString(); return suffix ? `/app/records?${suffix}` : "/app/records"; }
function recordModeHref(studentId: string | undefined, folder: string, view: "files" | "progress") { const params = new URLSearchParams(); if (studentId) params.set("student", studentId); if (folder) params.set("folder", folder); if (view === "progress") params.set("view", view); const suffix = params.toString(); return suffix ? `/app/records?${suffix}` : "/app/records"; }
function formatStudentNames(studentIds: string[], students: Array<{ id: string; displayName: string }>) { const names = students.filter((student) => studentIds.includes(student.id)).map((student) => student.displayName); return names.length ? new Intl.ListFormat("en", { style: "short", type: "conjunction" }).format(names) : "Family"; }
function subjectOrder(name: string) { const order = ["english", "reading", "writing", "math", "science", "history", "arts", "life skills", "other"]; const index = order.indexOf(name.toLowerCase()); return index === -1 ? 50 : index; }
function groupByMonth(items: EvidenceDTO[]) { const groups = new Map<string, EvidenceDTO[]>(); items.forEach((item) => { const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(item.sourceAt)); groups.set(label, [...(groups.get(label) ?? []), item]); }); return [...groups.entries()]; }
function entryTitle(item: EvidenceDTO) { return (item.title || item.rawText || kindLabel(item.kind)).replace(/^Link:\s*/i, "").slice(0, 120); }
function entryDetail(item: EvidenceDTO) { const type = item.categories[0]?.documentType || kindLabel(item.kind); const text = item.rawText && item.rawText !== item.title ? item.rawText.slice(0, 150) : null; return text ? `${type} · ${text}` : type; }
function kindLabel(kind: string) { return ({ photo: "Photo", voice: "Voice note", document: "File", note: "Note", grade: "Grade", book: "Book", activity: "Activity", csv_import: "Imported record" } as Record<string,string>)[kind] ?? kind.replaceAll("_", " "); }
function kindIcon(kind: string) { if (kind === "photo") return <Camera size={15} />; if (kind === "voice") return <Mic size={15} />; if (kind === "document" || kind === "csv_import") return <Paperclip size={15} />; return <FileText size={15} />; }
function humanizeSkill(value: string | null) { return value ? value.replaceAll(/[._-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Recorded work"; }
function jsonArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function jsonObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
