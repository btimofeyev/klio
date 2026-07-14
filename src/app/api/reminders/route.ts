import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({ familyId: z.uuid(), sourceEvidenceId: z.uuid() });

export async function GET(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid source." }, { status: 400 });
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You do not have access to that reminder." }, { status: 403 });
    const { data, error } = await supabase.from("reminders").select("id, title, notes, due_at, status, student_id, source_evidence_id, created_at").eq("family_id", parsed.data.familyId).eq("source_evidence_id", parsed.data.sourceEvidenceId).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ reminder: data ? { id: data.id, title: data.title, notes: data.notes, dueAt: data.due_at, status: data.status, studentId: data.student_id, sourceEvidenceId: data.source_evidence_id, createdAt: data.created_at } : null });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not load that reminder." }, { status: 500 });
  }
}
