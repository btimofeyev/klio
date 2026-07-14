import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LearnerSetupForm } from "@/components/learner-setup-form";
import { getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function LearnerSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const student = workspace.students.find((item) => item.id === id);
  if (!student) notFound();

  const supabase = await createClient();
  const [studentResult, subjectsResult] = await Promise.all([
    supabase.from("students").select("schedule_preferences").eq("id", id).eq("family_id", workspace.family.id).eq("active", true).maybeSingle(),
    supabase.from("student_subjects").select("id,student_id,name,course_name,weekly_frequency,position").eq("family_id", workspace.family.id).eq("status", "active").order("position"),
  ]);
  if (studentResult.error) throw studentResult.error;
  if (subjectsResult.error) throw subjectsResult.error;
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
  const subjects = subjectsResult.data.filter((subject) => subject.student_id === id).map((subject) => ({ id: subject.id, name: subject.name, courseName: subject.course_name ?? "", weeklyFrequency: subject.weekly_frequency }));

  return <div className="learner-route-page learner-edit-page">
    <Link className="learner-route-back" href="/app/settings"><ArrowLeft size={15} /> All learners</Link>
    <header className="learner-route-heading"><span className="learner-route-avatar" aria-hidden="true">{student.displayName.charAt(0)}</span><div><p className="eyebrow">Learning setup</p><h1>{student.displayName}</h1><p>Set the subjects, curriculum, and weekly rhythm Klio should use for this learner.</p></div></header>
    <section className="learner-route-paper"><LearnerSetupForm familyId={workspace.family.id} familySubjects={familySubjects} learner={{ id: student.id, displayName: student.displayName, gradeBand: student.gradeBand, learningPreferences: student.learningPreferences, dailyCapacityMinutes: student.dailyCapacityMinutes ?? 180, learningDays: readLearningDays(studentResult.data.schedule_preferences, workspace.family.available_days), subjects }} /></section>
  </div>;
}

function readLearningDays(schedule: unknown, familyDays: unknown) {
  if (schedule && typeof schedule === "object" && !Array.isArray(schedule) && "learningDays" in schedule && Array.isArray(schedule.learningDays)) return schedule.learningDays.filter((day): day is string => typeof day === "string");
  return Array.isArray(familyDays) ? familyDays.filter((day): day is string => typeof day === "string") : ["Mon", "Tue", "Wed", "Thu", "Fri"];
}
