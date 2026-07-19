import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  loadCurriculumAssignmentPage,
  loadOperationsWorkspace,
  type OperationsBaseWorkspace,
} from "@/lib/data/operations";

const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let userId = "";
let familyId = "";
let studentId = "";
let unitId = "";
let artifactId = "";
let artifactAssignmentId = "";
let reviewedAssignmentId = "";
let adjustedAssignmentId = "";
let workspace: OperationsBaseWorkspace;

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `operation-pages-${crypto.randomUUID()}@example.test`, password: "KlioOperationPages123", email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Assignment pagination integration", created_by: userId, timezone: "UTC", available_days: [1, 2, 3, 4, 5] }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const member = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, role: "owner" });
  if (member.error) throw member.error;
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "Pagination learner" }).select("id").single();
  if (student.error) throw student.error;
  studentId = student.data.id;
  const unit = await admin.from("curriculum_units").insert({ family_id: familyId, student_id: studentId, created_by: userId, subject: "Math", title: "Pagination Math", attention_mode: "flexible", parent_attention_minutes: 10 }).select("id,student_id,subject,title,sequence_label,next_sequence_number,default_minutes,status,schedule_rule,curriculum_url,attention_mode,parent_attention_minutes").single();
  if (unit.error) throw unit.error;
  unitId = unit.data.id;

  for (let batchStart = 0; batchStart < 5100; batchStart += 500) {
    const count = Math.min(500, 5100 - batchStart);
    const inserted = await admin.from("assignments").insert(Array.from({ length: count }, (_, index) => ({
      family_id: familyId,
      student_id: studentId,
      created_by: userId,
      title: `Historical lesson ${batchStart + index + 1}`,
      subject: "History",
      scheduled_date: "2020-01-01",
      scheduled_time: index % 2 ? "09:00" : null,
    })));
    if (inserted.error) throw inserted.error;
  }

  const boundaryAssignments = await admin.from("assignments").insert([
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Week Monday edge", subject: "Calendar", scheduled_date: "2026-07-13", scheduled_time: "08:00" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Today exact", subject: "Calendar", scheduled_date: "2026-07-18", scheduled_time: null },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Week Sunday edge", subject: "Calendar", scheduled_date: "2026-07-19", scheduled_time: "10:00" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Before selected week", subject: "Calendar", scheduled_date: "2026-07-12" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "After selected week", subject: "Calendar", scheduled_date: "2026-07-20" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Month grid first", subject: "Calendar", scheduled_date: "2026-07-27" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Month grid last", subject: "Calendar", scheduled_date: "2026-09-06" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Before month grid", subject: "Calendar", scheduled_date: "2026-07-26" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "After month grid", subject: "Calendar", scheduled_date: "2026-09-07" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Artifact after placement 120", subject: "Calendar", scheduled_date: "2026-07-15" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Reviewed outside window", subject: "Review", scheduled_date: "2024-03-01", status: "needs_review", submitted_at: "2026-07-01T12:00:00Z" },
    { family_id: familyId, student_id: studentId, created_by: userId, title: "Adjusted outside window", subject: "Schedule", scheduled_date: "2024-04-01" },
  ].map((row) => ({ status: "planned", ...row }))).select("id,title");
  if (boundaryAssignments.error) throw boundaryAssignments.error;
  artifactAssignmentId = boundaryAssignments.data.find((row) => row.title === "Artifact after placement 120")!.id;
  reviewedAssignmentId = boundaryAssignments.data.find((row) => row.title === "Reviewed outside window")!.id;
  adjustedAssignmentId = boundaryAssignments.data.find((row) => row.title === "Adjusted outside window")!.id;

  for (let batchStart = 0; batchStart < 125; batchStart += 50) {
    const count = Math.min(50, 125 - batchStart);
    const inserted = await admin.from("assignments").insert(Array.from({ length: count }, (_, index) => ({
      family_id: familyId,
      student_id: studentId,
      curriculum_unit_id: unitId,
      created_by: userId,
      title: `Pagination Math · Lesson ${batchStart + index + 1}`,
      subject: "Math",
      sequence_number: batchStart + index + 1,
      estimated_minutes: 40,
      status: batchStart + index < 25 ? "completed" : "planned",
    })));
    if (inserted.error) throw inserted.error;
  }

  const artifact = await admin.from("artifacts").insert({ family_id: familyId, student_id: studentId, created_by: userId, type: "lesson", title: "Targeted placement artifact", content: {}, status: "approved" }).select("id").single();
  if (artifact.error) throw artifact.error;
  artifactId = artifact.data.id;
  const placements = await admin.from("weekly_plan_items").insert(Array.from({ length: 121 }, (_, index) => ({
    family_id: familyId,
    artifact_id: artifactId,
    student_id: studentId,
    assignment_id: index === 120 ? artifactAssignmentId : null,
    title: `Placement ${index + 1}`,
    subject: "Calendar",
    scheduled_date: "2026-07-15",
    position: index,
  }))).select("id,artifact_id,assignment_id,student_id,scheduled_date,scheduled_time,title,description,estimated_minutes,subject,curriculum_url,source_kind,rescheduled_count,completed_at,position");
  if (placements.error) throw placements.error;

  const submission = await admin.from("assignment_submissions").insert({ family_id: familyId, assignment_id: reviewedAssignmentId, student_id: studentId, submitted_by: userId, status: "ready_for_review", note: "Out-of-window review source" }).select("id").single();
  if (submission.error) throw submission.error;
  const review = await admin.from("assignment_reviews").insert({ family_id: familyId, assignment_id: reviewedAssignmentId, submission_id: submission.data.id, student_id: studentId, status: "draft", draft_feedback: "Targeted review hydration" });
  if (review.error) throw review.error;
  const version = await admin.from("families").select("agent_context_version").eq("id", familyId).single();
  if (version.error) throw version.error;
  const adjustment = await admin.from("adjustment_proposals").insert({ family_id: familyId, student_id: studentId, week_start: "2026-07-13", reason: "Targeted hydration", summary: "Move an old assignment", status: "proposed", snapshot_version: version.data.agent_context_version }).select("id").single();
  if (adjustment.error) throw adjustment.error;
  const action = await admin.from("adjustment_actions").insert({ family_id: familyId, proposal_id: adjustment.data.id, assignment_id: adjustedAssignmentId, action_type: "move", before_state: { scheduledDate: "2024-04-01" }, after_state: { scheduledDate: "2026-07-16" }, position: 0 });
  if (action.error) throw action.error;

  workspace = {
    family: { id: familyId, name: "Assignment pagination integration", timezone: "UTC", available_days: [1, 2, 3, 4, 5] },
    students: [{ id: studentId, displayName: "Pagination learner", gradeBand: null, learningPreferences: null, dailyCapacityMinutes: 180, schedulePreferences: {} }],
    insights: [],
    scheduleItems: placements.data.slice(0, 120).map((row) => ({ id: row.id, artifactId: row.artifact_id, assignmentId: row.assignment_id, studentId: row.student_id, scheduledDate: row.scheduled_date, scheduledTime: row.scheduled_time, title: row.title, description: row.description, estimatedMinutes: row.estimated_minutes, subject: row.subject, curriculumUrl: row.curriculum_url, sourceKind: row.source_kind, rescheduledCount: row.rescheduled_count, completedAt: row.completed_at, position: row.position, artifact: null })),
  } as unknown as OperationsBaseWorkspace;
}, 120_000);

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}, 120_000);

describe("surface-scoped assignment loading", () => {
  it("loads exact day, week, and visible month-grid ranges despite more than 5,000 historical rows", async () => {
    const day = await loadOperationsWorkspace({ surface: "today", anchorDate: "2026-07-18" }, workspace, admin, new Date("2026-07-18T12:00:00Z"));
    expect(day.assignments.map((row) => row.title)).toEqual(["Today exact", "Adjusted outside window"]);
    expect(day.assignments.map((row) => row.title)).not.toEqual(expect.arrayContaining(["Before selected week", "After selected week", "Historical lesson 1"]));

    const week = await loadOperationsWorkspace({ surface: "week", anchorDate: "2026-07-16", calendarMode: "week" }, workspace, admin, new Date("2026-07-18T12:00:00Z"));
    expect(week.assignments.map((row) => row.title)).toEqual(expect.arrayContaining(["Week Monday edge", "Today exact", "Week Sunday edge", "Artifact after placement 120", "Adjusted outside window"]));
    expect(week.assignments.map((row) => row.title)).not.toEqual(expect.arrayContaining(["Before selected week", "After selected week", "Historical lesson 1"]));
    expect(week.assignments.find((row) => row.id === artifactAssignmentId)?.artifactId).toBe(artifactId);
    expect(workspace.scheduleItems.some((row) => row.assignmentId === artifactAssignmentId)).toBe(false);

    const month = await loadOperationsWorkspace({ surface: "week", anchorDate: "2026-08-15", calendarMode: "month" }, workspace, admin, new Date("2026-07-18T12:00:00Z"));
    expect(month.assignments.map((row) => row.title)).toEqual(expect.arrayContaining(["Month grid first", "Month grid last", "Adjusted outside window"]));
    expect(month.assignments.map((row) => row.title)).not.toEqual(expect.arrayContaining(["Before month grid", "After month grid", "Historical lesson 1"]));
  }, 60_000);

  it("returns three stable 50/50/25 curriculum pages and exact aggregate totals", async () => {
    const initial = await loadOperationsWorkspace({ surface: "assignments", studentId, curriculumUnitId: unitId }, workspace, admin);
    expect(initial.assignments).toHaveLength(50);
    expect(initial.assignmentPage?.nextCursor).toBeTruthy();
    expect(initial.curriculumUnits.find((unit) => unit.id === unitId)).toMatchObject({ assignmentCount: 125, completedCount: 25, activeCount: 100 });
    const unit = {
      id: unitId, student_id: studentId, subject: "Math", title: "Pagination Math", sequence_label: "Lesson", next_sequence_number: 1,
      default_minutes: 40, status: "active", schedule_rule: {}, curriculum_url: null, attention_mode: "flexible", parent_attention_minutes: 10,
    };
    const second = await loadCurriculumAssignmentPage({ supabase: admin, familyId, unit, cursor: initial.assignmentPage!.nextCursor!, limit: 50 });
    const third = await loadCurriculumAssignmentPage({ supabase: admin, familyId, unit, cursor: second.nextCursor!, limit: 50 });
    expect(second.assignments).toHaveLength(50);
    expect(third.assignments).toHaveLength(25);
    expect(third.nextCursor).toBeNull();
    const all = [...initial.assignments, ...second.assignments, ...third.assignments];
    expect(new Set(all.map((row) => row.id)).size).toBe(125);
    expect(all.map((row) => row.sequenceNumber)).toEqual(Array.from({ length: 125 }, (_, index) => index + 1));
  });

  it("hydrates out-of-window review and adjustment assignment references", async () => {
    const review = await loadOperationsWorkspace({ surface: "review" }, workspace, admin);
    expect(review.assignments.map((row) => row.id)).toContain(reviewedAssignmentId);
    expect(review.assignmentReviews).toHaveLength(1);
    expect(review.submissions).toHaveLength(1);
    expect(review.assignments).toHaveLength(1);

    const adjustments = await loadOperationsWorkspace({ surface: "adjustments" }, workspace, admin);
    expect(adjustments.assignments.map((row) => row.id)).toContain(adjustedAssignmentId);
    expect(adjustments.assignments.some((row) => row.id === reviewedAssignmentId)).toBe(false);
  });
});
