import { notFound } from "next/navigation";
import { requireParent } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { PracticePlayer } from "@/components/practice-player";

export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  await requireParent();
  const supabase = await createClient();
  const { data: session } = await supabase.from("practice_sessions").select("id, student_id, spec, status, students(display_name)").eq("id", (await params).id).maybeSingle();
  if (!session || typeof session.spec !== "object" || Array.isArray(session.spec)) notFound();
  const spec = session.spec as unknown as { instructions: string; mastery_percent: number; questions: Array<{ prompt: string; choices: string[]; hints: string[] }> };
  return <PracticePlayer sessionId={session.id} learnerName={session.students?.display_name ?? "Learner"} spec={spec} completed={session.status === "completed"} />;
}
