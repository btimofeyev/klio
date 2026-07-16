import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { buildFamilyWorkspaceSnapshot } from "./snapshot";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
let userId = "";
let familyId = "";
let studentId = "";
let siblingId = "";

beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email: `snapshot-${crypto.randomUUID()}@example.test`, password: "KlioSnapshot123", email_confirm: true });
  if (user.error) throw user.error;
  userId = user.data.user.id;
  const family = await admin.from("families").insert({ name: "Long history family", created_by: userId, timezone: "UTC" }).select("id").single();
  if (family.error) throw family.error;
  familyId = family.data.id;
  const student = await admin.from("students").insert({ family_id: familyId, display_name: "History learner" }).select("id").single();
  if (student.error) throw student.error;
  studentId = student.data.id;
  const sibling = await admin.from("students").insert({ family_id: familyId, display_name: "Sibling learner" }).select("id").single();
  if (sibling.error) throw sibling.error;
  siblingId = sibling.data.id;
  const history = Array.from({ length: 230 }, (_, index) => ({
    family_id: familyId, student_id: studentId, created_by: userId, title: `Historical ${index + 1}`, subject: "History",
    status: "completed" as const, scheduled_date: `2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
    completed_at: "2025-12-31T12:00:00Z", source_kind: "curriculum" as const,
  }));
  for (let index = 0; index < history.length; index += 100) {
    const inserted = await admin.from("assignments").insert(history.slice(index, index + 100));
    if (inserted.error) throw inserted.error;
  }
});

afterAll(async () => {
  if (familyId) await admin.from("families").delete().eq("id", familyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("bounded workspace snapshot relevance", () => {
  it("keeps current, overdue, future, unscheduled, and pending-review work after more than 200 historical assignments", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const shift = (days: number) => { const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
    const inserted = await admin.from("assignments").insert([
      { family_id: familyId, student_id: studentId, created_by: userId, title: "Overdue decision", subject: "Science", status: "planned", scheduled_date: shift(-5) },
      { family_id: familyId, student_id: studentId, created_by: userId, title: "Current week", subject: "Science", status: "doing", scheduled_date: today },
      { family_id: familyId, student_id: studentId, created_by: userId, title: "Future curriculum", subject: "Science", status: "planned", scheduled_date: shift(21) },
      { family_id: familyId, student_id: studentId, created_by: userId, title: "Unscheduled next", subject: "Science", status: "planned", scheduled_date: null },
      { family_id: familyId, student_id: studentId, created_by: userId, title: "Pending review", subject: "Science", status: "submitted", scheduled_date: shift(-1), submitted_at: new Date().toISOString() },
    ]).select("id,title");
    if (inserted.error) throw inserted.error;
    const pending = inserted.data.find((item) => item.title === "Pending review")!;
    const submission = await admin.from("assignment_submissions").insert({ family_id: familyId, assignment_id: pending.id, student_id: studentId, submitted_by: userId, status: "ready_for_review" }).select("id").single();
    if (submission.error) throw submission.error;
    const review = await admin.from("assignment_reviews").insert({ family_id: familyId, assignment_id: pending.id, submission_id: submission.data.id, student_id: studentId, status: "draft", grading_state: "provisional", uncertainty_flags: ["Written response needs review"] }).select("id").single();
    if (review.error) throw review.error;
    const snapshot = await buildFamilyWorkspaceSnapshot({ familyId, studentId });
    const titles = snapshot.snapshot.currentAssignments.map((assignment) => assignment.title);
    expect(titles).toEqual(expect.arrayContaining(["Overdue decision", "Current week", "Future curriculum", "Unscheduled next", "Pending review"]));
    expect(snapshot.snapshot.pendingSubmissions.map((item) => item.id)).toContain(submission.data.id);
    expect(snapshot.snapshot.draftAssignmentReviews.map((item) => item.id)).toContain(review.data.id);
    expect(snapshot.snapshot.assignmentRetrieval.includedCount).toBeLessThanOrEqual(200);
    expect(JSON.parse(snapshot.serialized).approvedWork.every((artifact: Record<string, unknown>) => !("content" in artifact))).toBe(true);
  });

  it("keeps learner focus while making the whole family readable to a parent conversation", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const siblingAssignment = await admin.from("assignments").insert({
      family_id: familyId, student_id: siblingId, created_by: userId, title: "Sibling current science", subject: "Science",
      status: "planned", scheduled_date: today, source_kind: "parent",
    }).select("id").single();
    if (siblingAssignment.error) throw siblingAssignment.error;

    const learnerOnly = await buildFamilyWorkspaceSnapshot({ familyId, studentId });
    expect(learnerOnly.snapshot.students.map((student) => student.id)).toEqual([studentId]);
    expect(learnerOnly.snapshot.currentAssignments.some((assignment) => assignment.student_id === siblingId)).toBe(false);

    const familyConversation = await buildFamilyWorkspaceSnapshot({ familyId, studentId, familyWide: true });
    expect(familyConversation.snapshot.focus).toEqual({ studentId, scope: "family" });
    expect(familyConversation.snapshot.students.map((student) => student.id)).toEqual(expect.arrayContaining([studentId, siblingId]));
    expect(familyConversation.snapshot.currentAssignments.some((assignment) => assignment.id === siblingAssignment.data.id)).toBe(true);
  });
});
