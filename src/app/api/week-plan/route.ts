import { NextResponse } from "next/server";
import { z } from "zod";
import { buildFirstWeekAssignments, type FirstWeekAssignment } from "@/lib/assignments/first-week";
import { learnerWeekdays, scheduleDates } from "@/lib/assignments/dates";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  familyId: z.uuid(),
  anchorDate: z.iso.date(),
}).strict();

type LearnerPlan = {
  studentId: string;
  displayName: string;
  dates: string[];
  subjectCount: number;
  existingCount: number;
  plan: FirstWeekAssignment[];
};

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a week and try again." }, { status: 400 });
    const input = parsed.data;
    const supabase = await createClient();

    const [membership, family, students, units] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", input.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("families").select("id,available_days").eq("id", input.familyId).maybeSingle(),
      supabase.from("students").select("id,display_name,daily_capacity_minutes,schedule_preferences").eq("family_id", input.familyId).eq("active", true).order("created_at"),
      supabase.from("curriculum_units").select("id,student_id,subject,title,sequence_label,next_sequence_number,default_minutes,schedule_rule,curriculum_url").eq("family_id", input.familyId).eq("status", "active").order("subject"),
    ]);
    if (!membership.data || !family.data) return NextResponse.json({ error: "You do not have access to this family." }, { status: 403 });
    if (students.error) throw students.error;
    if (units.error) throw units.error;
    if (!students.data.length) return NextResponse.json({ error: "Add a learner before Klio builds the family week.", code: "NO_LEARNERS" }, { status: 409 });
    const familyDays = family.data.available_days;

    const learnerDates = new Map(students.data.map((student) => [
      student.id,
      currentOrNextLearningWeek(input.anchorDate, learnerWeekdays(student.schedule_preferences, familyDays)),
    ]));
    const allDates = [...learnerDates.values()].flat().sort();
    const existing = await supabase.from("assignments")
      .select("student_id,curriculum_unit_id,scheduled_date,estimated_minutes,status")
      .eq("family_id", input.familyId)
      .gte("scheduled_date", allDates[0]).lte("scheduled_date", allDates.at(-1)!);
    if (existing.error) throw existing.error;

    const needsSetup: Array<{ studentId: string; displayName: string }> = [];
    const learnerPlans: LearnerPlan[] = [];
    for (const student of students.data) {
      const studentUnits = units.data.filter((unit) => unit.student_id === student.id);
      if (!studentUnits.length) {
        needsSetup.push({ studentId: student.id, displayName: student.display_name });
        continue;
      }
      const dates = learnerDates.get(student.id)!;
      const studentExisting = existing.data.filter((item) => item.student_id === student.id && item.scheduled_date && dates.includes(item.scheduled_date));
      const plan = buildFirstWeekAssignments({
        units: studentUnits.map((unit) => ({
          id: unit.id,
          subject: unit.subject,
          title: unit.title,
          sequenceLabel: unit.sequence_label,
          nextSequenceNumber: unit.next_sequence_number,
          defaultMinutes: unit.default_minutes,
          weeklyFrequency: scheduleFrequency(unit.schedule_rule),
          curriculumUrl: unit.curriculum_url,
          scheduledTime: scheduleTime(unit.schedule_rule),
        })),
        dates,
        existing: studentExisting.map((item) => ({ curriculumUnitId: item.curriculum_unit_id, scheduledDate: item.scheduled_date, estimatedMinutes: item.estimated_minutes, status: item.status })),
        dailyCapacityMinutes: student.daily_capacity_minutes,
      });
      const expectedCount = studentUnits.reduce((sum, unit) => {
        const existingCount = studentExisting.filter((item) => item.curriculum_unit_id === unit.id && item.status !== "skipped").length;
        return sum + Math.max(0, Math.min(scheduleFrequency(unit.schedule_rule), dates.length) - existingCount);
      }, 0);
      if (plan.length < expectedCount) {
        return NextResponse.json({
          error: `${student.display_name}’s subject frequencies need more weekly learning time. Increase that learner’s daily limit or lower a subject frequency.`,
          code: "FREQUENCY_OVER_CAPACITY",
          studentId: student.id,
        }, { status: 409 });
      }
      learnerPlans.push({
        studentId: student.id,
        displayName: student.display_name,
        dates,
        subjectCount: studentUnits.length,
        existingCount: studentExisting.filter((item) => item.status !== "skipped").length,
        plan,
      });
    }

    if (!learnerPlans.length) {
      return NextResponse.json({
        error: "Set up subjects for at least one learner before Klio builds the family week.",
        code: "NO_CURRICULUM",
        needsSetup,
      }, { status: 409 });
    }

    const plannedItems = learnerPlans.flatMap((learnerPlan) => learnerPlan.plan.map((item) => ({ ...item, studentId: learnerPlan.studentId })));
    let insertedAssignments: Array<{ id: string; student_id: string; curriculum_unit_id: string | null; title: string; subject: string; scheduled_date: string | null; scheduled_time: string | null; estimated_minutes: number | null }> = [];
    if (plannedItems.length) {
      const assignments = await supabase.from("assignments").insert(plannedItems.map((item) => ({
        family_id: input.familyId,
        student_id: item.studentId,
        curriculum_unit_id: item.curriculumUnitId,
        created_by: parent.id,
        created_by_type: "agent" as const,
        title: item.title,
        subject: item.subject,
        sequence_number: item.sequenceNumber,
        status: "planned" as const,
        scheduled_date: item.scheduledDate,
        scheduled_time: item.scheduledTime,
        estimated_minutes: item.estimatedMinutes,
        source_kind: "agent" as const,
      }))).select("id,student_id,curriculum_unit_id,title,subject,scheduled_date,scheduled_time,estimated_minutes");
      if (assignments.error) throw assignments.error;
      insertedAssignments = assignments.data;

      const sourceByAssignment = new Map(plannedItems.map((item) => [`${item.studentId}:${item.curriculumUnitId}:${item.title}`, item]));
      const placements = await supabase.from("weekly_plan_items").insert(insertedAssignments.map((assignment, position) => {
        const source = sourceByAssignment.get(`${assignment.student_id}:${assignment.curriculum_unit_id}:${assignment.title}`)!;
        return {
          family_id: input.familyId,
          student_id: assignment.student_id,
          assignment_id: assignment.id,
          artifact_id: null,
          title: assignment.title,
          subject: assignment.subject,
          scheduled_date: assignment.scheduled_date,
          scheduled_time: assignment.scheduled_time,
          estimated_minutes: assignment.estimated_minutes,
          curriculum_url: source.curriculumUrl,
          source_kind: "klio",
          position,
        };
      }));
      if (placements.error) {
        await supabase.from("assignments").delete().in("id", insertedAssignments.map((assignment) => assignment.id)).eq("family_id", input.familyId);
        throw placements.error;
      }

      const counts = new Map<string, number>();
      for (const item of plannedItems) counts.set(item.curriculumUnitId, (counts.get(item.curriculumUnitId) ?? 0) + 1);
      const unitUpdates = await Promise.all(units.data.map((unit) => {
        const count = counts.get(unit.id) ?? 0;
        return count ? supabase.from("curriculum_units").update({ next_sequence_number: unit.next_sequence_number + count }).eq("id", unit.id).eq("family_id", input.familyId).eq("student_id", unit.student_id) : Promise.resolve();
      }));
      const failedUpdate = unitUpdates.find((result) => result && result.error);
      if (failedUpdate?.error) throw failedUpdate.error;
    }

    const summaries = learnerPlans.map((learnerPlan) => ({
      studentId: learnerPlan.studentId,
      displayName: learnerPlan.displayName,
      weekStart: learnerPlan.dates[0],
      assignmentCount: learnerPlan.plan.length,
      totalAssignmentCount: learnerPlan.existingCount + learnerPlan.plan.length,
      subjectCount: learnerPlan.subjectCount,
      adjustedMinutes: learnerPlan.plan.length ? Math.min(...learnerPlan.plan.map((item) => item.estimatedMinutes)) : null,
      alreadyPlanned: learnerPlan.plan.length === 0,
    }));

    await writeAuditEvent(createAdminClient(), {
      familyId: input.familyId,
      actorId: parent.id,
      actorType: "parent",
      action: "week_plan.built",
      entityType: "family",
      entityId: input.familyId,
      metadata: { assignment_count: insertedAssignments.length, week_start: allDates[0], learners: summaries.map((item) => ({ student_id: item.studentId, assignment_count: item.assignmentCount })) },
    });
    return NextResponse.json({
      learners: summaries,
      needsSetup,
      weekStart: allDates[0],
      assignmentCount: summaries.reduce((sum, item) => sum + item.assignmentCount, 0),
      totalAssignmentCount: summaries.reduce((sum, item) => sum + item.totalAssignmentCount, 0),
      subjectCount: summaries.reduce((sum, item) => sum + item.subjectCount, 0),
    }, { status: insertedAssignments.length ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    console.error("week-plan failed", error);
    return NextResponse.json({ error: "Klio could not build the family week. Your curriculum is still safe." }, { status: 500 });
  }
}

function currentOrNextLearningWeek(anchorDate: string, weekdays: number[]) {
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  let dates = scheduleDates(monday.toISOString().slice(0, 10), weekdays, weekdays.length).filter((date) => date >= anchorDate);
  if (!dates.length) {
    monday.setUTCDate(monday.getUTCDate() + 7);
    dates = scheduleDates(monday.toISOString().slice(0, 10), weekdays, weekdays.length);
  }
  return dates;
}

function scheduleTime(rule: unknown) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const value = "scheduledTime" in rule ? rule.scheduledTime : null;
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function scheduleFrequency(rule: unknown) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return 5;
  const value = "weeklyFrequency" in rule ? Number(rule.weeklyFrequency) : 5;
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : 5;
}
