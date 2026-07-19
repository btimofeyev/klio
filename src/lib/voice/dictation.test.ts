import { describe, expect, it } from "vitest";
import {
  MAX_DICTATION_BYTES,
  MAX_DICTATION_SECONDS,
  appendDictationText,
  dictationFileName,
  dictationDurationValidationError,
  dictationValidationError,
  formatDictationDuration,
  normalizedAudioType,
} from "./dictation";

describe("voice dictation", () => {
  it("normalizes browser codec metadata and chooses a supported filename", () => {
    expect(normalizedAudioType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(dictationFileName("audio/mp4;codecs=mp4a.40.2")).toBe("voice-input.mp4");
  });

  it("appends a transcript without replacing an existing draft", () => {
    expect(appendDictationText("Maya finished math.", "She needed help on question four.")).toBe("Maya finished math. She needed help on question four.");
    expect(appendDictationText("Maya finished math.  ", "She needed help.")).toBe("Maya finished math. She needed help.");
    expect(appendDictationText("", "  New voice note.  ")).toBe("New voice note.");
    expect(appendDictationText("Keep this draft", "   ")).toBe("Keep this draft");
  });

  it("rejects empty, oversized, and unsupported recordings", () => {
    expect(dictationValidationError({ size: 0, type: "audio/webm" })).toMatch(/didn’t hear/i);
    expect(dictationValidationError({ size: MAX_DICTATION_BYTES + 1, type: "audio/webm" })).toMatch(/too long/i);
    expect(dictationValidationError({ size: 100, type: "video/webm" })).toMatch(/unsupported/i);
    expect(dictationValidationError({ size: 100, type: "audio/ogg;codecs=opus" })).toBeNull();
  });

  it("rejects missing and over-limit decoded durations", () => {
    expect(dictationDurationValidationError(Number.NaN)).toMatch(/couldn’t read/i);
    expect(dictationDurationValidationError(0)).toMatch(/couldn’t read/i);
    expect(dictationDurationValidationError(MAX_DICTATION_SECONDS)).toBeNull();
    expect(dictationDurationValidationError(MAX_DICTATION_SECONDS + 0.01)).toMatch(/under two minutes/i);
  });

  it("formats recording feedback as elapsed minutes and seconds", () => {
    expect(formatDictationDuration(0)).toBe("0:00");
    expect(formatDictationDuration(67)).toBe("1:07");
  });
});
