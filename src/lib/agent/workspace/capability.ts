import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { workspaceToolNames } from "./contracts";

const claimsSchema = z.object({
  familyId: z.uuid(), requestedBy: z.uuid(), klioTurnId: z.uuid(), snapshotVersion: z.number().int().nonnegative(),
  allowedTools: z.array(z.enum(workspaceToolNames)).min(1), issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), nonce: z.string().min(16),
});
export type WorkspaceCapability = z.infer<typeof claimsSchema>;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueWorkspaceCapability(claims: WorkspaceCapability, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyWorkspaceCapability(token: string, secret: string, now = Date.now()) {
  const [payload, received, extra] = token.split(".");
  if (!payload || !received || extra) throw new Error("CAPABILITY_INVALID");
  const expectedBuffer = Buffer.from(signature(payload, secret));
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) throw new Error("CAPABILITY_INVALID");
  const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (Date.parse(claims.expiresAt) <= now || Date.parse(claims.issuedAt) > now + 30_000) throw new Error("CAPABILITY_EXPIRED");
  return claims;
}

