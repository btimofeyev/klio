import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelWorkspaceClarification } from "@/lib/agent/workspace/clarification";

const schema = z.object({ action: z.enum(["cancel", "dismiss", "retry"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose cancel or dismiss." }, { status: 400 });
    const { id } = await context.params;
    const supabase = createAdminClient();
    const current = await supabase.from("agent_turns").select("id,family_id,status,last_heartbeat_at").eq("id", id).maybeSingle();
    if (current.error || !current.data) return NextResponse.json({ error: "Work receipt not found." }, { status: 404 });
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", current.data.family_id).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle();
    if (membership.error || !membership.data) return NextResponse.json({ error: "Work receipt not found." }, { status: 404 });
    if (parsed.data.action === "cancel") {
      if (current.data.status === "awaiting_parent") return NextResponse.json(await cancelWorkspaceClarification({ turnId: id, parentId: parent.id }));
      if (current.data.status === "running") {
        const requested = await supabase.from("agent_turns").update({ cancel_requested_at: new Date().toISOString() }).eq("id", id).eq("family_id", current.data.family_id).eq("status", "running");
        if (requested.error) throw requested.error;
        return NextResponse.json({ status: "cancelling" });
      }
      if (current.data.status !== "queued") return NextResponse.json({ error: "This job is no longer active." }, { status: 409 });
      const cancelled = await supabase.from("agent_turns").update({ status: "cancelled", cancel_requested_at: new Date().toISOString(), completed_at: new Date().toISOString(), normalized_step: "paused" }).eq("id", id).eq("family_id", current.data.family_id).eq("status", "queued");
      if (cancelled.error) throw cancelled.error;
      return NextResponse.json({ status: "cancelled" });
    }
    if (parsed.data.action === "retry") {
      const staleRunning = current.data.status === "running" && (!current.data.last_heartbeat_at || Date.now() - new Date(current.data.last_heartbeat_at).getTime() > 45_000);
      if (current.data.status !== "failed" && !staleRunning) return NextResponse.json({ error: "This job is not paused or failed." }, { status: 409 });
      const retried = await supabase.from("agent_turns").update({ status: "queued", attempt_count: 0, completed_at: null, error_code: null, normalized_step: "waiting", last_progress_at: new Date().toISOString() }).eq("id", id).eq("family_id", current.data.family_id).in("status", ["failed", "running"]);
      if (retried.error) throw retried.error;
      return NextResponse.json({ status: "queued" });
    }
    if (["queued", "running"].includes(current.data.status)) return NextResponse.json({ error: "Active work cannot be dismissed." }, { status: 409 });
    const dismissed = await supabase.from("agent_turns").update({ dismissed_at: new Date().toISOString() }).eq("id", id).eq("family_id", current.data.family_id);
    if (dismissed.error) throw dismissed.error;
    return NextResponse.json({ status: "dismissed" });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that receipt." }, { status: 500 });
  }
}
