export type AssignmentForAttention = {
  id: string;
  title: string;
  status: string;
  scheduledDate: string | null;
  scheduledTime?: string | null;
};

const unfinishedStatuses = new Set(["planned", "doing"]);

export function unfinishedAssignmentsBefore<T extends AssignmentForAttention>(assignments: T[], currentDate: string) {
  return assignments
    .filter((item) => item.scheduledDate && item.scheduledDate < currentDate && unfinishedStatuses.has(item.status))
    .sort((a, b) => {
      const byDate = a.scheduledDate!.localeCompare(b.scheduledDate!);
      if (byDate) return byDate;
      const byTime = (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? "");
      return byTime || a.title.localeCompare(b.title);
    });
}
