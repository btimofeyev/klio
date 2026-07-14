import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { issueWorkspaceCapability, verifyWorkspaceCapability } from "./capability";

const secret = "test-secret-that-is-long-enough";
const base = {
  familyId: "00000000-0000-4000-8000-000000000001", requestedBy: "00000000-0000-4000-8000-000000000002",
  klioTurnId: "00000000-0000-4000-8000-000000000003", snapshotVersion: 4,
  allowedTools: ["create_reminder" as const], issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: "0123456789abcdef",
};

describe("workspace capability", () => {
  it("round-trips signed host scope", () => {
    expect(verifyWorkspaceCapability(issueWorkspaceCapability(base, secret), secret)).toMatchObject({ familyId: base.familyId, snapshotVersion: 4 });
  });
  it("rejects tampering and expiry", () => {
    expect(() => verifyWorkspaceCapability(`${issueWorkspaceCapability(base, secret)}x`, secret)).toThrow("CAPABILITY_INVALID");
    const expired = { ...base, expiresAt: new Date(Date.now() - 1).toISOString() };
    expect(() => verifyWorkspaceCapability(issueWorkspaceCapability(expired, secret), secret)).toThrow("CAPABILITY_EXPIRED");
  });
});

