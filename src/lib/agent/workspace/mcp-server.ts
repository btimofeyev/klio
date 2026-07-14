import "server-only";

import http from "node:http";
import { z } from "zod";
import { callWorkspaceTool } from "./tool-gateway";
import { workspaceToolNames, workspaceToolSchemas, type WorkspaceToolName } from "./contracts";

const descriptions: Record<WorkspaceToolName, string> = {
  read_capture: "Read a family-scoped capture for optional deeper follow-up. Host preflight already contains the current capture.",
  read_family_context: "Refresh bounded current family context for optional deeper follow-up.",
  file_capture: "File a capture into a controlled subject category without creating an educational interpretation.",
  create_reminder: "Create an auditable family reminder. Direct parent reminders do not require source evidence; omit sourceEvidenceId unless an actual capture is being linked.",
  ask_parent: "Persist one concise clarification question and pause the family thread.",
  update_subject_summary_draft: "Create a parent-reviewable subject summary draft.",
  build_dashboard: "Create a parent-reviewable family learning dashboard draft.",
  draft_weekly_plan: "Create a parent-reviewable weekly plan draft.",
  create_lesson: "Create a parent-reviewable lesson draft.",
  create_practice_activity: "Create a safe version-2 dynamic practice draft. Select subject-appropriate activity types from multiple choice, short answer, interactive line graphing, and written response.",
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
