import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { issueCapability, TOOL_NAMES } from "../lib/capability.mjs";
import { FAMILY_A, FAMILY_B, PARENT_A } from "../lib/fixtures.mjs";
import { createFixtureState, createToolCaller } from "../lib/gateway.mjs";
import { toolDefinitions } from "../lib/tool-definitions.mjs";

const SECRET = randomBytes(32).toString("hex");

function capability(overrides = {}) {
  const now = Date.now();
  return issueCapability({
    familyId: FAMILY_A,
    requestedBy: PARENT_A,
    klioTurnId: "turn-a",
    snapshotVersion: "family-a:v1",
    allowedTools: TOOL_NAMES,
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: "nonce-a",
    ...overrides,
  }, SECRET);
}

function auth(token = capability()) {
  return `Bearer ${token}`;
}

test("exposes exactly the five Capture Agent tools without identity arguments", () => {
  assert.deepEqual(toolDefinitions.map((tool) => tool.name), TOOL_NAMES);
  const serialized = JSON.stringify(toolDefinitions);
  for (const forbidden of ["familyId", "requestedBy", "authorization", "databaseRole", "endpoint"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("rejects expired, forged, and model-controlled identity", () => {
  const caller = createToolCaller({ secret: SECRET });
  assert.throws(() => caller.call({ authorization: auth(capability({ expiresAt: new Date(Date.now() - 1).toISOString() })), name: "read_family_context" }), /CAPABILITY_EXPIRED/);
  assert.throws(() => caller.call({ authorization: auth(`${capability()}x`), name: "read_family_context" }), /CAPABILITY_INVALID/);
  assert.throws(() => caller.call({ authorization: auth(), name: "read_capture", arguments: { evidenceId: "30000000-0000-4000-8000-00000000000a", familyId: FAMILY_B } }), /MODEL_CONTROLLED_IDENTITY_REJECTED/);
});

test("enforces the capability tool allowlist", () => {
  const caller = createToolCaller({ secret: SECRET });
  const token = capability({ allowedTools: ["read_capture"] });
  assert.throws(() => caller.call({ authorization: auth(token), name: "create_reminder", arguments: {} }), /TOOL_NOT_ALLOWED/);
});

test("prevents cross-family capture and student access", () => {
  const caller = createToolCaller({ secret: SECRET });
  assert.throws(() => caller.call({ authorization: auth(), name: "read_capture", arguments: { evidenceId: "30000000-0000-4000-8000-00000000000c" } }), /CAPTURE_NOT_FOUND/);
  assert.throws(() => caller.call({ authorization: auth(), name: "read_family_context", arguments: { studentId: "20000000-0000-4000-8000-00000000000b" } }), /STUDENT_NOT_FOUND/);
});

test("binds writes to the host-authorized snapshot version", () => {
  const caller = createToolCaller({ secret: SECRET });
  const stale = capability({ snapshotVersion: "family-a:stale" });
  assert.throws(() => caller.call({ authorization: auth(stale), name: "create_reminder", arguments: { sourceEvidenceId: "30000000-0000-4000-8000-00000000000a", idempotencyKey: "reminder-a" } }), /SNAPSHOT_STALE/);
  assert.doesNotThrow(() => caller.call({ authorization: auth(), name: "create_reminder", arguments: { title: "Give out test", dueAt: "2026-07-15T13:00:00.000Z", studentId: null, sourceEvidenceId: "30000000-0000-4000-8000-00000000000a", idempotencyKey: "reminder-a" } }));
});

test("makes reminder and filing writes idempotent and creates no artifacts", () => {
  const state = createFixtureState();
  const caller = createToolCaller({ secret: SECRET, state });
  const reminderArgs = { title: "Give out test", dueAt: "2026-07-15T13:00:00.000Z", studentId: null, sourceEvidenceId: "30000000-0000-4000-8000-00000000000a", idempotencyKey: "reminder-a" };
  caller.call({ authorization: auth(), name: "create_reminder", arguments: reminderArgs });
  caller.call({ authorization: auth(), name: "create_reminder", arguments: reminderArgs });
  const filingArgs = { evidenceId: "30000000-0000-4000-8000-00000000000b", studentId: "20000000-0000-4000-8000-00000000000a", category: "Math", documentType: "Worksheet", tags: ["fractions"], confidence: 0.97, idempotencyKey: "filing-a" };
  const filed = caller.call({ authorization: auth(), name: "file_capture", arguments: filingArgs });
  caller.call({ authorization: auth(), name: "file_capture", arguments: filingArgs });
  assert.equal(state.reminders.size, 1);
  assert.equal(state.filings.size, 1);
  assert.equal(state.audit.length, 2);
  assert.equal(filed.structuredContent.artifactCreated, false);
  assert.equal(filed.structuredContent.approvalCreated, false);
});

test("permits only one clarification per turn", () => {
  const state = createFixtureState();
  const caller = createToolCaller({ secret: SECRET, state });
  const first = caller.call({ authorization: auth(), name: "ask_parent", arguments: { question: "Which Wednesday?", reason: "ambiguous_date" } });
  const second = caller.call({ authorization: auth(), name: "ask_parent", arguments: { question: "A different question", reason: "ambiguous_intent" } });
  assert.equal(first.structuredContent.questionId, second.structuredContent.questionId);
  assert.equal(state.questions.size, 1);
});
