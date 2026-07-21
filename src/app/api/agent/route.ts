import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { enqueueAgentJob, safelyProcessAgentJob } from "@/lib/agent/jobs";
import type { AgentIntent } from "@/lib/agent/run-agent";
import { authorizationsForWorkspaceRequest, completeInstantWorkspaceTurn, enqueueWorkspaceTurn, interactionModeForRequest, type WorkspaceGoal } from "@/lib/agent/workspace/turns";
import { processWorkspaceTurn } from "@/lib/agent/workspace/runtime";
import { serverEnv } from "@/lib/env";
import { postgresUuidSchema } from "@/lib/validation/postgres-uuid";
import { assignmentGuidanceRequest, explicitlyMentionedStudentId, isAssignmentGuidanceRequest } from "@/lib/agent/workspace/request-routing";
import { appendAgentConversationMessage, ensureAgentConversation } from "@/lib/agent/workspace/conversations";
import { instantConversationReply } from "@/lib/agent/workspace/instant-conversation";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  familyId: postgresUuidSchema, studentId: postgresUuidSchema.nullable().optional(), evidenceIds: z.array(postgresUuidSchema).max(20).default([]),
  intent: z.enum(["general", "organize", "understand", "update_records", "next_step", "weekly_plan", "lesson", "summary", "practice", "portfolio"]),
  request: z.string().trim().min(1).max(4000), requestId: z.uuid(), contextDate: z.iso.date().optional(), assignmentId: postgresUuidSchema.optional(), conversationId: postgresUuidSchema.optional(),
});

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const rate = checkRateLimit(`agent:${parent.id}`, 10, 5 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Klio is already handling several requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Tell Klio what you would like it to take care of." }, { status: 400 });
    const supabase = await createClient();
    const [membershipResult, students, assignment] = await Promise.all([
      supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).maybeSingle(),
      supabase.from("students").select("id,display_name").eq("family_id", parsed.data.familyId).eq("active", true),
      parsed.data.assignmentId
        ? supabase.from("assignments").select("id,student_id,title,subject").eq("family_id", parsed.data.familyId).eq("id", parsed.data.assignmentId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (membershipResult.error) throw membershipResult.error;
    const membership = membershipResult.data;
    if (!membership) return NextResponse.json({ error: "You do not have access to that workspace." }, { status: 403 });
    if (students.error) throw students.error;
    if (assignment.error) throw assignment.error;
    if (parsed.data.assignmentId && !assignment.data) return NextResponse.json({ error: "That lesson is no longer available in this workspace." }, { status: 404 });
    if (serverEnv.klioAgentRuntime === "codex_app_server") {
      const goal = intentGoal(parsed.data.intent);
      const idempotencyKey = `workspace:${parsed.data.requestId}`;
      const assignmentGuidance = Boolean(assignment.data && isAssignmentGuidanceRequest(parsed.data.request));
      const contextualRequest = assignment.data && assignmentGuidance ? assignmentGuidanceRequest({ title: assignment.data.title, subject: assignment.data.subject, request: parsed.data.request }) : parsed.data.request;
      const interactionMode = interactionModeForRequest({ goal, request: parsed.data.request, assignmentGuidance });
      const mentionedStudentId = explicitlyMentionedStudentId(parsed.data.request, students.data.map((student) => ({ id: student.id, displayName: student.display_name })));
      const effectiveStudentId = assignment.data?.student_id ?? mentionedStudentId ?? parsed.data.studentId;
      const conversationId = await ensureAgentConversation({ familyId: parsed.data.familyId, requestedBy: parent.id, conversationId: parsed.data.conversationId, studentId: effectiveStudentId, openingRequest: parsed.data.request });
      const instantReply = parsed.data.intent === "general" && !parsed.data.evidenceIds.length && !assignment.data
        ? instantConversationReply(parsed.data.request)
        : null;
      if (instantReply) {
        const workspace = await completeInstantWorkspaceTurn({
          familyId: parsed.data.familyId,
          requestedBy: parent.id,
          studentId: effectiveStudentId,
          idempotencyKey,
          request: parsed.data.request,
          message: instantReply,
          conversationId,
        });
        await appendAgentConversationMessage({ conversationId, familyId: parsed.data.familyId, role: "user", content: parsed.data.request, agentTurnId: workspace.turn.id, idempotencyKey: `turn:${parsed.data.requestId}:user` });
        await appendAgentConversationMessage({ conversationId, familyId: parsed.data.familyId, role: "assistant", content: instantReply, agentTurnId: workspace.turn.id, idempotencyKey: `turn:${workspace.turn.id}:assistant` });
        return NextResponse.json({ turn: workspace.turn, conversationId, interactionMode: "answer", instantReply, publicResult: workspace.publicResult }, { status: 200 });
      }
      const presentation = requestPresentation(parsed.data.intent, contextualRequest, assignment.data, interactionMode);
      const workspace = await enqueueWorkspaceTurn({ familyId: parsed.data.familyId, requestedBy: parent.id, evidenceIds: parsed.data.evidenceIds, studentId: effectiveStudentId, trigger: "parent_message", goal, idempotencyKey, request: contextualRequest, contextDate: parsed.data.contextDate, conversationId, interactionMode, authorizations: authorizationsForWorkspaceRequest(parsed.data.request, interactionMode), ...presentation });
      await appendAgentConversationMessage({ conversationId, familyId: parsed.data.familyId, role: "user", content: parsed.data.request, agentTurnId: workspace.turn.id, idempotencyKey: `turn:${parsed.data.requestId}:user` });
      if (serverEnv.klioAgentInline && !workspace.duplicate) after(() => processWorkspaceTurn(workspace.turn.id));
      return NextResponse.json({ turn: workspace.turn, conversationId, interactionMode }, { status: 202 });
    }
    if (!parsed.data.studentId || !parsed.data.evidenceIds.length) return NextResponse.json({ error: "This workspace request requires the Codex agent runtime." }, { status: 503 });
    const job = await enqueueAgentJob({
      familyId: parsed.data.familyId,
      parentId: parent.id,
      studentId: parsed.data.studentId,
      evidenceIds: parsed.data.evidenceIds,
      intents: [parsed.data.intent as AgentIntent],
    });
    after(() => safelyProcessAgentJob(job.id));
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (message === "OPENAI_KEY_REQUIRED") return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart Klio to use the agent." }, { status: 503 });
    if (message === "OPENAI_KEY_INVALID") return NextResponse.json({ error: "OpenAI rejected the configured API key. Replace OPENAI_API_KEY with a valid Platform key and restart Klio." }, { status: 503 });
    return NextResponse.json({ error: "The Klio agent could not complete this request. Your original capture is safe." }, { status: 500 });
  }
}

function intentGoal(intent: z.infer<typeof schema>["intent"]): WorkspaceGoal {
  if (intent === "weekly_plan") return "weekly_plan";
  if (intent === "lesson") return "lesson";
  if (intent === "practice") return "practice";
  if (intent === "portfolio") return "portfolio";
  if (intent === "summary" || intent === "next_step") return "dashboard";
  if (intent === "update_records" || intent === "understand") return "records";
  if (intent === "organize") return "capture";
  return "general";
}

function requestPresentation(intent: z.infer<typeof schema>["intent"], request: string, assignment: { title: string; subject: string } | null | undefined, interactionMode: "answer" | "act") {
  if (intent === "practice") return { taskName: "Creating practice", expectedOutput: "Practice ready in the learner’s workspace" };
  if (assignment) return { taskName: `Answering how to teach ${assignment.title}`, subject: assignment.subject, expectedOutput: "A concrete teaching approach grounded in this lesson" };
  if (interactionMode === "answer") return { taskName: "Answering your question", expectedOutput: "A clear answer grounded in your family workspace" };
  if (intent === "weekly_plan" && /\b(?:organiz|overlap|rebalance|timed\s+(?:plan|schedule))\w*/i.test(request)) {
    return { taskName: "Organizing today’s schedule", expectedOutput: "A usable non-overlapping schedule with Undo" };
  }
  return {};
}
