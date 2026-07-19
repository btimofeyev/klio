import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { requireParentApi } from "@/lib/auth/require-parent";
import { serverEnv } from "@/lib/env";
import { DictationAudioValidationError, inspectDictationAudio } from "@/lib/voice/audio-validation";
import { MAX_DICTATION_REQUEST_BYTES, dictationFileName, dictationValidationError, normalizedAudioType } from "@/lib/voice/dictation";
import { VoiceQuotaUnavailableError, claimVoiceTranscription, releaseVoiceTranscription, type VoiceQuotaDenialReason } from "@/lib/voice/quota";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    if (!serverEnv.openAiApiKey) return NextResponse.json({ error: "Voice input is temporarily unavailable." }, { status: 503 });
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DICTATION_REQUEST_BYTES) {
      return NextResponse.json({ error: "That recording is too long. Keep voice input under two minutes." }, { status: 413 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Record something first." }, { status: 400 });
    const validationError = dictationValidationError(file);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const mimeType = normalizedAudioType(file.type);
    const buffer = Buffer.from(await file.arrayBuffer());
    const audio = await inspectDictationAudio(buffer, mimeType);
    const quota = await claimVoiceTranscription(parent.id, audio.billableSeconds);
    if (!quota.allowed) return quotaDeniedResponse(quota.reason, quota.retryAfter);

    try {
      const openai = new OpenAI({ apiKey: serverEnv.openAiApiKey, timeout: 45_000, maxRetries: 1 });
      const transcription = await openai.audio.transcriptions.create({
        file: await toFile(buffer, dictationFileName(mimeType), { type: mimeType }),
        model: "gpt-4o-mini-transcribe",
      });
      const text = transcription.text.trim();
      if (!text) return NextResponse.json({ error: "I couldn’t make out any words. Try recording again." }, { status: 422 });
      return NextResponse.json({ text });
    } finally {
      await releaseVoiceTranscription(parent.id, quota.leaseToken);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to use voice input." }, { status: 401 });
    if (error instanceof DictationAudioValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof VoiceQuotaUnavailableError) return NextResponse.json({ error: "Voice input is temporarily unavailable." }, { status: 503 });
    return NextResponse.json({ error: "I couldn’t transcribe that recording. Try again." }, { status: 500 });
  }
}

function quotaDeniedResponse(reason: VoiceQuotaDenialReason, retryAfter: number) {
  const error = reason === "daily_limit"
    ? "You’ve reached today’s voice limit. You can still type your message."
    : reason === "concurrent"
      ? "Your other voice recording is still being transcribed. Try again shortly."
      : reason === "capacity"
        ? "Voice input is busy right now. Try again shortly."
        : "Too many voice requests. Try again shortly.";
  return NextResponse.json({ error }, {
    status: reason === "capacity" ? 503 : 429,
    headers: { "retry-after": String(Math.max(1, retryAfter)) },
  });
}
