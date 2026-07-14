type SequenceSource = {
  id: string;
  studentId: string | null;
  scheduledDate: string | null;
  title: string;
  subject: string | null;
};

type ExistingScheduleItem = {
  id?: string;
  studentId: string | null;
  scheduledDate: string | null;
  subject: string | null;
  title?: string;
  scheduledTime?: string | null;
  estimatedMinutes?: number | null;
};

export type NextCurriculumLesson = {
  sourceItemId: string;
  subject: string;
  title: string;
  scheduledDate: string;
  scheduledTime: string | null;
  estimatedMinutes: number | null;
};

export function buildCurriculumSequence(source: SequenceSource, availableDays: string[], existingItems: ExistingScheduleItem[]) {
  if (!source.scheduledDate) return [];
  const match = source.title.match(/^(.*?\b(?:lesson|unit|chapter|module)\s*)(\d+)(.*)$/i);
  if (!match) return [];
  const [, prefix, currentNumber, suffix] = match;
  const count = Math.max(1, Math.min(6, (availableDays.length || 5) - 1));
  const proposal: Array<{ title: string; scheduledDate: string }> = [];
  let candidateDate = source.scheduledDate;
  let nextNumber = Number(currentNumber) + 1;
  for (let attempt = 0; attempt < 30 && proposal.length < count; attempt += 1) {
    candidateDate = nextAvailableDate(candidateDate, availableDays);
    const occupied = existingItems.some((item) => item.studentId === source.studentId && item.scheduledDate === candidateDate && item.subject?.toLowerCase() === source.subject?.toLowerCase());
    if (occupied) continue;
    proposal.push({ title: `${prefix}${nextNumber}${suffix}`, scheduledDate: candidateDate });
    nextNumber += 1;
  }
  return proposal;
}

export function inferNextCurriculumLessons(items: ExistingScheduleItem[], scheduledDate: string): NextCurriculumLesson[] {
  const subjects = [...new Set(items.map((item) => item.subject).filter((subject): subject is string => Boolean(subject)))];
  return subjects.flatMap((subject) => {
    if (items.some((item) => item.subject?.toLowerCase() === subject.toLowerCase() && item.scheduledDate === scheduledDate)) return [];
    const source = items.filter((item) => item.id && item.title && item.scheduledDate && item.scheduledDate < scheduledDate && item.subject?.toLowerCase() === subject.toLowerCase() && parseSequenceTitle(item.title)).sort((a, b) => `${b.scheduledDate}:${b.scheduledTime ?? ""}`.localeCompare(`${a.scheduledDate}:${a.scheduledTime ?? ""}`))[0];
    if (!source?.id || !source.title) return [];
    const parsed = parseSequenceTitle(source.title);
    if (!parsed) return [];
    return [{
      sourceItemId: source.id,
      subject,
      title: `${parsed.prefix}${parsed.number + 1}${parsed.suffix}`,
      scheduledDate,
      scheduledTime: source.scheduledTime ?? null,
      estimatedMinutes: source.estimatedMinutes ?? null,
    }];
  }).sort((a, b) => (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99") || a.subject.localeCompare(b.subject));
}

export function parseSequenceTitle(title: string) {
  const match = title.match(/^(.*?\b(?:lesson|unit|chapter|module)\s*)(\d+)(.*)$/i);
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]), suffix: match[3] };
}

function nextAvailableDate(date: string, availableDays: string[]) {
  const allowed = new Set(availableDays.map((day) => day.toLowerCase()));
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(date, offset);
    const weekday = new Date(`${candidate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
    if (!allowed.size || allowed.has(weekday)) return candidate;
  }
  return addDays(date, 1);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
