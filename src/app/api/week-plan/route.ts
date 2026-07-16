import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { FamilyWeekPlanError, planFamilyWeek } from "@/lib/assignments/plan-family-week";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  familyId: z.uuid(),
  anchorDate: z.iso.date(),
}).strict();

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a week and try again." }, { status: 400 });
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id")
      .eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership.data) return NextResponse.json({ error: "You do not have access to this family." }, { status: 403 });

    const result = await planFamilyWeek({
      supabase,
      familyId: parsed.data.familyId,
      parentId: parent.id,
      anchorDate: parsed.data.anchorDate,
    });
    return NextResponse.json(result, { status: result.assignmentCount ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (error instanceof FamilyWeekPlanError) {
      return NextResponse.json({ error: error.message, code: error.code, ...error.details }, { status: error.status });
    }
    console.error("week-plan failed", error);
    return NextResponse.json({ error: "Klio could not build the family week. Your curriculum is still safe." }, { status: 500 });
  }
}
