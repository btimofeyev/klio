import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DICTATION_REQUEST_BYTES } from "@/lib/voice/dictation";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  inspect: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  requireParent: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    audio = { transcriptions: { create: mocks.transcribe } };
  },
  toFile: vi.fn(async (value: Uint8Array, name: string, options: { type: string }) => new File([new Uint8Array(value).buffer as ArrayBuffer], name, options)),
}));
vi.mock("@/lib/auth/require-parent", () => ({ requireParentApi: mocks.requireParent }));
vi.mock("@/lib/env", () => ({ serverEnv: { openAiApiKey: "test-key" } }));
vi.mock("@/lib/voice/audio-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/audio-validation")>();
  return { ...actual, inspectDictationAudio: mocks.inspect };
});
vi.mock("@/lib/voice/quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/quota")>();
  return { ...actual, claimVoiceTranscription: mocks.claim, releaseVoiceTranscription: mocks.release };
});

import { DictationAudioValidationError } from "@/lib/voice/audio-validation";
import { POST } from "./route";

describe("POST /api/transcribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireParent.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    mocks.inspect.mockResolvedValue({ durationSeconds: 12.4, billableSeconds: 13 });
    mocks.claim.mockResolvedValue({ allowed: true, leaseToken: "22222222-2222-4222-8222-222222222222", retryAfter: 0 });
    mocks.release.mockResolvedValue(true);
    mocks.transcribe.mockResolvedValue({ text: "Maya finished math." });
  });

  it("validates duration, claims durable quota, and always releases the lease", async () => {
    const response = await POST(audioRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: "Maya finished math." });
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(mocks.claim).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", 13);
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  });

  it("rejects unreadable or over-limit decoded audio before quota or provider use", async () => {
    mocks.inspect.mockRejectedValue(new DictationAudioValidationError("That recording is too long. Keep voice input under two minutes."));
    const response = await POST(audioRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/under two minutes/i) });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("returns the durable limiter response without calling OpenAI", async () => {
    mocks.claim.mockResolvedValue({ allowed: false, reason: "rate_limit", retryAfter: 47 });
    const response = await POST(audioRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("47");
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases the distributed slot when the provider fails", async () => {
    mocks.transcribe.mockRejectedValue(new Error("provider unavailable"));
    const response = await POST(audioRequest());
    expect(response.status).toBe(500);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rejects an oversized multipart request before buffering it", async () => {
    const request = new Request("http://localhost/api/transcribe", {
      method: "POST",
      headers: { "content-length": String(MAX_DICTATION_REQUEST_BYTES + 1) },
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});

function audioRequest() {
  const body = new FormData();
  body.set("file", new File([new Uint8Array([1, 2, 3, 4])], "voice.webm", { type: "audio/webm" }));
  return new Request("http://localhost/api/transcribe", { method: "POST", body });
}
