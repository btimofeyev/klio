export type DayOrderItem = { id: string; scheduledTime: string | null };

export function reorderDayIds(ids: string[], movedId: string, targetId: string, placeAfter: boolean) {
  if (movedId === targetId || !ids.includes(movedId) || !ids.includes(targetId)) return ids;
  const next = ids.filter((id) => id !== movedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, movedId);
  return next;
}

export function dayOrderTimeUpdates(items: DayOrderItem[], orderedIds: string[]) {
  if (items.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) throw new Error("INVALID_DAY_ORDER");
  const byId = new Map(items.map((item) => [item.id, item]));
  if (orderedIds.some((id) => !byId.has(id))) throw new Error("INVALID_DAY_ORDER");

  const parsed = items.map((item) => item.scheduledTime ? timeToSeconds(item.scheduledTime) : null);
  const completeAndUnique = parsed.every((value): value is number => value !== null) && new Set(parsed).size === parsed.length;
  const slots = completeAndUnique
    ? [...parsed].sort((a, b) => a - b)
    : generatedSlots(parsed.filter((value): value is number => value !== null), items.length);

  return orderedIds.map((id, index) => ({ id, scheduledTime: secondsToTime(slots[index]), previousTime: byId.get(id)?.scheduledTime ?? null, position: index }));
}

function generatedSlots(existing: number[], count: number) {
  const interval = 5 * 60;
  const preferredStart = existing.length ? Math.min(...existing) : 8 * 60 * 60 + 30 * 60;
  const latestStart = 24 * 60 * 60 - 1 - Math.max(0, count - 1) * interval;
  const start = Math.max(0, Math.min(preferredStart, latestStart));
  return Array.from({ length: count }, (_, index) => start + index * interval);
}

function timeToSeconds(value: string) {
  const [hours = 0, minutes = 0, seconds = 0] = value.split(":").map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function secondsToTime(value: number) {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const seconds = Math.floor(value % 60);
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
