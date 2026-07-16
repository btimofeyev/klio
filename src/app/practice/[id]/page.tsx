import { notFound } from "next/navigation";
import { requireParent } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { PracticePlayer } from "@/components/practice-player";
import { normalizePracticeSpec } from "@/lib/practice/spec";

export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  await requireParent();
  const supabase = await createClient();
  const { data: session } = await supabase.from("practice_sessions").select("id, student_id, spec, status, students(display_name)").eq("id", (await params).id).maybeSingle();
  if (!session || !["ready", "in_progress", "completed"].includes(session.status)) notFound();
  const spec = normalizePracticeSpec(session.spec);
  if (!spec) notFound();
  return <PracticePlayer sessionId={session.id} learnerName={session.students?.display_name ?? "Learner"} spec={spec} completed={session.status === "completed"} />;
}
