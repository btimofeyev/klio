import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { calculateCurriculumPace, findCrowdedOutSubjects, type PaceCheckpoint } from "./calculate";
import { dateInTimezone } from "@/lib/schedule/dates";

export async function refreshFamilyPacingCheckpoints(input: { familyId: string; studentId?: string | null; asOfDate?: string }) {
  const admin = createAdminClient();
  const family = await admin.from("families").select("timezone").eq("id", input.familyId).single();
  if (family.error) throw family.error;
  const asOfDate = input.asOfDate ?? dateInTimezone(new Date(), family.data.timezone);
  let targetsQuery = admin.from("curriculum_pacing_targets").select("id,student_id,term_id,curriculum_unit_id,goal_id,starts_on,target_completion_date,start_sequence,target_sequence,weekly_cadence,weekly_effort_minutes,status,learning_goals(status),academic_terms(starts_on,ends_on)")
    .eq("family_id", input.familyId).eq("status", "active").not("goal_id", "is", null).limit(100);
  if (input.studentId) targetsQuery = targetsQuery.eq("student_id", input.studentId);
  const targets = await targetsQuery;
  if (targets.error) throw targets.error;
  const results = [];
  for (const target of targets.data) {
    if (!target.goal_id) continue;
    const term = Array.isArray(target.academic_terms) ? target.academic_terms[0] : target.academic_terms;
    const goal = Array.isArray(target.learning_goals) ? target.learning_goals[0] : target.learning_goals;
    if (!term || !goal) continue;
    const [student, weekdays, overrides, assignments, previous] = await Promise.all([
      admin.from("students").select("daily_capacity_minutes").eq("family_id", input.familyId).eq("id", target.student_id).single(),
      admin.from("academic_term_weekdays").select("weekday").eq("family_id", input.familyId).eq("term_id", target.term_id).order("weekday"),
      admin.from("instructional_day_overrides").select("instructional_date,is_instructional,available_minutes").eq("family_id", input.familyId).eq("term_id", target.term_id),
      admin.from("assignments").select("id,sequence_number,status,scheduled_date,due_at,estimated_minutes,assignment_reviews(id,status,grading_state,written_review_required,written_review_completed)")
        .eq("family_id", input.familyId).eq("student_id", target.student_id).eq("curriculum_unit_id", target.curriculum_unit_id)
        .gte("sequence_number", target.start_sequence).lte("sequence_number", target.target_sequence).limit(Math.min(10_000, target.target_sequence - target.start_sequence + 1)),
      admin.from("pacing_checkpoints").select("as_of_date,expected_value,actual_value,state,feasible,overdue_count").eq("family_id", input.familyId).eq("goal_id", target.goal_id).lt("as_of_date", asOfDate).order("as_of_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const error = student.error ?? weekdays.error ?? overrides.error ?? assignments.error ?? previous.error;
    if (error) throw error;
    if (!student.data) throw new Error("PACING_STUDENT_NOT_FOUND");
    const prior: PaceCheckpoint | null = previous.data ? {
      asOfDate: previous.data.as_of_date,
      expectedValue: Number(previous.data.expected_value),
      actualValue: Number(previous.data.actual_value),
      state: previous.data.state as PaceCheckpoint["state"],
      feasible: previous.data.feasible,
      overdueCount: previous.data.overdue_count,
    } : null;
    const pace = calculateCurriculumPace({
      asOfDate,
      term: {
        startsOn: term.starts_on,
        endsOn: term.ends_on,
        instructionalWeekdays: (weekdays.data ?? []).map((item) => item.weekday),
        overrides: (overrides.data ?? []).map((item) => ({ date: item.instructional_date, isInstructional: item.is_instructional, availableMinutes: item.available_minutes })),
      },
      goalStatus: goal.status as "draft" | "active" | "paused" | "blocked" | "completed" | "cancelled",
      target: {
        startsOn: target.starts_on,
        targetCompletionDate: target.target_completion_date,
        startSequence: target.start_sequence,
        targetSequence: target.target_sequence,
        weeklyCadence: target.weekly_cadence,
        weeklyEffortMinutes: target.weekly_effort_minutes,
        status: target.status as "draft" | "active" | "paused" | "completed" | "cancelled",
      },
      assignments: (assignments.data ?? []).map((assignment) => ({
        id: assignment.id,
        sequenceNumber: assignment.sequence_number,
        status: assignment.status as "planned" | "doing" | "submitted" | "completed" | "skipped" | "needs_review",
        scheduledDate: assignment.scheduled_date,
        dueAt: assignment.due_at,
        estimatedMinutes: assignment.estimated_minutes,
        finalizedApprovedEvidence: assignment.assignment_reviews.some((review) => review.status === "approved" && review.grading_state === "final" && (!review.written_review_required || review.written_review_completed)),
      })),
      dailyCapacityMinutes: student.data.daily_capacity_minutes,
      previousCheckpoint: prior,
    });
    const saved = await admin.from("pacing_checkpoints").upsert({
      family_id: input.familyId, goal_id: target.goal_id, student_id: target.student_id, pacing_target_id: target.id,
      as_of_date: asOfDate, expected_value: pace.expectedValue, actual_value: pace.actualValue,
      target_value: pace.targetValue, remaining_value: pace.remainingValue, state: pace.state,
      feasible: pace.feasible, projected_completion_date: pace.projectedCompletionDate,
      overdue_count: pace.overdueAssignmentIds.length, planned_record_count: pace.plannedRecordCount,
      approved_evidence_count: pace.approvedEvidenceCount, capacity_minutes_remaining: pace.capacityMinutesRemaining,
      basis: pace.basis,
    }, { onConflict: "goal_id,as_of_date" }).select("id").single();
    if (saved.error) throw saved.error;
    results.push({ checkpointId: saved.data.id, goalId: target.goal_id, studentId: target.student_id, ...pace });
  }
  return results;
}

export async function findFamilyCrowdedOutSubjects(input: { familyId: string; studentId?: string | null; asOfDate?: string }) {
  const admin = createAdminClient();
  const family = await admin.from("families").select("timezone").eq("id", input.familyId).single();
  if (family.error) throw family.error;
  const asOfDate = input.asOfDate ?? dateInTimezone(new Date(), family.data.timezone);
  const weekStart = startOfWeek(asOfDate); const weekEnd = addDays(weekStart, 6);
  let studentsQuery = admin.from("students").select("id,daily_capacity_minutes").eq("family_id", input.familyId).eq("active", true);
  let targetsQuery = admin.from("curriculum_pacing_targets").select("student_id,weekly_effort_minutes,curriculum_units(subject)").eq("family_id", input.familyId).eq("status", "active");
  let assignmentsQuery = admin.from("assignments").select("student_id,subject,estimated_minutes,status").eq("family_id", input.familyId).gte("scheduled_date", weekStart).lte("scheduled_date", weekEnd).not("status", "in", "(skipped)");
  if (input.studentId) { studentsQuery = studentsQuery.eq("id", input.studentId); targetsQuery = targetsQuery.eq("student_id", input.studentId); assignmentsQuery = assignmentsQuery.eq("student_id", input.studentId); }
  const [students, targets, assignments] = await Promise.all([studentsQuery, targetsQuery, assignmentsQuery]);
  const error = students.error ?? targets.error ?? assignments.error;
  if (error) throw error;
  const studentRows = students.data ?? [];
  const targetRows = targets.data ?? [];
  const assignmentRows = assignments.data ?? [];
  return studentRows.flatMap((student) => {
    const studentAssignments = assignmentRows.filter((item) => item.student_id === student.id);
    const scheduledTotal = studentAssignments.reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0);
    const capacityRatio = scheduledTotal / Math.max(1, student.daily_capacity_minutes * 5);
    const expectedBySubject = new Map<string, number>();
    for (const target of targetRows.filter((item) => item.student_id === student.id)) {
      const curriculum = Array.isArray(target.curriculum_units) ? target.curriculum_units[0] : target.curriculum_units;
      if (curriculum?.subject) expectedBySubject.set(curriculum.subject, (expectedBySubject.get(curriculum.subject) ?? 0) + target.weekly_effort_minutes);
    }
    return findCrowdedOutSubjects([...expectedBySubject].map(([subject, expectedWeeklyMinutes]) => ({
      subject, expectedWeeklyMinutes,
      scheduledWeeklyMinutes: studentAssignments.filter((item) => item.subject === subject).reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0),
      learnerCapacityConsumedRatio: capacityRatio,
    }))).map((item) => ({ studentId: student.id, ...item }));
  });
}

function startOfWeek(date: string) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return value.toISOString().slice(0, 10); }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
