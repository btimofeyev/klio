import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { buildCapacityRebalanceProposal, buildMoveForwardProposalForAssignments, type AdjustmentActionDraft } from "@/lib/assignments/planning";
import { learnerWeekdays, scheduleDates } from "@/lib/assignments/dates";
import { dateInTimezone } from "@/lib/schedule/dates";
import { loadAvailabilityByDate } from "@/lib/schedule/availability-data";
import { policyDecision, policyForPreset, sanitizePolicy, type AutonomyPreset } from "@/lib/autonomy/policy";
import { writeAuditEvent } from "@/lib/audit/write-audit-event";
import { enqueueProactiveEvaluation } from "./queue";
import type { Json } from "@/lib/supabase/database.types";
import { arrangeFamilyDay } from "@/lib/schedule/arrange-family-day";
import { findParentAttentionConflicts, resolveAttentionRequirement } from "@/lib/schedule/parent-attention";

export async function recordExplicitCompletion(input: { familyId: string; assignmentId: string; actorId: string; idempotencyKey: string }) {
  const admin = createAdminClient();
  const assignment = await admin.from("assignments").select("id,family_id,student_id,title,status,completed_at")
    .eq("id", input.assignmentId).eq("family_id", input.familyId).maybeSingle();
  if (assignment.error) throw assignment.error;
  if (!assignment.data) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.data.status === "completed") return { status: "completed", assignmentId: assignment.data.id, duplicate: true };
  const now = new Date().toISOString();
  const updated = await admin.from("assignments").update({ status: "completed", completed_at: now })
    .eq("id", assignment.data.id).eq("family_id", input.familyId).select("id,status,completed_at").single();
  if (updated.error) throw updated.error;
  const plan = await admin.from("weekly_plan_items").update({ completed_at: now }).eq("assignment_id", assignment.data.id).eq("family_id", input.familyId);
  if (plan.error) throw plan.error;
  await writeAuditEvent(admin, { familyId: input.familyId, actorId: input.actorId, actorType: "agent", action: "assignment.completion_recorded", entityType: "assignment", entityId: assignment.data.id, metadata: { idempotency_key: input.idempotencyKey, explicit_parent_statement: true } });
  await enqueueProactiveEvaluation({ familyId: input.familyId, studentId: assignment.data.student_id, requestedBy: input.actorId, eventKind: "assignment_completed", entityType: "assignment", entityId: assignment.data.id, idempotencyKey: `completion:${input.idempotencyKey}` });
  return { status: "completed", assignmentId: assignment.data.id, title: assignment.data.title, completedAt: now };
}

export async function organizeDaySchedule(input: {
  familyId: string;
  studentId: string;
  scheduledDate: string;
  actorId: string;
  agentTurnId: string;
  snapshotVersion: number;
  idempotencyKey: string;
  startTime?: string | null;
}) {
  const admin = createAdminClient();
  const existing = await admin.from("adjustment_proposals").select("id,status,summary,undo_status")
    .eq("family_id", input.familyId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return {
    outcome: "completed", proposalId: existing.data.id, summary: existing.data.summary,
    undoAvailable: existing.data.status === "applied" && existing.data.undo_status === "available", duplicate: true,
  };

  const [family, student] = await Promise.all([
    admin.from("families").select("agent_context_version,available_days").eq("id", input.familyId).single(),
    admin.from("students").select("id,display_name,daily_capacity_minutes,schedule_preferences").eq("family_id", input.familyId).eq("id", input.studentId).single(),
  ]);
  const error = family.error ?? student.error;
  if (error) throw error;
  if (!family.data || !student.data) throw new Error("DAY_SCHEDULE_CONTEXT_NOT_FOUND");
  if (family.data.agent_context_version !== input.snapshotVersion) throw new Error("SNAPSHOT_STALE");

  const learningDays = scheduleDates(input.scheduledDate, learnerWeekdays(student.data.schedule_preferences, family.data.available_days), 30);
  const assignments = await admin.from("assignments")
    .select("id,title,subject,status,source_kind,curriculum_unit_id,scheduled_date,scheduled_time,estimated_minutes,sequence_number,version,created_at,attention_mode,parent_attention_minutes")
    .eq("family_id", input.familyId).eq("student_id", input.studentId)
    .gte("scheduled_date", input.scheduledDate).lte("scheduled_date", learningDays.at(-1)!)
    .neq("status", "skipped").order("scheduled_date").order("scheduled_time", { nullsFirst: false }).limit(500);
  if (assignments.error) throw assignments.error;
  const availabilityByDate = await loadAvailabilityByDate({ supabase: admin, familyId: input.familyId, studentId: input.studentId, dailyCapacityMinutes: student.data.daily_capacity_minutes, schedulePreferences: student.data.schedule_preferences, familyLearningDays: family.data.available_days, dates: learningDays });
  const dayAssignments = assignments.data.filter((item) => item.scheduled_date === input.scheduledDate);
  const dayMinutes = dayAssignments.reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0);
  const effectiveCapacity = availabilityByDate[input.scheduledDate]?.availableMinutes ?? student.data.daily_capacity_minutes;

  if (dayMinutes > effectiveCapacity) {
    let balanced = buildCapacityRebalanceProposal({ targetDate: input.scheduledDate, assignments: assignments.data.map(toPlanning), learningDays, dailyCapacityMinutes: student.data.daily_capacity_minutes, availabilityByDate });
    for (let attempt = 0; balanced?.actions.length && attempt < learningDays.length; attempt += 1) {
      const conflictDates = await parentConflictDatesAfterActions(admin, input.familyId, balanced.actions);
      if (!conflictDates.length) break;
      for (const date of conflictDates) if (availabilityByDate[date]) availabilityByDate[date] = { ...availabilityByDate[date], availableMinutes: 0 };
      balanced = buildCapacityRebalanceProposal({ targetDate: input.scheduledDate, assignments: assignments.data.map(toPlanning), learningDays, dailyCapacityMinutes: student.data.daily_capacity_minutes, availabilityByDate });
    }
    if (!balanced?.actions.length) throw new Error("NO_CAPACITY_TO_REBALANCE_DAY");
    const dayName = displayWeekday(input.scheduledDate);
    const summary = `Moved ${balanced.movedFromTarget} ${dayName} lesson${balanced.movedFromTarget === 1 ? "" : "s"}${balanced.shiftedForSequence ? ` and shifted ${balanced.shiftedForSequence} later course lesson${balanced.shiftedForSequence === 1 ? "" : "s"} to preserve order` : ""}. ${student.data.display_name}’s ${dayName} changed from ${balanced.beforeMinutes} to ${balanced.afterMinutes} minutes, within the ${effectiveCapacity}-minute available limit.`;
    const decision = {
      action: "maintain_curriculum_sequence", level: "automatic_with_undo", appliesAutomatically: true,
      undoRequired: true, parentConfirmationRequired: false, interaction: "none", denied: false,
      handler: "rebalance_day_capacity", parentExplicitInstruction: true,
    };
    const proposal = await admin.from("adjustment_proposals").insert({
      family_id: input.familyId, student_id: input.studentId, agent_turn_id: input.agentTurnId,
      week_start: input.scheduledDate,
      reason: `${dayName} had ${balanced.beforeMinutes} minutes scheduled against ${student.data.display_name}’s ${effectiveCapacity}-minute available teaching time.`,
      summary, snapshot_version: input.snapshotVersion, idempotency_key: input.idempotencyKey,
      trigger_event: { eventKind: "parent_schedule_rebalance", scheduledDate: input.scheduledDate, beforeMinutes: balanced.beforeMinutes, afterMinutes: balanced.afterMinutes },
      policy_decision: decision,
    }).select("id,status,summary").single();
    if (proposal.error) throw proposal.error;
    const inserted = await admin.from("adjustment_actions").insert(balanced.actions.map((action, position) => ({
      family_id: input.familyId, proposal_id: proposal.data.id, assignment_id: action.assignmentId,
      action_type: action.actionType, before_state: action.beforeState as Json, after_state: action.afterState as Json, position,
    })));
    if (inserted.error) throw inserted.error;
    const applied = await admin.rpc("apply_klio_adjustment", { p_proposal_id: proposal.data.id, p_actor_id: input.actorId });
    if (applied.error) throw applied.error;
    if (rpcStatus(applied.data) !== "applied") throw new Error("ADJUSTMENT_SNAPSHOT_STALE");
    const movedIds = balanced.actions.filter((action) => action.beforeState.scheduledDate === input.scheduledDate).flatMap((action) => action.assignmentId ? [action.assignmentId] : []);
    const insight = await admin.from("klio_insights").upsert({
      family_id: input.familyId, student_id: input.studentId, kind: "adjusted",
      title: `I rebalanced ${dayName}`, summary,
      reason: `${student.data.display_name}’s full learner-day was above capacity; Klio recalculated the authoritative schedule before applying the change.`,
      priority: 92, evidence_refs: movedIds.map((id) => ({ type: "assignment", id })),
      action_ref: { type: "schedule_adjustment", proposalId: proposal.data.id, undoAvailable: true },
      dedupe_key: `day_capacity_rebalanced:${proposal.data.id}`,
    }, { onConflict: "family_id,dedupe_key" });
    if (insight.error) throw insight.error;
    await enqueueProactiveEvaluation({
      familyId: input.familyId, studentId: input.studentId, requestedBy: input.actorId,
      eventKind: "schedule_adjusted", entityType: "adjustment_proposal", entityId: proposal.data.id,
      idempotencyKey: `rebalanced-day:${input.idempotencyKey}`,
    });
    return {
      outcome: "completed", proposalId: proposal.data.id, summary,
      changedCount: balanced.actions.length, movedCount: balanced.movedFromTarget,
      beforeMinutes: balanced.beforeMinutes, afterMinutes: balanced.afterMinutes,
      capacityMinutes: effectiveCapacity, capacityWarning: false, undoAvailable: true,
    };
  }

  const remaining = dayAssignments.filter((item) => item.status !== "completed").sort(compareScheduledWork);
  if (!remaining.length) return { outcome: "no_op", summary: "There is no remaining work to organize today.", changedCount: 0, undoAvailable: false };
  const [familyDay, attentionUnits, dayStudents] = await Promise.all([
    admin.from("assignments").select("id,student_id,curriculum_unit_id,title,status,scheduled_time,estimated_minutes,sequence_number,version,attention_mode,parent_attention_minutes").eq("family_id", input.familyId).eq("scheduled_date", input.scheduledDate).neq("status", "skipped"),
    admin.from("curriculum_units").select("id,attention_mode,parent_attention_minutes").eq("family_id", input.familyId),
    admin.from("students").select("id,daily_capacity_minutes,schedule_preferences").eq("family_id", input.familyId).eq("active", true),
  ]);
  if (familyDay.error ?? attentionUnits.error ?? dayStudents.error) throw familyDay.error ?? attentionUnits.error ?? dayStudents.error;
  const unitById = new Map(attentionUnits.data.map((unit) => [unit.id, unit]));
  const studentsById = new Map(dayStudents.data.map((item) => [item.id, item]));
  const involvedStudentIds = [...new Set(familyDay.data.map((item) => item.student_id))];
  const familyAvailability = Object.fromEntries(await Promise.all(involvedStudentIds.map(async (studentId) => {
    const learner = studentsById.get(studentId);
    if (!learner) return [studentId, { availableMinutes: 0, allDayBlocked: true }] as const;
    const availability = await loadAvailabilityByDate({ supabase: admin, familyId: input.familyId, studentId, dailyCapacityMinutes: learner.daily_capacity_minutes, schedulePreferences: learner.schedule_preferences, familyLearningDays: family.data.available_days, dates: [input.scheduledDate] });
    return [studentId, availability[input.scheduledDate]] as const;
  })));
  const scheduleInput = familyDay.data.flatMap((item) => {
    const belongsToTarget = item.student_id === input.studentId;
    const movable = belongsToTarget && item.status !== "completed";
    if (!movable && !item.scheduled_time) return [];
    const unit = item.curriculum_unit_id ? unitById.get(item.curriculum_unit_id) : null;
    return [{ id: item.id, studentId: item.student_id, curriculumUnitId: item.curriculum_unit_id, sequenceNumber: item.sequence_number, scheduledTime: item.scheduled_time, fixed: !movable, preserveExistingTime: Boolean(item.scheduled_time), requirement: resolveAttentionRequirement({ assignmentMode: item.attention_mode, assignmentParentMinutes: item.parent_attention_minutes, curriculumMode: unit?.attention_mode, curriculumParentMinutes: unit?.parent_attention_minutes, lessonMinutes: item.estimated_minutes }) }];
  });
  const arranged = arrangeFamilyDay({ date: input.scheduledDate, assignments: scheduleInput, availability: familyAvailability, dayStart: input.startTime ?? earliestScheduledTime(remaining) ?? "08:30" });
  if (!arranged.ok) throw new Error(arranged.reason === "insufficient_parent_time" || arranged.reason === "fixed_time_collision" ? "NO_PARENT_TIME_TO_ORGANIZE_DAY" : "NO_AVAILABLE_TIME_TO_ORGANIZE_DAY");
  const placements = new Map(arranged.placements.map((placement) => [placement.assignmentId, placement]));
  const overlapCount = countScheduleOverlaps(remaining);
  const actions = remaining.flatMap((item) => {
    const placement = placements.get(item.id);
    if (!placement) return [];
    const currentTime = normalizeScheduleTime(item.scheduled_time);
    const placementTime = normalizeScheduleTime(placement.scheduledTime)!;
    if (currentTime === placementTime) return [];
    return [{ assignmentId: item.id, beforeState: { scheduledDate: input.scheduledDate, scheduledTime: currentTime, version: item.version }, afterState: { scheduledDate: input.scheduledDate, scheduledTime: placementTime, version: item.version + 1 }, title: item.title }];
  });
  if (!actions.length) return { outcome: "no_op", summary: `${student.data.display_name}’s remaining work is already in a clear, non-overlapping order.`, changedCount: 0, undoAvailable: false };

  const targetPlacements = arranged.placements.filter((placement) => remaining.some((item) => item.id === placement.assignmentId));
  const firstTime = formatScheduleTime(Math.min(...targetPlacements.map((placement) => placement.start)));
  const endTime = formatScheduleTime(Math.max(...targetPlacements.map((placement) => placement.end)));
  const capacityMinutes = dayAssignments.reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0);
  const capacityWarning = capacityMinutes > effectiveCapacity;
  const summary = `Organized ${student.data.display_name}’s ${remaining.length} remaining lesson${remaining.length === 1 ? "" : "s"} from ${displayScheduleTime(firstTime)} to ${displayScheduleTime(endTime)} without overlapping another learner’s parent-led time${overlapCount ? `, and removed ${overlapCount} overlapping start${overlapCount === 1 ? "" : "s"}` : ""}.`;
  const decision = {
    action: "maintain_curriculum_sequence",
    level: "automatic_with_undo",
    appliesAutomatically: true,
    undoRequired: true,
    parentConfirmationRequired: false,
    interaction: "none",
    denied: false,
    handler: "organize_day_schedule",
    parentExplicitInstruction: true,
  };
  const proposal = await admin.from("adjustment_proposals").insert({
    family_id: input.familyId,
    student_id: input.studentId,
    agent_turn_id: input.agentTurnId,
    week_start: input.scheduledDate,
    reason: `The parent asked Klio to organize ${student.data.display_name}’s day. Existing lessons and durations were preserved.`,
    summary,
    snapshot_version: input.snapshotVersion,
    idempotency_key: input.idempotencyKey,
    trigger_event: { eventKind: "parent_schedule_organization", scheduledDate: input.scheduledDate, assignmentIds: remaining.map((item) => item.id) },
    policy_decision: decision,
  }).select("id,status,summary").single();
  if (proposal.error) throw proposal.error;
  const inserted = await admin.from("adjustment_actions").insert(actions.map((action, position) => ({
    family_id: input.familyId,
    proposal_id: proposal.data.id,
    assignment_id: action.assignmentId,
    action_type: "move",
    before_state: action.beforeState as Json,
    after_state: action.afterState as Json,
    position,
  })));
  if (inserted.error) throw inserted.error;
  const applied = await admin.rpc("apply_klio_adjustment", { p_proposal_id: proposal.data.id, p_actor_id: input.actorId });
  if (applied.error) throw applied.error;
  if (rpcStatus(applied.data) !== "applied") throw new Error("ADJUSTMENT_SNAPSHOT_STALE");

  const insight = await admin.from("klio_insights").upsert({
    family_id: input.familyId,
    student_id: input.studentId,
    kind: "adjusted",
    title: "I organized today’s remaining work",
    summary,
    reason: `No lessons, dates, or durations changed${capacityWarning ? "; the day is still above the learner’s capacity setting" : ""}.`,
    priority: capacityWarning ? 92 : 72,
    evidence_refs: remaining.map((item) => ({ type: "assignment", id: item.id })),
    action_ref: { type: "schedule_adjustment", proposalId: proposal.data.id, undoAvailable: true },
    dedupe_key: `day_schedule_organized:${proposal.data.id}`,
  }, { onConflict: "family_id,dedupe_key" }).select("id").single();
  if (insight.error) throw insight.error;
  await enqueueProactiveEvaluation({
    familyId: input.familyId,
    studentId: input.studentId,
    requestedBy: input.actorId,
    eventKind: "schedule_adjusted",
    entityType: "adjustment_proposal",
    entityId: proposal.data.id,
    idempotencyKey: `organized-day:${input.idempotencyKey}`,
  });
  return {
    outcome: "completed",
    proposalId: proposal.data.id,
    summary,
    changedCount: actions.length,
    overlapCount,
    capacityWarning,
    undoAvailable: true,
  };
}

export async function moveUnfinishedWork(input: { familyId: string; studentId: string; assignmentIds: string[]; actorId: string; idempotencyKey: string; evaluationId?: string | null }) {
  const admin = createAdminClient();
  const uniqueIds = [...new Set(input.assignmentIds)].slice(0, 20);
  if (!uniqueIds.length) throw new Error("UNFINISHED_ASSIGNMENT_REQUIRED");
  const existing = await admin.from("adjustment_proposals").select("id,status,summary,undo_status")
    .eq("family_id", input.familyId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { proposal: existing.data, insight: null, duplicate: true, applied: existing.data.status === "applied" };
  const [family, student, sources, policyRow] = await Promise.all([
    admin.from("families").select("agent_context_version,available_days,timezone").eq("id", input.familyId).single(),
    admin.from("students").select("id,daily_capacity_minutes,schedule_preferences").eq("id", input.studentId).eq("family_id", input.familyId).single(),
    admin.from("assignments").select("id,scheduled_date,title,subject,curriculum_unit_id").in("id", uniqueIds).eq("family_id", input.familyId).eq("student_id", input.studentId),
    admin.from("family_autonomy_policies").select("preset,policies").eq("family_id", input.familyId).maybeSingle(),
  ]);
  const error = family.error ?? student.error ?? sources.error ?? policyRow.error;
  if (error) throw error;
  if (!family.data || !student.data || !sources.data) throw new Error("UNFINISHED_CONTEXT_NOT_FOUND");
  if (sources.data.length !== uniqueIds.length || sources.data.some((item) => !item.scheduled_date)) throw new Error("UNFINISHED_ASSIGNMENT_NOT_FOUND");
  const sourceDate = sources.data.map((item) => item.scheduled_date!).sort()[0];
  const currentDate = dateInTimezone(new Date(), family.data.timezone);
  const anchor = sourceDate > currentDate ? sourceDate : currentDate;
  const weekdays = learnerWeekdays(student.data.schedule_preferences, family.data.available_days);
  const curriculumUnitIds = [...new Set(sources.data.flatMap((item) => item.curriculum_unit_id ? [item.curriculum_unit_id] : []))];
  const latestCourseWork = curriculumUnitIds.length
    ? await admin.from("assignments").select("scheduled_date")
      .eq("family_id", input.familyId).eq("student_id", input.studentId)
      .in("curriculum_unit_id", curriculumUnitIds).not("scheduled_date", "is", null)
      .not("status", "in", "(completed,skipped)")
      .order("scheduled_date", { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null };
  if (latestCourseWork.error) throw latestCourseWork.error;
  // A fixed window fails whenever a preloaded course reaches its boundary: the
  // last lesson has nowhere to shift. Cover the affected course's existing tail
  // plus 15 additional learning days so the whole sequence can move atomically.
  const candidateDays = scheduleDates(anchor, weekdays, 260);
  const latestCourseDate = latestCourseWork.data?.scheduled_date ?? anchor;
  const courseEndIndex = candidateDays.findIndex((date) => date >= latestCourseDate);
  const horizonEndIndex = courseEndIndex === -1
    ? candidateDays.length - 1
    : Math.min(candidateDays.length - 1, Math.max(14, courseEndIndex + 15));
  const days = candidateDays.slice(0, horizonEndIndex + 1);
  const range = await admin.from("assignments").select("id,title,subject,scheduled_date,estimated_minutes,status,curriculum_unit_id,sequence_number")
    .eq("family_id", input.familyId).eq("student_id", input.studentId).gte("scheduled_date", sourceDate).lte("scheduled_date", days.at(-1)!);
  if (range.error) throw range.error;
  const availabilityByDate = await loadAvailabilityByDate({ supabase: admin, familyId: input.familyId, studentId: input.studentId, dailyCapacityMinutes: student.data.daily_capacity_minutes, schedulePreferences: student.data.schedule_preferences, familyLearningDays: family.data.available_days, dates: days });
  let actions = buildMoveForwardProposalForAssignments({ assignmentIds: uniqueIds, assignments: range.data.map(toPlanning), learningDays: days, dailyCapacityMinutes: student.data.daily_capacity_minutes, availabilityByDate });
  for (let attempt = 0; actions.length && attempt < days.length; attempt += 1) {
    const conflictDates = await parentConflictDatesAfterActions(admin, input.familyId, actions);
    if (!conflictDates.length) break;
    for (const date of conflictDates) if (availabilityByDate[date]) availabilityByDate[date] = { ...availabilityByDate[date], availableMinutes: 0 };
    actions = buildMoveForwardProposalForAssignments({ assignmentIds: uniqueIds, assignments: range.data.map(toPlanning), learningDays: days, dailyCapacityMinutes: student.data.daily_capacity_minutes, availabilityByDate });
  }
  if (!actions.length || uniqueIds.some((id) => !actions.some((action) => action.assignmentId === id))) throw new Error("NO_CAPACITY_FOR_UNFINISHED_WORK");
  const laterCount = actions.filter((item) => item.assignmentId && !uniqueIds.includes(item.assignmentId)).length;
  const first = sources.data.find((item) => item.id === uniqueIds[0])!;
  const reason = uniqueIds.length === 1 ? `${first.title} was not completed as planned.` : `${uniqueIds.length} lessons were not completed as planned.`;
  const summary = uniqueIds.length === 1
    ? laterCount ? `Moved ${first.title} and shifted ${laterCount} later ${first.subject} lesson${laterCount === 1 ? "" : "s"} to preserve order.` : `Moved ${first.title} to the next day with enough room.`
    : `Moved ${uniqueIds.length} unfinished lessons and kept each course in order.`;
  const preset = (policyRow.data?.preset ?? "proactive") as AutonomyPreset;
  const decision = policyDecision(policyForPreset(preset, sanitizePolicy(policyRow.data?.policies)), "move_unfinished_work");
  const proposal = await admin.from("adjustment_proposals").insert({
    family_id: input.familyId, student_id: input.studentId, week_start: days[0], reason, summary,
    snapshot_version: family.data.agent_context_version, idempotency_key: input.idempotencyKey,
    trigger_event: { eventKind: "assignment_unfinished", assignmentIds: uniqueIds, evaluationId: input.evaluationId ?? null },
    policy_decision: { ...decision, preset },
  }).select("id,status,summary,reason,snapshot_version,week_start,undo_status").single();
  if (proposal.error) throw proposal.error;
  const inserted = await admin.from("adjustment_actions").insert(actions.map((action, position) => ({
    family_id: input.familyId, proposal_id: proposal.data.id, assignment_id: action.assignmentId,
    action_type: action.actionType, before_state: action.beforeState as Json, after_state: action.afterState as Json, position,
  })));
  if (inserted.error) throw inserted.error;
  let applied = false;
  if (decision.appliesAutomatically) {
    const result = await admin.rpc("apply_klio_adjustment", { p_proposal_id: proposal.data.id, p_actor_id: input.actorId });
    if (result.error) throw result.error;
    if (rpcStatus(result.data) !== "applied") throw new Error("ADJUSTMENT_SNAPSHOT_STALE");
    applied = true;
  }
  const insightKind = applied ? "adjusted" : "noticed";
  const insight = await admin.from("klio_insights").upsert({
    family_id: input.familyId, student_id: input.studentId, kind: insightKind,
    title: applied ? "I adjusted the week" : "An unfinished lesson needs a new place",
    summary: applied ? summary : summary.replace(/^Moved/, "Move"), reason, priority: 88,
    evidence_refs: uniqueIds.map((id) => ({ type: "assignment", id })),
    action_ref: { type: "schedule_adjustment", proposalId: proposal.data.id, undoAvailable: decision.undoRequired },
    dedupe_key: `assignment_unfinished:${proposal.data.id}:${insightKind}`,
  }, { onConflict: "family_id,dedupe_key" }).select("id,student_id,kind,title,summary,reason,priority,evidence_refs,action_ref,created_at").single();
  if (insight.error) throw insight.error;
  await enqueueProactiveEvaluation({ familyId: input.familyId, studentId: input.studentId, requestedBy: input.actorId, eventKind: "assignment_unfinished", entityType: "adjustment_proposal", entityId: proposal.data.id, idempotencyKey: `unfinished-evaluation:${input.idempotencyKey}` });
  return { proposal: { ...proposal.data, status: applied ? "applied" : "proposed", undo_status: applied && decision.undoRequired ? "available" : "not_available" }, insight: insight.data, duplicate: false, applied };
}

function toPlanning(item: { id: string; title: string; subject: string; scheduled_date: string | null; estimated_minutes: number | null; status: string; curriculum_unit_id?: string | null; sequence_number?: number | null; source_kind?: string | null; scheduled_time?: string | null }) {
  return { id: item.id, title: item.title, subject: item.subject, scheduledDate: item.scheduled_date, estimatedMinutes: item.estimated_minutes, status: item.status as "planned" | "doing" | "submitted" | "completed" | "skipped" | "needs_review", curriculumUnitId: item.curriculum_unit_id, sequenceNumber: item.sequence_number, sourceKind: item.source_kind, scheduledTime: item.scheduled_time };
}

async function parentConflictDatesAfterActions(admin: ReturnType<typeof createAdminClient>, familyId: string, actions: AdjustmentActionDraft[]) {
  const movedIds = actions.flatMap((action) => action.assignmentId ? [action.assignmentId] : []);
  const afterDates = [...new Set(actions.flatMap((action) => typeof action.afterState.scheduledDate === "string" ? [action.afterState.scheduledDate] : []))];
  if (!movedIds.length || !afterDates.length) return [];
  const [scheduled, moved, units] = await Promise.all([
    admin.from("assignments").select("id,student_id,curriculum_unit_id,scheduled_date,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,status").eq("family_id", familyId).in("scheduled_date", afterDates).neq("status", "skipped"),
    admin.from("assignments").select("id,student_id,curriculum_unit_id,scheduled_date,scheduled_time,estimated_minutes,attention_mode,parent_attention_minutes,status").eq("family_id", familyId).in("id", movedIds),
    admin.from("curriculum_units").select("id,attention_mode,parent_attention_minutes").eq("family_id", familyId),
  ]);
  if (scheduled.error ?? moved.error ?? units.error) throw scheduled.error ?? moved.error ?? units.error;
  const byId = new Map([...scheduled.data, ...moved.data].map((item) => [item.id, item]));
  const changes = new Map(actions.flatMap((action) => action.assignmentId ? [[action.assignmentId, action.afterState]] : []));
  const unitById = new Map(units.data.map((unit) => [unit.id, unit]));
  const simulated = [...byId.values()].map((item) => {
    const change = changes.get(item.id);
    return {
      ...item,
      scheduled_date: typeof change?.scheduledDate === "string" ? change.scheduledDate : item.scheduled_date,
      scheduled_time: typeof change?.scheduledTime === "string" ? change.scheduledTime : item.scheduled_time,
    };
  });
  return afterDates.filter((date) => {
    const day = simulated.filter((item) => item.scheduled_date === date);
    const conflicts = findParentAttentionConflicts(day.map((item) => {
      const unit = item.curriculum_unit_id ? unitById.get(item.curriculum_unit_id) : null;
      return { id: item.id, studentId: item.student_id, scheduledStart: item.scheduled_time, requirement: resolveAttentionRequirement({ assignmentMode: item.attention_mode, assignmentParentMinutes: item.parent_attention_minutes, curriculumMode: unit?.attention_mode, curriculumParentMinutes: unit?.parent_attention_minutes, lessonMinutes: item.estimated_minutes }) };
    }));
    return conflicts.some((conflict) => movedIds.includes(conflict.firstId) || movedIds.includes(conflict.secondId));
  });
}
function rpcStatus(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).status === "string" ? (value as Record<string, unknown>).status : null; }

function displayWeekday(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function compareScheduledWork(a: { scheduled_time: string | null; sequence_number: number | null; created_at: string }, b: { scheduled_time: string | null; sequence_number: number | null; created_at: string }) {
  const aTime = parseScheduleMinutes(a.scheduled_time) ?? Number.MAX_SAFE_INTEGER;
  const bTime = parseScheduleMinutes(b.scheduled_time) ?? Number.MAX_SAFE_INTEGER;
  return aTime - bTime || (a.sequence_number ?? Number.MAX_SAFE_INTEGER) - (b.sequence_number ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at);
}

function countScheduleOverlaps(items: Array<{ scheduled_time: string | null; estimated_minutes: number | null }>) {
  const scheduled = items.flatMap((item) => {
    const start = parseScheduleMinutes(item.scheduled_time);
    return start === null ? [] : [{ start, end: start + (item.estimated_minutes ?? 30) }];
  }).sort((a, b) => a.start - b.start);
  let overlaps = 0;
  let occupiedThrough = -1;
  for (const item of scheduled) {
    if (item.start < occupiedThrough) overlaps += 1;
    occupiedThrough = Math.max(occupiedThrough, item.end);
  }
  return overlaps;
}

function earliestScheduledTime(items: Array<{ scheduled_time: string | null }>) {
  return items.map((item) => normalizeScheduleTime(item.scheduled_time)).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

function parseScheduleMinutes(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeScheduleTime(value: string | null | undefined) {
  const minutes = parseScheduleMinutes(value);
  return minutes === null ? null : formatScheduleTime(minutes);
}

function formatScheduleTime(minutes: number) {
  if (minutes < 0 || minutes >= 24 * 60) throw new Error("DAY_SCHEDULE_EXCEEDS_CALENDAR_DAY");
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
}

function displayScheduleTime(value: string) {
  const minutes = parseScheduleMinutes(value) ?? 0;
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
