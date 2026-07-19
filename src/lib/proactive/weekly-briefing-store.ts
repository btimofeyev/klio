import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { findFamilyCrowdedOutSubjects } from "@/lib/pacing/refresh";
import { addLocalDays, weeklyBriefingSchedule } from "./weekly-schedule";
import { buildWeeklyFamilyBriefing, type WeeklyFamilyBriefingSnapshot } from "./weekly-briefing";

export async function createWeeklyFamilyBriefing(input: {
  evaluationId: string;
  familyId: string;
  studentId?: string | null;
  idempotencyKey: string;
  now?: Date;
}) {
  const admin = createAdminClient();
  const family = await admin.from("families").select("timezone,available_days").eq("id", input.familyId).maybeSingle();
  if (family.error) throw family.error;
  if (!family.data) return null;
  const now = input.now ?? new Date();
  const weekStart = parseWeekStart(input.idempotencyKey) ?? weeklyBriefingSchedule(now, family.data.timezone)?.weekStart;
  if (!weekStart) throw new Error("WEEKLY_BRIEFING_WEEK_UNAVAILABLE");
  const weekEnd = addLocalDays(weekStart, 6);
  const previousWeekStart = addLocalDays(weekStart, -7);
  const previousWeekEnd = addLocalDays(weekStart, -1);

  let studentsQuery = admin.from("students").select("id,family_id,display_name,daily_capacity_minutes,schedule_preferences,active").eq("family_id", input.familyId).eq("active", true).order("created_at");
  let scheduledQuery = admin.from("assignments").select("id,family_id,student_id,title,subject,status,scheduled_date,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,curriculum_units(attention_mode,parent_attention_minutes)").eq("family_id", input.familyId).gte("scheduled_date", previousWeekStart).lte("scheduled_date", weekEnd).limit(5000);
  let unscheduledQuery = admin.from("assignments").select("id,family_id,student_id,title,subject,status,scheduled_date,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,curriculum_units(attention_mode,parent_attention_minutes)").eq("family_id", input.familyId).is("scheduled_date", null).in("status", ["planned", "doing"]).limit(1000);
  let submissionsQuery = admin.from("assignment_submissions").select("id,family_id,assignment_id,student_id,submitted_at,assignment_reviews(status)").eq("family_id", input.familyId).gte("submitted_at", `${previousWeekStart}T00:00:00.000Z`).lte("submitted_at", `${previousWeekEnd}T23:59:59.999Z`).limit(1000);
  let checkpointsQuery = admin.from("pacing_checkpoints").select("id,family_id,student_id,goal_id,state,feasible,actual_value,expected_value,as_of_date,learning_goals(title)").eq("family_id", input.familyId).lte("as_of_date", weekEnd).order("as_of_date", { ascending: false }).limit(1000);
  let reviewsQuery = admin.from("assignment_reviews").select("id,family_id,student_id,score,reviewed_at,status,grading_state,written_review_required,written_review_completed,assignments(subject)").eq("family_id", input.familyId).eq("status", "approved").eq("grading_state", "final").gte("reviewed_at", `${previousWeekStart}T00:00:00.000Z`).lte("reviewed_at", `${previousWeekEnd}T23:59:59.999Z`).not("score", "is", null).order("reviewed_at").limit(1000);
  let conflictsQuery = admin.from("calendar_conflicts").select("id,family_id,student_id,conflict_date,all_day,starts_at,ends_at,title,note").eq("family_id", input.familyId).gte("conflict_date", weekStart).lte("conflict_date", weekEnd).limit(500);
  if (input.studentId) {
    studentsQuery = studentsQuery.eq("id", input.studentId);
    scheduledQuery = scheduledQuery.eq("student_id", input.studentId);
    unscheduledQuery = unscheduledQuery.eq("student_id", input.studentId);
    submissionsQuery = submissionsQuery.eq("student_id", input.studentId);
    checkpointsQuery = checkpointsQuery.eq("student_id", input.studentId);
    reviewsQuery = reviewsQuery.eq("student_id", input.studentId);
    conflictsQuery = conflictsQuery.or(`student_id.is.null,student_id.eq.${input.studentId}`);
  }
  const [students, scheduled, unscheduled, submissions, checkpoints, reviews, conflicts, crowded] = await Promise.all([
    studentsQuery, scheduledQuery, unscheduledQuery, submissionsQuery, checkpointsQuery, reviewsQuery, conflictsQuery,
    findFamilyCrowdedOutSubjects({ familyId: input.familyId, studentId: input.studentId, asOfDate: weekStart }),
  ]);
  const error = students.error ?? scheduled.error ?? unscheduled.error ?? submissions.error ?? checkpoints.error ?? reviews.error ?? conflicts.error;
  if (error) throw error;
  const latestCheckpoints = [...new Map((checkpoints.data ?? []).map((checkpoint) => [checkpoint.goal_id, checkpoint])).values()];
  const snapshot = buildWeeklyFamilyBriefing({
    familyId: input.familyId,
    weekStart,
    generatedAt: now.toISOString(),
    familyLearningDays: family.data.available_days,
    students: (students.data ?? []).map((student) => ({ familyId: student.family_id, id: student.id, displayName: student.display_name, dailyCapacityMinutes: student.daily_capacity_minutes, schedulePreferences: student.schedule_preferences, active: student.active })),
    assignments: [...(scheduled.data ?? []), ...(unscheduled.data ?? [])].map((assignment) => {
      const curriculum = Array.isArray(assignment.curriculum_units) ? assignment.curriculum_units[0] : assignment.curriculum_units;
      return {
        familyId: assignment.family_id,
        id: assignment.id,
        studentId: assignment.student_id,
        title: assignment.title,
        subject: assignment.subject,
        status: assignment.status,
        scheduledDate: assignment.scheduled_date,
        scheduledTime: assignment.scheduled_time,
        estimatedMinutes: assignment.estimated_minutes,
        attentionMode: assignment.attention_mode,
        parentAttentionMinutes: assignment.parent_attention_minutes,
        curriculumAttentionMode: curriculum?.attention_mode ?? null,
        curriculumParentAttentionMinutes: curriculum?.parent_attention_minutes ?? null,
      };
    }),
    submissions: (submissions.data ?? []).map((submission) => ({
      familyId: submission.family_id, id: submission.id, assignmentId: submission.assignment_id, studentId: submission.student_id, submittedAt: submission.submitted_at,
      awaitingParentReview: !submission.assignment_reviews.some((review) => review.status === "approved"),
    })),
    pacingCheckpoints: latestCheckpoints.map((checkpoint) => {
      const goal = Array.isArray(checkpoint.learning_goals) ? checkpoint.learning_goals[0] : checkpoint.learning_goals;
      return { familyId: checkpoint.family_id, id: checkpoint.id, studentId: checkpoint.student_id, goalId: checkpoint.goal_id, goalTitle: goal?.title ?? "Learning goal", state: checkpoint.state, feasible: checkpoint.feasible, actualValue: Number(checkpoint.actual_value), expectedValue: Number(checkpoint.expected_value) };
    }),
    crowdedSubjects: crowded.map((item) => ({ familyId: input.familyId, studentId: item.studentId, subject: item.subject, scheduledWeeklyMinutes: item.scheduledWeeklyMinutes, expectedWeeklyMinutes: item.expectedWeeklyMinutes, shortfallMinutes: item.shortfallMinutes })),
    reviewedEvidence: (reviews.data ?? []).flatMap((review) => {
      const assignment = Array.isArray(review.assignments) ? review.assignments[0] : review.assignments;
      if (!assignment || review.score === null || !review.reviewed_at) return [];
      return [{ familyId: review.family_id, id: review.id, studentId: review.student_id, subject: assignment.subject, score: Number(review.score), occurredAt: review.reviewed_at, approved: review.status === "approved", final: review.grading_state === "final", writtenReviewRequired: review.written_review_required, writtenReviewCompleted: review.written_review_completed }];
    }),
    conflicts: (conflicts.data ?? []).map((conflict) => ({ id: conflict.id, familyId: conflict.family_id, studentId: conflict.student_id, conflictDate: conflict.conflict_date, allDay: conflict.all_day, startsAt: conflict.starts_at, endsAt: conflict.ends_at, title: conflict.title, note: conflict.note })),
  });
  const evidenceRefs = dedupeRefs([
    ...snapshot.pacing.flatMap((item) => item.evidenceRefs),
    ...snapshot.actions.flatMap((action) => action.evidenceRefs),
  ]);
  const inserted = await admin.from("weekly_briefings").insert({
    family_id: input.familyId,
    evaluation_id: input.evaluationId,
    week_start: weekStart,
    headline: snapshot.headline,
    summary: snapshot.summary,
    sections: snapshot as unknown as Json,
    evidence_refs: evidenceRefs as unknown as Json,
    action_refs: snapshot.actions as unknown as Json,
    generated_at: snapshot.generatedAt,
  }).select("id,status,generated_at").single();
  if (!inserted.error) return { id: inserted.data.id, created: true, snapshot };
  if (inserted.error.code !== "23505") throw inserted.error;
  const existing = await admin.from("weekly_briefings").select("id,status,generated_at,sections").eq("family_id", input.familyId).eq("week_start", weekStart).single();
  if (existing.error) throw existing.error;
  return { id: existing.data.id, created: false, snapshot: normalizeStoredSnapshot(existing.data.sections, snapshot) };
}

function parseWeekStart(idempotencyKey: string) {
  const match = /^weekly-briefing:(\d{4}-\d{2}-\d{2})$/.exec(idempotencyKey);
  return match?.[1] ?? null;
}

function normalizeStoredSnapshot(value: Json, fallback: WeeklyFamilyBriefingSnapshot) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as unknown as WeeklyFamilyBriefingSnapshot : fallback;
}

function dedupeRefs(refs: Array<{ type: string; id: string; [key: string]: unknown }>) {
  return [...new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values()];
}
