export const COMMON_SUBJECTS = [
  "Math",
  "Language Arts",
  "Science",
  "History",
  "Social Studies",
  "Art",
  "Music",
  "Physical Education",
  "Life Skills",
] as const;

export function subjectFieldKey(subject: string) {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function subjectSlug(subject: string) {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
