export function isAssignmentGuidanceRequest(request: string) {
  const normalized = request.trim().replace(/^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)/i, "");
  if (!normalized) return false;
  if (/[?]\s*$/.test(normalized)) return true;
  return /^(?:how|what|why|when|where|which)\b/i.test(normalized)
    || /^(?:help\s+me\s+(?:teach|explain|introduce)|explain\s+(?:how|this|the)|teach\s+me\s+how)\b/i.test(normalized);
}

export function assignmentGuidanceRequest(input: { title: string; subject: string; request: string }) {
  return `The parent is working with the current ${input.subject} assignment “${input.title}” and asked: “${input.request.trim()}” Answer the question directly with a concrete teaching approach grounded in this assignment’s instructions, curriculum context, and learner stage. Do not treat the question as a note, claim that records changed, or create extra work unless the parent asked for it.`;
}

export function explicitlyMentionedStudentId(request: string, students: Array<{ id: string; displayName: string }>) {
  const matches = students.filter((student) => {
    const name = student.displayName.trim();
    if (!name) return false;
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?:['’]?s)?(?=$|[^\\p{L}\\p{N}])`, "iu").test(request);
  });
  return matches.length === 1 ? matches[0].id : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
