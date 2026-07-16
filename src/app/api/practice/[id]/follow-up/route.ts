import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { nextLearningDate } from "@/lib/schedule/dates";
import { normalizePracticeSpec } from "@/lib/practice/spec";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const followUpSchema = z.object({
  action: z.enum(["extend_time", "create_more_practice"]),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const body = followUpSchema.parse(await request.json());
    const supabase = await createClient();
    const session = await supabase.from("practice_sessions")
      .select("id,family_id,student_id,artifact_id,spec,status,students(display_name),families(timezone,available_days)")
      .eq("id", (await context.params).id).eq("status", "completed").maybeSingle();
    const spec = session.data ? normalizePracticeSpec(session.data.spec) : null;
    if (session.error) throw session.error;
    if (!session.data || !spec) return NextResponse.json({ error: "Completed practice not found." }, { status: 404 });
    const result = await supabase.from("practice_results").select("id,mastery_met,score,evidence_id").eq("family_id", session.data.family_id).eq("practice_session_id", session.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || result.data.mastery_met) return NextResponse.json({ error: "This practice result does not need a support follow-up." }, { status: 409 });

    if (body.action === "create_more_practice") {
      const active = await supabase.from("practice_sessions")
        .select("id,artifact_id,student_id,status,spec,created_at,completed_at")
        .eq("family_id", session.data.family_id).eq("artifact_id", session.data.artifact_id!)
        .in("status", ["ready", "in_progress"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (active.error) throw active.error;
      const created = active.data ? { data: active.data, error: null } : await supabase.from("practice_sessions").insert({
        family_id: session.data.family_id,
        student_id: session.data.student_id,
        artifact_id: session.data.artifact_id,
        created_by: parent.id,
        spec,
        status: "ready",
      }).select("id,artifact_id,student_id,status,spec,created_at,completed_at").single();
      if (created.error) throw created.error;
      await resolveOutcomeNotes(supabase, session.data.family_id, session.data.id, parent.id);
      await writeAuditEvent(createAdminClient(), { familyId: session.data.family_id, actorId: parent.id, actorType: "parent", action: "practice.follow_up_created", entityType: "practice_session", entityId: created.data.id, metadata: { source_session_id: session.data.id, idempotency_key: body.idempotencyKey } });
      return NextResponse.json({ status: "practice_ready", session: sessionResponse(created.data), duplicate: Boolean(active.data) });
    }

    const learner = session.data.students?.display_name ?? "Learner";
    const family = session.data.families;
    const availableDays = Array.isArray(family?.available_days) ? family.available_days.filter((day): day is string => typeof day === "string") : [];
    const dueDate = nextLearningDate(null, availableDays, family?.timezone ?? "UTC");
    const title = `${learner} · 10 more minutes for ${readableSkill(spec.skill_key)}`.slice(0, 200);
    const existing = await supabase.from("reminders").select("id").eq("family_id", session.data.family_id).eq("student_id", session.data.student_id).eq("title", title).eq("status", "pending").maybeSingle();
    if (existing.error) throw existing.error;
    const reminder = existing.data ? { data: existing.data, error: null } : await supabase.from("reminders").insert({
      family_id: session.data.family_id,
      student_id: session.data.student_id,
      title,
      notes: `Keep ten unhurried minutes open to reteach ${readableSkill(spec.skill_key)} before adding more work.`,
      rationale: `The latest focused practice did not yet meet the ${spec.mastery_percent}% goal.`,
      due_at: `${dueDate}T12:00:00.000Z`,
      status: "pending",
      created_by_type: "parent",
      created_by: parent.id,
    }).select("id").single();
    if (reminder.error) throw reminder.error;
    await resolveOutcomeNotes(supabase, session.data.family_id, session.data.id, parent.id);
    await writeAuditEvent(createAdminClient(), { familyId: session.data.family_id, actorId: parent.id, actorType: "parent", action: "practice.support_time_added", entityType: "reminder", entityId: reminder.data.id, metadata: { source_session_id: session.data.id, due_date: dueDate, idempotency_key: body.idempotencyKey } });
    return NextResponse.json({ status: "time_added", reminderId: reminder.data.id, dueDate, duplicate: Boolean(existing.data) });
  } catch (error) {
    console.error("Practice follow-up failed", error);
    return NextResponse.json({ error: "Klio could not prepare that next step." }, { status: error instanceof z.ZodError ? 400 : 500 });
  }
}

async function resolveOutcomeNotes(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string, practiceSessionId: string, parentId: string) {
  const notes = await supabase.from("klio_insights").select("id,action_ref").eq("family_id", familyId).eq("status", "active").limit(50);
  if (notes.error) throw notes.error;
  const ids = notes.data.filter((item) => {
    const action = item.action_ref && typeof item.action_ref === "object" && !Array.isArray(item.action_ref) ? item.action_ref as Record<string, unknown> : {};
    return action.practiceSessionId === practiceSessionId && action.type === "practice_outcome";
  }).map((item) => item.id);
  if (!ids.length) return;
  const updated = await supabase.from("klio_insights").update({ status: "dismissed", dismissed_by: parentId, dismissed_at: new Date().toISOString() }).eq("family_id", familyId).in("id", ids);
  if (updated.error) throw updated.error;
}

function sessionResponse(session: { id: string; artifact_id: string | null; student_id: string; status: string; spec: unknown; created_at: string; completed_at: string | null }) {
  return { id: session.id, artifactId: session.artifact_id, studentId: session.student_id, status: session.status, spec: normalizePracticeSpec(session.spec), createdAt: session.created_at, completedAt: session.completed_at };
}

function readableSkill(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}
