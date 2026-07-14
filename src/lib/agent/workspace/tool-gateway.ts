import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { verifyWorkspaceCapability } from "./capability";
import { workspaceToolSchemas, type WorkspaceToolArguments, type WorkspaceToolName } from "./contracts";
import { buildFamilyWorkspaceSnapshot } from "./snapshot";
import type { Json } from "@/lib/supabase/database.types";

export async function callWorkspaceTool<K extends WorkspaceToolName>(input: { authorization: string | null; name: K; arguments: unknown }) {
  const token = input.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("CAPABILITY_REQUIRED");
  const claims = verifyWorkspaceCapability(token, serverEnv.klioAgentCapabilitySecret);
  if (!claims.allowedTools.includes(input.name)) throw new Error("TOOL_NOT_ALLOWED");
  const args = workspaceToolSchemas[input.name].parse(input.arguments) as WorkspaceToolArguments[K];
  const admin = createAdminClient();
  const { data: turn, error: turnError } = await admin.from("agent_turns").select("id, family_id, requested_by, initial_snapshot_version, current_snapshot_version, status").eq("id", claims.klioTurnId).eq("family_id", claims.familyId).single();
  if (turnError || !turn) throw new Error("AGENT_TURN_NOT_FOUND");
  if (turn.requested_by !== claims.requestedBy || turn.initial_snapshot_version !== claims.snapshotVersion) throw new Error("CAPABILITY_SCOPE_MISMATCH");

  if (input.name === "read_capture") {
    const result = await buildFamilyWorkspaceSnapshot({ familyId: claims.familyId, evidenceIds: [(args as WorkspaceToolArguments["read_capture"]).evidenceId] });
    return { capture: result.snapshot.captures[0], snapshotVersion: result.version };
  }
  if (input.name === "read_family_context") {
    const result = await buildFamilyWorkspaceSnapshot({ familyId: claims.familyId, studentId: (args as WorkspaceToolArguments["read_family_context"]).studentId });
    return { ...result.snapshot, captures: [] };
  }

  const idempotencyKey = (args as { idempotencyKey: string }).idempotencyKey;
  const redacted = redactArguments(input.name, args);
  const { data, error } = await admin.rpc("apply_agent_workspace_tool", {
    p_turn_id: claims.klioTurnId, p_tool_name: input.name, p_idempotency_key: idempotencyKey,
    p_arguments: toJson(args), p_arguments_redacted: toJson(redacted),
  });
  if (error) {
    if (error.message.includes("AGENT_SNAPSHOT_STALE")) throw new Error("SNAPSHOT_STALE");
    throw error;
  }
  return data;
}

function toJson(value: unknown) { return JSON.parse(JSON.stringify(value)) as Json; }

function redactArguments(name: WorkspaceToolName, args: unknown) {
  const value = structuredClone(args) as Record<string, unknown>;
  if (name === "ask_parent" && typeof value.question === "string") value.question = `[${value.question.length} chars]`;
  if ("content" in value) value.content = "[draft content redacted]";
  return value;
}
