import { createHmac, timingSafeEqual } from "node:crypto";

export const TOOL_NAMES = Object.freeze([
  "read_capture",
  "read_family_context",
  "create_reminder",
  "file_capture",
  "ask_parent",
]);

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(encoded, secret) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function issueCapability(claims, secret) {
  const payload = encode(claims);
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyCapability(token, secret, now = Date.now()) {
  if (!token || typeof token !== "string") throw new Error("CAPABILITY_REQUIRED");
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("CAPABILITY_INVALID");
  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error("CAPABILITY_INVALID");
  }
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!claims.familyId || !claims.requestedBy || !claims.klioTurnId || !claims.snapshotVersion || !claims.nonce) {
    throw new Error("CAPABILITY_INVALID");
  }
  if (!Array.isArray(claims.allowedTools) || claims.allowedTools.some((tool) => !TOOL_NAMES.includes(tool))) {
    throw new Error("CAPABILITY_INVALID");
  }
  if (Date.parse(claims.expiresAt) <= now || Date.parse(claims.issuedAt) > now + 30_000) {
    throw new Error("CAPABILITY_EXPIRED");
  }
  return claims;
}
