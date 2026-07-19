export const MAX_DICTATION_BYTES = 4 * 1024 * 1024;
export const MAX_DICTATION_REQUEST_BYTES = MAX_DICTATION_BYTES + 256 * 1024;
export const MAX_DICTATION_SECONDS = 120;

const supportedAudioTypes = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "mp4"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/ogg", "ogg"],
]);

export function normalizedAudioType(value: string) {
  return value.toLowerCase().split(";", 1)[0].trim();
}

export function dictationFileName(mimeType: string) {
  return `voice-input.${supportedAudioTypes.get(normalizedAudioType(mimeType)) ?? "webm"}`;
}

export function dictationValidationError(file: { size: number; type: string }) {
  if (file.size <= 0) return "I didn’t hear anything. Try recording again.";
  if (file.size > MAX_DICTATION_BYTES) return "That recording is too long. Keep voice input under two minutes.";
  if (!supportedAudioTypes.has(normalizedAudioType(file.type))) return "This browser recorded an unsupported audio format.";
  return null;
}

export function dictationDurationValidationError(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return "I couldn’t read that recording. Try recording it again.";
  if (durationSeconds > MAX_DICTATION_SECONDS) return "That recording is too long. Keep voice input under two minutes.";
  return null;
}

export function appendDictationText(draft: string, transcript: string) {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return draft;
  const cleanDraft = draft.trimEnd();
  if (!cleanDraft) return cleanTranscript;
  return `${cleanDraft} ${cleanTranscript}`;
}

export function formatDictationDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
