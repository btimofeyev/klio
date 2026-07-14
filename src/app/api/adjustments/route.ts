import { NextResponse } from "next/server";
import { z } from "zod";
import { buildMoveForwardProposalForAssignments } from "@/lib/assignments/planning";
import { learnerWeekdays, scheduleDates } from "@/lib/assignments/dates";
import { requireParentApi } from "@/lib/auth/require-parent";
import { dateInTimezone } from "@/lib/schedule/dates";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const schema = z.object({
  familyId: z.uuid(),
  studentId: z.uuid(),
  assignmentId: z.uuid().optional(),
  assignmentIds: z.array(z.uuid()).min(1).max(20).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.assignmentId) === Boolean(value.assignmentIds)) {
    context.addIssue({ code: "custom", message: "Choose one assignment or a group of assignments." });
  }
});

export async function POST(request: Request) {
  try {
    await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose work to adjust." }, { status: 400 });
    const supabase = await createClient();
    const family = await supabase.from("families").select("id,agent_context_version,available_days,timezone").eq("id", parsed.data.familyId).maybeSingle();
    if (!family.data) return NextResponse.json({ error: "Family workspace not found." }, { status: 403 });
    const student = await supabase.from("students").select("id,daily_capacity_minutes,schedule_preferences").eq("id", parsed.data.studentId).eq("family_id", parsed.data.familyId).maybeSingle();
    if (!student.data) return NextResponse.json({ error: "Learner not found." }, { status: 404 });
    const assignmentIds = [...new Set(parsed.data.assignmentIds ?? [parsed.data.assignmentId!])];
    const sources = await supabase.from("assignments").select("id,scheduled_date,title,subject").in("id", assignmentIds).eq("family_id", parsed.data.familyId).eq("student_id", parsed.data.studentId);
    if (sources.error) throw sources.error;
    if (sources.data.length !== assignmentIds.length) return NextResponse.json({ error: "Some of that work could not be found." }, { status: 404 });
    if (sources.data.some((item) => !item.scheduled_date)) return NextResponse.json({ error: "Every assignment must be scheduled before Klio can move it." }, { status: 409 });
    const sourceDate = sources.data.map((item) => item.scheduled_date!).sort()[0];
    const currentDate = dateInTimezone(new Date(), family.data.timezone);
    const planningAnchor = sourceDate > currentDate ? sourceDate : currentDate;
    const learningDays = scheduleDates(planningAnchor, learnerWeekdays(student.data.schedule_preferences, family.data.available_days), 10);
    const assignments = await supabase.from("assignments").select("id,title,subject,scheduled_date,estimated_minutes,status,curriculum_unit_id,sequence_number").eq("family_id", parsed.data.familyId).eq("student_id", parsed.data.studentId).gte("scheduled_date", sourceDate).lte("scheduled_date", learningDays.at(-1)!);
    if (assignments.error) throw assignments.error;
    const actions = buildMoveForwardProposalForAssignments({ assignmentIds, assignments: assignments.data.map((item) => ({ id: item.id, title: item.title, subject: item.subject, scheduledDate: item.scheduled_date, estimatedMinutes: item.estimated_minutes, status: item.status as "planned" | "doing" | "submitted" | "completed" | "skipped" | "needs_review", curriculumUnitId: item.curriculum_unit_id, sequenceNumber: item.sequence_number })), learningDays, dailyCapacityMinutes: student.data.daily_capacity_minutes });
    if (!actions.length) return NextResponse.json({ error: "Klio could not find a lower-load move in the next two learning weeks." }, { status: 409 });
    const movedIds = new Set(actions.map((action) => action.assignmentId));
    if (assignmentIds.some((id) => !movedIds.has(id))) return NextResponse.json({ error: "Klio could not fit all unfinished work into the next two learning weeks." }, { status: 409 });
    const source = sources.data.find((item) => item.id === assignmentIds[0])!;
    const laterLessons = actions.filter((action) => action.assignmentId && !assignmentIds.includes(action.assignmentId)).length;
    const sourceCount = assignmentIds.length;
    const reason = sourceCount === 1 ? `${source.title} was not finished as planned.` : `${sourceCount} lessons were not finished as planned.`;
    const summary = sourceCount === 1
      ? laterLessons ? `Move ${source.title} and shift ${laterLessons} later ${source.subject} lesson${laterLessons === 1 ? "" : "s"} to preserve order.` : `Move ${source.title} to the next day with enough room.`
      : laterLessons ? `Move ${sourceCount} unfinished lessons and shift ${laterLessons} later lesson${laterLessons === 1 ? "" : "s"} to preserve course order.` : `Move ${sourceCount} unfinished lessons together into the next open learning days.`;
    const proposal = await supabase.from("adjustment_proposals").insert({ family_id: parsed.data.familyId, student_id: parsed.data.studentId, week_start: learningDays[0], reason, summary, snapshot_version: family.data.agent_context_version }).select("id,status,summary,reason,snapshot_version,week_start").single();
    if (proposal.error) throw proposal.error;
    const inserted = await supabase.from("adjustment_actions").insert(actions.map((action, position) => ({ family_id: parsed.data.familyId, proposal_id: proposal.data.id, assignment_id: action.assignmentId, action_type: action.actionType, before_state: action.beforeState as Json, after_state: action.afterState as Json, position }))).select("id,assignment_id,action_type,before_state,after_state,position,status");
    if (inserted.error) throw inserted.error;
    return NextResponse.json({ proposal: { ...proposal.data, actions: inserted.data } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not draft that adjustment." }, { status: 500 });
  }
}
