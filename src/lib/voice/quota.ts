import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type VoiceQuotaDenialReason = "rate_limit" | "daily_limit" | "concurrent" | "capacity";
export type VoiceQuotaClaim =
  | { allowed: true; leaseToken: string; retryAfter: 0 }
  | { allowed: false; reason: VoiceQuotaDenialReason; retryAfter: number };

export class VoiceQuotaUnavailableError extends Error {
  constructor() {
    super("VOICE_QUOTA_UNAVAILABLE");
    this.name = "VoiceQuotaUnavailableError";
  }
}

export async function claimVoiceTranscription(userId: string, audioSeconds: number, leaseToken = crypto.randomUUID()): Promise<VoiceQuotaClaim> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_voice_transcription", {
    p_user_id: userId,
    p_lease_token: leaseToken,
    p_audio_seconds: audioSeconds,
    p_lease_seconds: 90,
  });
  if (error) {
    console.error("voice_quota_claim_failed", { code: error.code });
    throw new VoiceQuotaUnavailableError();
  }
  return parseVoiceQuotaClaim(data);
}

export async function releaseVoiceTranscription(userId: string, leaseToken: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_voice_transcription", {
    p_user_id: userId,
    p_lease_token: leaseToken,
  });
  if (error) {
    console.error("voice_quota_release_failed", { code: error.code });
    return false;
  }
  return data === true;
}

function parseVoiceQuotaClaim(value: unknown): VoiceQuotaClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VoiceQuotaUnavailableError();
  const record = value as Record<string, unknown>;
  const retryAfter = typeof record.retryAfter === "number" && Number.isFinite(record.retryAfter)
    ? Math.max(0, Math.ceil(record.retryAfter))
    : 0;
  if (record.allowed === true && typeof record.leaseToken === "string") {
    return { allowed: true, leaseToken: record.leaseToken, retryAfter: 0 };
  }
  if (record.allowed === false && ["rate_limit", "daily_limit", "concurrent", "capacity"].includes(String(record.reason))) {
    return { allowed: false, reason: record.reason as VoiceQuotaDenialReason, retryAfter: Math.max(1, retryAfter) };
  }
  throw new VoiceQuotaUnavailableError();
}
