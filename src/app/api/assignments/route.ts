import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { loadCurriculumAssignmentPage } from "@/lib/data/operations";
import { decodeCurriculumAssignmentCursor } from "@/lib/data/operation-assignment-pages";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  familyId: z.uuid(),
  curriculumUnitId: z.uuid(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const curriculumUnitColumns = "id,student_id,subject,title,sequence_label,next_sequence_number,default_minutes,status,schedule_rule,curriculum_url,attention_mode,parent_attention_minutes";

export async function GET(request: Request) {
  try {
    const parent = await requireParentApi();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Check the assignment page request and try again." }, { status: 400 });
    const input = parsed.data;
    if (input.cursor) {
      try {
        decodeCurriculumAssignmentCursor(input.cursor);
      } catch {
        return NextResponse.json({ error: "That assignment page cursor is invalid." }, { status: 400 });
      }
    }

    const supabase = await createClient();
    const membership = await supabase
      .from("family_members")
      .select("family_id")
      .eq("family_id", input.familyId)
      .eq("user_id", parent.id)
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) return NextResponse.json({ error: "You do not have access to this family." }, { status: 403 });

    const unit = await supabase
      .from("curriculum_units")
      .select(curriculumUnitColumns)
      .eq("id", input.curriculumUnitId)
      .eq("family_id", input.familyId)
      .neq("status", "archived")
      .maybeSingle();
    if (unit.error) throw unit.error;
    if (!unit.data) return NextResponse.json({ error: "That curriculum unit was not found." }, { status: 404 });

    const page = await loadCurriculumAssignmentPage({
      supabase,
      familyId: input.familyId,
      unit: unit.data,
      cursor: input.cursor,
      limit: input.limit,
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not load more assignments." }, { status: 500 });
  }
}
