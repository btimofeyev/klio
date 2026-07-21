import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpenText, FileText } from "lucide-react";
import { LearnerSetupForm } from "@/components/learner-setup-form";
import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { parseSchedulePreferences } from "@/lib/schedule/availability";
import { validateAttentionMode } from "@/lib/schedule/parent-attention";
import styles from "./learner-editor.module.css";

export default async function LearnerSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const student = workspace.students.find((item) => item.id === id);
  if (!student) notFound();

  const supabase = await createClient();
  const [studentResult, subjectsResult, curriculumResult] = await Promise.all([
    supabase.from("students").select("schedule_preferences").eq("id", id).eq("family_id", workspace.family.id).eq("active", true).maybeSingle(),
    supabase.from("student_subjects").select("id,student_id,name,course_name,weekly_frequency,position").eq("family_id", workspace.family.id).eq("status", "active").order("position"),
    supabase.from("curriculum_units").select("id,subject,title,target_lesson_count,default_minutes,attention_mode,parent_attention_minutes,publisher,product_name,grade_label,edition_label,isbn").eq("family_id", workspace.family.id).eq("student_id", id).neq("status", "archived"),
  ]);
  if (studentResult.error) throw studentResult.error;
  if (subjectsResult.error) throw subjectsResult.error;
  if (curriculumResult.error) throw curriculumResult.error;
  if (!studentResult.data) notFound();

  const learnerNames = new Map(workspace.students.map((item) => [item.id, item.displayName]));
  const familySubjects = [...subjectsResult.data.reduce((groups, subject) => {
    const key = subject.name.toLowerCase();
    const current = groups.get(key) ?? { name: subject.name, weeklyFrequency: subject.weekly_frequency, usedBy: [] as string[] };
    const learnerName = learnerNames.get(subject.student_id);
    if (learnerName && !current.usedBy.includes(learnerName)) current.usedBy.push(learnerName);
    groups.set(key, current);
    return groups;
  }, new Map<string, { name: string; weeklyFrequency: number; usedBy: string[] }>()).values()].sort((a, b) => a.name.localeCompare(b.name));
  const subjects = subjectsResult.data.filter((subject) => subject.student_id === id).map((subject) => {
    const title = subject.course_name || subject.name;
    const curriculum = curriculumResult.data.find((unit) => unit.subject.toLowerCase() === subject.name.toLowerCase() && unit.title.toLowerCase() === title.toLowerCase());
    return { id: subject.id, name: subject.name, courseName: subject.course_name ?? "", weeklyFrequency: subject.weekly_frequency, targetLessonCount: curriculum?.target_lesson_count ?? 100, estimatedMinutes: curriculum?.default_minutes ?? 40, attentionMode: curriculum ? validateAttentionMode(curriculum.attention_mode) : "unspecified" as const, parentAttentionMinutes: curriculum?.parent_attention_minutes ?? null, publisher: curriculum?.publisher ?? "", productName: curriculum?.product_name ?? "", gradeLabel: curriculum?.grade_label ?? "", editionLabel: curriculum?.edition_label ?? "", isbn: curriculum?.isbn ?? "" };
  });

  const schedule = parseSchedulePreferences(studentResult.data.schedule_preferences, workspace.family.available_days);
  return <main className={`fixed-dashboard ${styles.dashboard}`}>
    <header className={styles.header}>
      <div className={styles.identity}>
        <Link className={styles.back} href="/app/settings" aria-label="All learners"><ArrowLeft size={16} /><span>Students</span></Link>
        <span className={styles.avatar} aria-hidden="true">{student.displayName.charAt(0)}</span>
        <div className={styles.title}>
          <span>Learning setup</span>
          <h1>{student.displayName}</h1>
          <p>{stageLabel(student.gradeBand)} · {subjects.length} {subjects.length === 1 ? "subject" : "subjects"} · {student.dailyCapacityMinutes ?? 180} minutes a day</p>
        </div>
      </div>
      <div className={styles.headerActions}>
        <Link href={`/app/assignments?student=${student.id}`}><BookOpenText size={15} />Curriculum &amp; lessons</Link>
        <Link className={styles.recordsAction} href={`/app/records?student=${student.id}`}><FileText size={15} />View records</Link>
      </div>
    </header>
    <section className={styles.viewport} aria-label={`${student.displayName} learning setup`}>
      <LearnerSetupForm familyId={workspace.family.id} familySubjects={familySubjects} learner={{ id: student.id, displayName: student.displayName, gradeBand: student.gradeBand, learningPreferences: student.learningPreferences, dailyCapacityMinutes: student.dailyCapacityMinutes ?? 180, learningDays: schedule.learningDays, teachingWindows: schedule.teachingWindows, subjects }} />
    </section>
  </main>;
}

function stageLabel(value: string | null) { return ({ "pre-k": "Pre-K", "k-2": "Grades K–2", "3-5": "Grades 3–5", "6-8": "Grades 6–8", "9-12": "Grades 9–12", other: "Mixed stage" } as Record<string,string>)[value ?? ""] ?? "Learning stage"; }
