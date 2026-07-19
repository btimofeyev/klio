import "server-only";

import { parseBuffer } from "music-metadata";
import { Decoder, Reader } from "ts-ebml";
import { dictationDurationValidationError, normalizedAudioType } from "@/lib/voice/dictation";

export class DictationAudioValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DictationAudioValidationError";
  }
}

export async function inspectDictationAudio(buffer: Uint8Array, mimeType: string) {
  try {
    const normalizedType = normalizedAudioType(mimeType);
    const durationSeconds = normalizedType === "audio/webm"
      ? inspectWebmBlockDuration(buffer)
      : (await parseBuffer(buffer, {
          mimeType: normalizedType,
          size: buffer.byteLength,
        }, {
          duration: true,
          skipCovers: true,
        })).format.duration ?? Number.NaN;
    const validationError = dictationDurationValidationError(durationSeconds);
    if (validationError) throw new DictationAudioValidationError(validationError);
    return {
      durationSeconds,
      billableSeconds: Math.max(1, Math.ceil(durationSeconds)),
    };
  } catch (error) {
    if (error instanceof DictationAudioValidationError) throw error;
    throw new DictationAudioValidationError("I couldn’t read that recording. Try recording it again.");
  }
}

function inspectWebmBlockDuration(buffer: Uint8Array) {
  const decoder = new Decoder();
  const reader = new Reader();
  reader.logging = false;
  reader.drop_default_duration = false;
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  for (const element of decoder.decode(bytes)) reader.read(element);
  reader.stop();
  return reader.duration * reader.timestampScale / 1_000_000_000;
}
