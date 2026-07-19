import Link from "next/link";
import { BookOpenText, CalendarRange, ChevronRight, Clock3, CreditCard, Download, FileText, Gauge, Plus, Settings2, ShieldCheck, Upload, UsersRound } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { AutonomySettings } from "@/components/autonomy-settings";
import { AcademicPlanningSettings } from "@/components/academic-planning-settings";
import { learnerWeekdays } from "@/lib/assignments/dates";
import styles from "./settings-dashboard.module.css";

type SettingsSearchParams = Promise<Record<string, string | string[] | undefined>>;
type SettingsView = "students" | "academic" | "autonomy" | "account";

export default async function SettingsPage({ searchParams }: { searchParams: SettingsSearchParams }) {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const query = await searchParams;
  const requestedView = single(query.view);
  const view: SettingsView = ["academic", "autonomy", "account"].includes(requestedView) ? requestedView as SettingsView : "students";
  const selectedStudent = workspace.students.find((student) => student.id === single(query.student)) ?? workspace.students[0] ?? null;
  const supabase = await createClient();
  const [subscriptionResult, termsResult, curriculaResult] = await Promise.all([
    supabase.from("subscriptions").select("status, current_period_end").eq("family_id", workspace.family.id).maybeSingle(),
    supabase.from("academic_terms").select("id,name,starts_on,ends_on,status").eq("family_id", workspace.family.id).in("status", ["planned", "active"]).order("starts_on", { ascending: false }),
    supabase.from("curriculum_units").select("id,student_id,subject,title,next_sequence_number,default_minutes").eq("family_id", workspace.family.id).eq("status", "active").order("subject"),
  ]);
  if (subscriptionResult.error ?? termsResult.error ?? curriculaResult.error) throw subscriptionResult.error ?? termsResult.error ?? curriculaResult.error;
  const subscription = subscriptionResult.data;
  const enabledWeekdays = learnerWeekdays(null, workspace.family.available_days);
  const year = new Date().getFullYear();

  return (
    <main className={`fixed-dashboard ${styles.dashboard}`}>
      <header className={styles.header}>
        <div><span>Family workspace</span><h1>Students</h1><p>{workspace.students.length} {workspace.students.length === 1 ? "learner" : "learners"} in {workspace.family.name}</p></div>
        <Link className={styles.primaryAction} href="/app/settings/learners/new"><Plus size={16} />Add learner</Link>
      </header>

      <nav className={styles.views} aria-label="Student workspace sections">
        <Link className={view === "students" ? styles.active : ""} href="/app/settings"><UsersRound size={16} />Students</Link>
        <Link className={view === "academic" ? styles.active : ""} href="/app/settings?view=academic"><CalendarRange size={16} />Academic plan</Link>
        <Link className={view === "autonomy" ? styles.active : ""} href="/app/settings?view=autonomy"><Settings2 size={16} />Klio autonomy</Link>
        <Link className={view === "account" ? styles.active : ""} href="/app/settings?view=account"><ShieldCheck size={16} />Account</Link>
      </nav>

      <section className={styles.viewport}>
        {view === "students" ? <div className={styles.studentsLayout}>
          <aside className={styles.roster}>
            <header><h2>Learners</h2><p>Choose a learner to see their current setup.</p></header>
            <nav aria-label="Learners">
              {workspace.students.map((student) => {
                const subjects = student.subjects ?? [];
                return <Link className={`learner-index-row ${styles.learnerRow} ${student.id === selectedStudent?.id ? styles.selected : ""}`} href={`/app/settings?student=${student.id}`} key={student.id}>
                  <span className={styles.avatar} aria-hidden="true">{student.displayName.charAt(0)}</span>
                  <span><strong>{student.displayName}</strong><small>{stageLabel(student.gradeBand)} · {subjects.length} {subjects.length === 1 ? "subject" : "subjects"}</small></span>
                  <ChevronRight size={16} />
                </Link>;
              })}
            </nav>
          </aside>

          {selectedStudent ? <article className={styles.learnerDetail}>
            <header>
              <div><span>Learning setup</span><h2>{selectedStudent.displayName}</h2><p>{stageLabel(selectedStudent.gradeBand)}</p></div>
              <div className={styles.detailActions}><Link href={`/app/records?student=${selectedStudent.id}`}>View records</Link><Link className={styles.editAction} href={`/app/settings/learners/${selectedStudent.id}`}>Edit setup<ChevronRight size={15} /></Link></div>
            </header>
            <div className={styles.metrics}>
              <div><Clock3 size={16} /><span><strong>{selectedStudent.dailyCapacityMinutes ?? 180} min</strong><small>Daily capacity</small></span></div>
              <div><CalendarRange size={16} /><span><strong>{formatWeekdays(enabledWeekdays)}</strong><small>Learning days</small></span></div>
              <div><BookOpenText size={16} /><span><strong>{selectedStudent.subjects?.length ?? 0}</strong><small>Active subjects</small></span></div>
            </div>
            <section className={styles.subjects}>
              <header><h3>Subjects and curriculum</h3><span>Weekly rhythm</span></header>
              <div>{selectedStudent.subjects?.length ? selectedStudent.subjects.map((subject) => <article key={subject.name}><span>{subject.name.charAt(0)}</span><div><strong>{subject.name}</strong><small>{subject.courseName || "Curriculum not named"}</small></div><b>{subject.weeklyFrequency}× / week</b></article>) : <div className={styles.empty}><BookOpenText size={20} /><strong>No subjects yet</strong><p>Edit this learner to add curriculum and a weekly rhythm.</p></div>}</div>
            </section>
            <footer className={styles.preferences}><Gauge size={16} /><div><strong>Teaching context</strong><p>{selectedStudent.learningPreferences || "No additional learning preferences have been recorded."}</p></div></footer>
          </article> : <div className={styles.empty}><UsersRound size={22} /><strong>Add your first learner</strong><p>Klio uses each learner’s subjects, capacity, and weekly rhythm to plan safely.</p></div>}
        </div> : null}

        {view === "academic" ? <div className={`${styles.panel} ${styles.academicPanel}`}><AcademicPlanningSettings familyId={workspace.family.id} enabledWeekdays={enabledWeekdays} terms={termsResult.data.map((term) => ({ id: term.id, name: term.name, startsOn: term.starts_on, endsOn: term.ends_on, status: term.status }))} learners={workspace.students.map((student) => ({ id: student.id, name: student.displayName }))} curricula={curriculaResult.data.map((item) => ({ id: item.id, studentId: item.student_id, subject: item.subject, title: item.title, nextSequence: item.next_sequence_number, defaultMinutes: item.default_minutes }))} /></div> : null}

        {view === "autonomy" ? <div className={`${styles.panel} ${styles.autonomyPanel}`}><AutonomySettings familyId={workspace.family.id} initialPreset={workspace.autonomy.preset} initialPolicies={workspace.autonomy.policies} /></div> : null}

        {view === "account" ? <div className={`${styles.panel} ${styles.accountPanel}`}>
          <section><span><CreditCard size={16} />Billing</span><h2>{subscription?.status === "active" ? "Klio membership" : "Prototype access"}</h2><p>{subscription ? `Subscription is ${subscription.status}.` : "Membership tools are ready when billing is connected."}</p><form action="/api/stripe/checkout" method="post"><input type="hidden" name="familyId" value={workspace.family.id} /><button>{subscription?.status === "active" ? "Manage billing" : "Start membership"}</button></form></section>
          <section className={styles.files}><span><FileText size={16} />Files and exports</span><h2>Move records in or out</h2><p>Import earlier grades, inspect source captures, or export this year.</p><nav><Link href="/app/import"><Upload size={15} /><span><strong>Import grades</strong><small>Add a CSV</small></span></Link><Link href="/app/evidence"><FileText size={15} /><span><strong>All captures</strong><small>Photos, notes, and files</small></span></Link><a href={`/api/export?familyId=${workspace.family.id}&from=${year}-01-01&to=${year}-12-31`}><Download size={15} /><span><strong>Export this year</strong><small>Family portfolio file</small></span></a></nav></section>
          <section><span><ShieldCheck size={16} />Privacy</span><h2>Your family record stays authoritative</h2><p>Source records are preserved. Klio-inferred grades never become official without the confirmation required by your policy.</p><Link className={styles.textLink} href="/privacy">Read the privacy summary<ChevronRight size={14} /></Link></section>
        </div> : null}
      </section>
    </main>
  );
}

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function stageLabel(value: string | null) { return ({ "pre-k": "Pre-K", "k-2": "Grades K–2", "3-5": "Grades 3–5", "6-8": "Grades 6–8", "9-12": "Grades 9–12", other: "Mixed stage" } as Record<string,string>)[value ?? ""] ?? "Learning stage"; }
function formatWeekdays(days: number[]) { const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; return days.map((day) => labels[day]).join(" · "); }
