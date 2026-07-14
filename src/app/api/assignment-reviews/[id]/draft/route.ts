import { NextResponse } from "next/server";
import { refreshAssignmentReviewDraft } from "@/lib/assignments/draft-review";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireParentApi();
    const { id } = await context.params;
    const supabase = await createClient();
    const existing = await supabase.from("assignment_reviews").select("id,status").eq("id", id).maybeSingle();
    if (!existing.data) return NextResponse.json({ error: "Review not found." }, { status: 404 });
    if (existing.data.status !== "draft") return NextResponse.json({ error: "That review has already been decided." }, { status: 409 });
    const review = await refreshAssignmentReviewDraft(id);
    return NextResponse.json({ review });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not review that source yet." }, { status: 500 });
  }
}
