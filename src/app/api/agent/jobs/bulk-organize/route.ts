import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { enqueueAgentJob, safelyProcessAgentJob } from "@/lib/agent/jobs";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ familyId: z.uuid(), evidenceIds: z.array(z.uuid()).min(1).max(40) });

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const rate = checkRateLimit(`bulk-organize:${parent.id}`, 4, 10 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "A bulk organization pass is already underway." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose up to 40 unfiled records." }, { status: 400 });
    const supabase = await createClient();
    const [{ data: membership }, { data: evidence, error }] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("evidence_items").select("id, evidence_students(student_id), evidence_categories(category_id)").eq("family_id", parsed.data.familyId).in("id", parsed.data.evidenceIds),
    ]);
    if (!membership) return NextResponse.json({ error: "You do not have access to those records." }, { status: 403 });
    if (error) throw error;
    const unfiled = (evidence ?? []).filter((item) => !item.evidence_categories.length && item.evidence_students[0]);
    if (!unfiled.length) return NextResponse.json({ error: "Those records are already organized." }, { status: 409 });

    const jobs: Awaited<ReturnType<typeof enqueueAgentJob>>[] = [];
    for (const item of unfiled) {
      jobs.push(await enqueueAgentJob({
        familyId: parsed.data.familyId,
        parentId: parent.id,
        studentId: item.evidence_students[0].student_id,
        evidenceIds: [item.id],
        intents: ["organize"],
      }));
    }
    after(async () => { for (const job of jobs) await safelyProcessAgentJob(job.id); });
    return NextResponse.json({ queued: jobs.length, jobIds: jobs.map((job) => job.id) }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not queue those records." }, { status: 500 });
  }
}
