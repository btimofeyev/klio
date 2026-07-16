import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { normalizePracticeSpec } from "@/lib/practice/spec";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const launchSchema = z.object({ artifactId: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const { artifactId } = launchSchema.parse(await request.json());
    const supabase = await createClient();
    const artifact = await supabase.from("artifacts")
      .select("id,family_id,student_id,content,status,type")
      .eq("id", artifactId).eq("status", "approved").eq("type", "practice").maybeSingle();
    if (artifact.error) throw artifact.error;
    const content = artifact.data?.content && typeof artifact.data.content === "object" && !Array.isArray(artifact.data.content)
      ? artifact.data.content as Record<string, unknown> : null;
    const spec = normalizePracticeSpec(content?.practice);
    if (!artifact.data?.student_id || !spec) return NextResponse.json({ error: "This practice is not ready to use." }, { status: 404 });

    const existing = await supabase.from("practice_sessions")
      .select("id,artifact_id,student_id,status,spec,created_at,completed_at")
      .eq("family_id", artifact.data.family_id).eq("artifact_id", artifact.data.id)
      .in("status", ["ready", "in_progress"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ session: sessionResponse(existing.data), duplicate: true });

    const created = await supabase.from("practice_sessions").insert({
      family_id: artifact.data.family_id,
      student_id: artifact.data.student_id,
      artifact_id: artifact.data.id,
      created_by: parent.id,
      spec,
      status: "ready",
    }).select("id,artifact_id,student_id,status,spec,created_at,completed_at").single();
    if (created.error) throw created.error;
    await writeAuditEvent(createAdminClient(), {
      familyId: artifact.data.family_id,
      actorId: parent.id,
      actorType: "parent",
      action: "practice.launched",
      entityType: "practice_session",
      entityId: created.data.id,
      metadata: { artifact_id: artifact.data.id },
    });
    return NextResponse.json({ session: sessionResponse(created.data), duplicate: false }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Klio could not open this practice." }, { status: 400 });
  }
}

function sessionResponse(session: { id: string; artifact_id: string | null; student_id: string; status: string; spec: unknown; created_at: string; completed_at: string | null }) {
  return {
    id: session.id,
    artifactId: session.artifact_id,
    studentId: session.student_id,
    status: session.status,
    spec: normalizePracticeSpec(session.spec),
    createdAt: session.created_at,
    completedAt: session.completed_at,
  };
}
