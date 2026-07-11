import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({ familyId: z.uuid() });

export async function GET(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: "A family is required." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id")
      .eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });

    const { data, error } = await supabase.from("agent_jobs")
      .select("id, status, total_actions, completed_actions, failed_actions, error_message, created_at, completed_at, agent_job_actions(id, intent, status, error_message)")
      .eq("family_id", parsed.data.familyId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw error;
    return NextResponse.json({ jobs: data.map((job) => ({
      id: job.id,
      status: job.status,
      totalActions: job.total_actions,
      completedActions: job.completed_actions,
      failedActions: job.failed_actions,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      completedAt: job.completed_at,
      actions: job.agent_job_actions.map((action) => ({
        id: action.id,
        intent: action.intent,
        status: action.status,
        errorMessage: action.error_message,
      })),
    })) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not load processing status." }, { status: 500 });
  }
}
