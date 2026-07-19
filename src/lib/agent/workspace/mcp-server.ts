import "server-only";

import http from "node:http";
import { z } from "zod";
import { callWorkspaceTool } from "./tool-gateway";
import { workspaceToolNames, workspaceToolSchemas, type WorkspaceToolName } from "./contracts";

const descriptions: Record<WorkspaceToolName, string> = {
  read_capture: "Read a family-scoped capture for optional deeper follow-up. Host preflight already contains the current capture.",
  read_family_context: "Refresh bounded current family context for optional deeper follow-up.",
  read_goals_and_pacing: "Read current parent-owned goals and deterministic pace checkpoints for one learner or goal.",
  read_review_queue: "Read bounded pending submissions and draft-review uncertainty for the current family.",
  read_assignment_review_context: "Read one family-scoped assignment, directions, learner level, submission, draft, and source evidence.",
  read_relevant_history: "Read a paginated, family-scoped slice of comparable assignment and approved-review history.",
  file_capture: "File a capture into a controlled subject category without creating an educational interpretation.",
  create_reminder: "Create an auditable family reminder. Direct parent reminders do not require source evidence; omit sourceEvidenceId unless an actual capture is being linked.",
  ask_parent: "Persist one concise clarification question and pause the family thread.",
  record_explicit_completion: "Record a completion the parent explicitly stated for one authorized assignment, then enqueue quiet follow-through evaluation.",
  record_explicit_parent_score: "Preserve a score the parent explicitly supplied; never infer or alter the value.",
  update_assignment_status: "Update one assignment only when the parent explicitly authorized that exact status change.",
  move_unfinished_work: "Coordinate one or more explicitly unfinished assignments, preserve curriculum order and capacity, and apply or propose the move according to family policy.",
  organize_day_schedule: "Authoritatively organize one learner on one date. If overloaded, the host rebalances the complete day across future learning days within capacity and curriculum order; otherwise it removes time overlaps. Applies safe changes with undo and returns measured before/after minutes.",
  create_assignment: "Create one ordinary family-scoped assignment with bounded text, duration, and optional curriculum link.",
  create_schedule_block: "Create one ordinary assignment and visible calendar block on a specified date.",
  move_schedule_work: "Prepare a bounded same-learner schedule move for listed assignments.",
  resize_schedule_work: "Prepare a bounded duration change for one assignment.",
  propose_learner_goal: "Create a snapshot-bound parent-reviewable learner goal proposal; never silently change long-term goals.",
  propose_curriculum_change: "Create a parent-reviewable curriculum or cadence proposal.",
  draft_assignment_review: "Draft a cautious evidence-backed assignment review for an existing pending review.",
  return_work_with_draft_feedback: "Prepare work return and draft feedback for parent confirmation.",
  create_targeted_lesson: "Create a reviewable lesson tied to named assignment, review, and source evidence records.",
  create_supplemental_practice: "Create structured supplemental practice tied to finalized review evidence and the source assignment.",
  remove_supplemental_practice: "Prepare removal of one future supplemental assignment through the undoable adjustment path.",
  prepare_planning_changes: "Create one bounded weekly or term planning proposal with exact affected assignments.",
  present_action_card: "Describe a semantic internal target for the host to validate and render; never provide a URL or client command.",
  update_subject_summary_draft: "Create a parent-reviewable subject summary draft.",
  build_dashboard: "Create a parent-reviewable family learning dashboard draft.",
  draft_weekly_plan: "Create a parent-reviewable weekly plan draft.",
  create_lesson: "Create a parent-reviewable lesson draft.",
  create_practice_activity: "Create safe version-2 dynamic practice from a parent request. When the parent explicitly names a day, include scheduleDate and a realistic estimatedMinutes so the host can add an undoable schedule card within family policy and capacity.",
  build_portfolio: "Create a parent-reviewable portfolio draft.",
  update_records_draft: "Create a parent-reviewable records update draft.",
};

function result(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError };
}

export function createWorkspaceMcpServer() {
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/mcp") return void response.writeHead(404).end();
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let message: { id?: unknown; method?: string; params?: { name?: WorkspaceToolName; arguments?: unknown } };
    try { message = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return void response.writeHead(400).end(); }
    const headers = { "content-type": "application/json", "mcp-protocol-version": "2025-03-26" };
    if (message.method === "notifications/initialized") return void response.writeHead(202, headers).end();
    try {
      let payload: unknown;
      if (message.method === "initialize") payload = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "klio-workspace", version: "0.1.0" } };
      else if (message.method === "tools/list") payload = { tools: workspaceToolNames.map((name) => ({ name, description: descriptions[name], inputSchema: z.toJSONSchema(workspaceToolSchemas[name]) })) };
      else if (message.method === "tools/call" && message.params?.name && workspaceToolNames.includes(message.params.name)) payload = await callWorkspaceTool({ authorization: request.headers.authorization ?? null, name: message.params.name, arguments: message.params.arguments });
      else throw new Error("METHOD_NOT_FOUND");
      response.writeHead(200, headers).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: message.method === "tools/call" ? result(payload) : payload }));
    } catch (error) {
      const code = error instanceof Error ? error.message : "TOOL_FAILED";
      response.writeHead(200, headers).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: result({ error: code }, true) }));
    }
  });
  return {
    async start() {
      await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("MCP_SERVER_ADDRESS_REQUIRED");
      return `http://127.0.0.1:${address.port}/mcp`;
    },
    async stop() { if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}
