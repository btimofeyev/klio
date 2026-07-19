"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, X } from "lucide-react";
import type { ReminderDTO } from "@/lib/data/workspace";

type ReminderAction = "completed" | "dismissed" | "tomorrow";

export function ActivityReminderList({ initialReminders, studentNames }: { initialReminders: ReminderDTO[]; studentNames: Record<string, string> }) {
  const router = useRouter();
  const [reminders, setReminders] = useState(initialReminders);
  const [working, setWorking] = useState<{ id: string; action: ReminderAction } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateReminder(reminder: ReminderDTO, action: ReminderAction) {
    setWorking({ id: reminder.id, action });
    setError(null);
    const body = action === "tomorrow"
      ? { dueAt: tomorrowAtNine().toISOString() }
      : { status: action };
    try {
      const response = await fetch(`/api/reminders/${reminder.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Klio could not update that reminder.");
      setReminders((current) => current.filter((item) => item.id !== reminder.id));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Klio could not update that reminder.");
    } finally {
      setWorking(null);
    }
  }

  if (!reminders.length) {
    return <div className="activity-reminders-empty" role="status"><Check size={18} /><div><strong>No overdue reminders</strong><p>You handled everything in this list.</p></div></div>;
  }

  return <div className="activity-reminder-list">
    {reminders.map((reminder) => {
      const busy = working?.id === reminder.id;
      const learner = reminder.studentId ? studentNames[reminder.studentId] : null;
      return <article key={reminder.id}>
        <span className="activity-reminder-icon" aria-hidden="true"><CalendarClock size={17} /></span>
        <div className="activity-reminder-copy">
          <strong>{reminder.title}</strong>
          <p>{[learner, overdueLabel(reminder.dueAt)].filter(Boolean).join(" · ")}</p>
          {reminder.notes ? <small>{reminder.notes}</small> : null}
        </div>
        <div className="activity-reminder-actions" aria-label={`Actions for ${reminder.title}`}>
          <button type="button" className="primary" disabled={busy} onClick={() => void updateReminder(reminder, "completed")} aria-label={`Mark ${reminder.title} done`}><Check size={14} />{busy && working.action === "completed" ? "Saving…" : "Done"}</button>
          <button type="button" disabled={busy} onClick={() => void updateReminder(reminder, "tomorrow")} aria-label={`Move ${reminder.title} to tomorrow`}>{busy && working.action === "tomorrow" ? "Moving…" : "Tomorrow"}</button>
          <button type="button" className="dismiss" disabled={busy} onClick={() => void updateReminder(reminder, "dismissed")} aria-label={`Dismiss ${reminder.title}`}><X size={14} />Dismiss</button>
        </div>
      </article>;
    })}
    {error ? <p className="activity-reminder-error" role="alert">{error}</p> : null}
  </div>;
}

function tomorrowAtNine() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow;
}

function overdueLabel(value: string | null) {
  if (!value) return "Past due";
  const date = new Date(value);
  const today = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.max(0, Math.round((currentDay - day) / 86_400_000));
  if (days === 0) return `Overdue since ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Due yesterday";
  return `${days} days overdue`;
}
