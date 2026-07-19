export type FirstWeekUnit = {
  id: string;
  subject: string;
  title: string;
  sequenceLabel: string;
  nextSequenceNumber: number;
  defaultMinutes: number;
  weeklyFrequency: number;
  curriculumUrl: string | null;
  scheduledTime: string | null;
  attentionMode?: "unspecified" | "parent_led" | "independent" | "flexible";
  parentAttentionMinutes?: number | null;
};

export type ExistingWeekAssignment = {
  curriculumUnitId: string | null;
  scheduledDate: string | null;
  estimatedMinutes: number | null;
  status: string;
};

export type DateAvailability = {
  availableMinutes: number;
  blockedIntervals?: Array<{ start: number; end: number }>;
  teachingWindow?: { start: string; end: string } | null;
};

export type FirstWeekAssignment = {
  curriculumUnitId: string;
  subject: string;
  title: string;
  sequenceNumber: number;
  scheduledDate: string;
  scheduledTime: string | null;
  estimatedMinutes: number;
  curriculumUrl: string | null;
};

export function buildFirstWeekAssignments(input: {
  units: FirstWeekUnit[];
  dates: string[];
  existing: ExistingWeekAssignment[];
  dailyCapacityMinutes: number;
  availabilityByDate?: Record<string, DateAvailability>;
}) {
  const activeUnits = input.units.filter((unit) => unit.defaultMinutes <= Math.max(input.dailyCapacityMinutes, ...input.dates.map(capacityForDate)));

  const existingByUnit = new Map<string, number>();
  const baseUsedByDate = new Map(input.dates.map((date) => [date, 0]));
  const baseOccupiedByDate = new Map(input.dates.map((date) => [date, new Set<string>()]));
  for (const item of input.existing.filter((assignment) => assignment.scheduledDate && input.dates.includes(assignment.scheduledDate) && assignment.status !== "skipped")) {
    baseUsedByDate.set(item.scheduledDate!, (baseUsedByDate.get(item.scheduledDate!) ?? 0) + (item.estimatedMinutes ?? 0));
    if (item.curriculumUnitId) {
      baseOccupiedByDate.get(item.scheduledDate!)?.add(item.curriculumUnitId);
      existingByUnit.set(item.curriculumUnitId, (existingByUnit.get(item.curriculumUnitId) ?? 0) + 1);
    }
  }

  const remainingByUnit = new Map(activeUnits.map((unit) => [unit.id, Math.max(0, Math.min(unit.weeklyFrequency, input.dates.length) - (existingByUnit.get(unit.id) ?? 0))]));
  const availableMinutes = input.dates.reduce((sum, date) => sum + Math.max(0, capacityForDate(date) - (baseUsedByDate.get(date) ?? 0)), 0);
  const requestedMinutes = activeUnits.reduce((sum, unit) => sum + (remainingByUnit.get(unit.id) ?? 0) * unit.defaultMinutes, 0);
  const sessionCount = [...remainingByUnit.values()].reduce((sum, count) => sum + count, 0);
  if (!sessionCount || sessionCount * 15 > availableMinutes) return [];
  const scale = requestedMinutes > availableMinutes ? availableMinutes / requestedMinutes : 1;
  const durationByUnit = new Map(activeUnits.map((unit) => [unit.id, Math.max(minimumDuration(unit), Math.floor(unit.defaultMinutes * scale / 5) * 5)]));

  const sessions = activeUnits.flatMap((unit) => {
    const count = remainingByUnit.get(unit.id) ?? 0;
    return Array.from({ length: count }, (_, occurrence) => ({
      unit,
      idealIndex: Math.min(input.dates.length - 1, Math.round(((occurrence + 0.5) * input.dates.length / count) - 0.5)),
    }));
  }).sort((a, b) => a.idealIndex - b.idealIndex || b.unit.weeklyFrequency - a.unit.weeklyFrequency || a.unit.subject.localeCompare(b.unit.subject));

  let placed = placeSessions(durationByUnit);
  while (placed.length < sessionCount && activeUnits.some((unit) => (durationByUnit.get(unit.id) ?? minimumDuration(unit)) > minimumDuration(unit))) {
    for (const unit of activeUnits) durationByUnit.set(unit.id, Math.max(minimumDuration(unit), (durationByUnit.get(unit.id) ?? unit.defaultMinutes) - 5));
    placed = placeSessions(durationByUnit);
  }

  const nextSequence = new Map(activeUnits.map((unit) => [unit.id, unit.nextSequenceNumber]));
  return placed
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.unit.subject.localeCompare(b.unit.subject))
    .map(({ unit, scheduledDate, duration }): FirstWeekAssignment => {
      const sequenceNumber = nextSequence.get(unit.id) ?? unit.nextSequenceNumber;
      nextSequence.set(unit.id, sequenceNumber + 1);
      return {
        curriculumUnitId: unit.id,
        subject: unit.subject,
        title: `${unit.title} · ${unit.sequenceLabel} ${sequenceNumber}`,
        sequenceNumber,
        scheduledDate,
        scheduledTime: unit.scheduledTime,
        estimatedMinutes: duration,
        curriculumUrl: unit.curriculumUrl,
      };
    });

  function placeSessions(durations: Map<string, number>) {
    const usedByDate = new Map(baseUsedByDate);
    const occupiedByDate = new Map([...baseOccupiedByDate].map(([date, units]) => [date, new Set(units)]));
    const result: Array<{ unit: FirstWeekUnit; scheduledDate: string; duration: number }> = [];
    for (const session of sessions) {
      const duration = durations.get(session.unit.id) ?? session.unit.defaultMinutes;
      const scheduledDate = [...input.dates]
        .sort((a, b) => {
          const aIndex = input.dates.indexOf(a); const bIndex = input.dates.indexOf(b);
          return (usedByDate.get(a) ?? 0) - (usedByDate.get(b) ?? 0) || Math.abs(aIndex - session.idealIndex) - Math.abs(bIndex - session.idealIndex) || a.localeCompare(b);
        })
        .find((date) => !occupiedByDate.get(date)?.has(session.unit.id) && (usedByDate.get(date) ?? 0) + duration <= capacityForDate(date) && timedPlacementFits(date, session.unit.scheduledTime, duration));
      if (!scheduledDate) continue;
      result.push({ unit: session.unit, scheduledDate, duration });
      occupiedByDate.get(scheduledDate)?.add(session.unit.id);
      usedByDate.set(scheduledDate, (usedByDate.get(scheduledDate) ?? 0) + duration);
    }
    return result;
  }

  function capacityForDate(date: string) { return input.availabilityByDate?.[date]?.availableMinutes ?? input.dailyCapacityMinutes; }

  function timedPlacementFits(date: string, scheduledTime: string | null, duration: number) {
    if (!scheduledTime) return true;
    const start = timeMinutes(scheduledTime);
    if (start === null) return false;
    const end = start + duration;
    const availability = input.availabilityByDate?.[date];
    const windowStart = availability?.teachingWindow ? timeMinutes(availability.teachingWindow.start) : 0;
    const windowEnd = availability?.teachingWindow ? timeMinutes(availability.teachingWindow.end) : 1440;
    if (windowStart === null || windowEnd === null || start < windowStart || end > windowEnd) return false;
    return !(availability?.blockedIntervals ?? []).some((interval) => start < interval.end && end > interval.start);
  }
}

function minimumDuration(unit: FirstWeekUnit) {
  return unit.attentionMode === "flexible" ? Math.max(15, unit.parentAttentionMinutes ?? 0) : 15;
}

function timeMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
