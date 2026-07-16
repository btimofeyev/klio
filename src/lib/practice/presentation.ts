import type { DynamicActivity } from "./spec";

export function estimatedPracticeMinutes(activities: DynamicActivity[]) {
  const minutes = activities.reduce((total, activity) => total + (activity.type === "written_response" || activity.type === "graph_line" ? 3 : 2), 0);
  return Math.max(5, Math.round(minutes / 5) * 5);
}
