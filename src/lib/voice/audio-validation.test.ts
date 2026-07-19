import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { DictationAudioValidationError, inspectDictationAudio } from "./audio-validation";

describe("server-side dictation audio validation", () => {
  it("reads the decoded duration and rounds quota usage up", async () => {
    const result = await inspectDictationAudio(wavBuffer(1.25), "audio/wav");
    expect(result.durationSeconds).toBeCloseTo(1.25, 2);
    expect(result.billableSeconds).toBe(2);
  });

  it("calculates MediaRecorder-style WebM duration from audio block timestamps", async () => {
    const webm = Uint8Array.from(Buffer.from(WEBM_FIXTURE_BASE64, "base64"));
    const result = await inspectDictationAudio(webm, "audio/webm;codecs=opus");
    expect(result.durationSeconds).toBeCloseTo(1.25, 1);
    expect(result.billableSeconds).toBe(2);
  });

  it("rejects decoded audio longer than two minutes", async () => {
    await expect(inspectDictationAudio(wavBuffer(120.25), "audio/wav"))
      .rejects.toThrow(/under two minutes/i);
  });

  it("rejects bytes that are not a readable audio file", async () => {
    await expect(inspectDictationAudio(new TextEncoder().encode("not audio"), "audio/webm"))
      .rejects.toBeInstanceOf(DictationAudioValidationError);
  });
});

function wavBuffer(durationSeconds: number, sampleRate = 8_000) {
  const sampleCount = Math.ceil(durationSeconds * sampleRate);
  const dataSize = sampleCount;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).fill(128);
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

const WEBM_FIXTURE_BASE64 = "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";
