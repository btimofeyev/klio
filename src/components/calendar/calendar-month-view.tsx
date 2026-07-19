"use client";

import { CalendarPlus, ChevronRight } from "lucide-react";
import type { AssignmentDTO, CalendarConflictDTO } from "@/lib/data/operations";
import type { StudentDTO } from "@/lib/data/workspace";
import { monthGrid } from "@/lib/calendar/month";
import { analyzeDayLoad } from "@/lib/schedule/availability";
import { calculateSharedParentAvailableMinutes, findParentAttentionConflicts } from "@/lib/schedule/parent-attention";

export function CalendarMonthView(props: {
  anchorDate: string;
  selectedDate: string;
  currentDate: string;
  scopeStudentId: string;
  familyLearningDays: unknown;
  students: StudentDTO[];
  assignments: AssignmentDTO[];
  conflicts: CalendarConflictDTO[];
  onSelectDate: (date: string) => void;
  onViewWeek: () => void;
  onAddConflict: (date: string, trigger: HTMLElement) => void;
  onEditConflict: (conflict: CalendarConflictDTO, trigger: HTMLElement) => void;
}) {
  const visibleStudents = props.scopeStudentId === "all" ? props.students : props.students.filter((student) => student.id === props.scopeStudentId);
  return <main className="calendar-month" aria-label="Monthly calendar"><div className="calendar-month-weekdays" aria-hidden="true">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-month-grid">{monthGrid(props.anchorDate).map((day) => {
    const assignments = props.assignments.filter((item) => item.scheduledDate === day.date && item.status !== "skipped" && (props.scopeStudentId === "all" || item.studentId === props.scopeStudentId));
    const conflicts = props.conflicts.filter((item) => item.conflictDate === day.date && (props.scopeStudentId === "all" || item.studentId === null || item.studentId === props.scopeStudentId));
    const minutes = assignments.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
    const analyses = visibleStudents.map((student) => analyzeDayLoad({ date: day.date, studentId: student.id, dailyCapacityMinutes: student.dailyCapacityMinutes ?? 180, schedulePreferences: student.schedulePreferences, familyLearningDays: props.familyLearningDays, conflicts: props.conflicts, assignments: props.assignments }));
    const allDayBlocked = props.scopeStudentId === "all" ? conflicts.some((item) => item.allDay && item.studentId === null) : analyses.some((item) => item.allDayBlocked);
    const overCapacity = analyses.some((item) => item.overCapacity);
    const parentMinutes = assignments.reduce((sum, item) => sum + item.resolvedParentMinutes, 0);
    const involvedStudents = new Set(assignments.filter((item) => item.resolvedParentMinutes > 0).map((item) => item.studentId));
    const parentAvailableMinutes = calculateSharedParentAvailableMinutes(analyses.filter((_, index) => involvedStudents.has(visibleStudents[index].id)));
    const parentOverCapacity = parentMinutes > 0 && parentMinutes > parentAvailableMinutes;
    const parentCollision = findParentAttentionConflicts(assignments.map((item) => ({ id: item.id, studentId: item.studentId, scheduledStart: item.scheduledTime, requirement: { mode: item.resolvedAttentionMode, lessonMinutes: item.estimatedMinutes ?? 0, parentMinutes: item.resolvedParentMinutes, inherited: item.attentionInherited, source: item.attentionSource } }))).length > 0;
    const selected = day.date === props.selectedDate;
    return <section className={`${day.inMonth ? "" : "outside-month"} ${day.date === props.currentDate ? "today" : ""} ${selected ? "selected" : ""} ${allDayBlocked ? "all-day-blocked" : ""} ${overCapacity || parentCollision || parentOverCapacity ? "over-capacity" : ""}`} aria-label={monthDayLabel(day.date)} key={day.date}>
      <header><button type="button" className="month-date" onClick={() => props.onSelectDate(day.date)} aria-current={day.date === props.currentDate ? "date" : undefined}><span>{weekday(day.date)}</span><strong>{Number(day.date.slice(-2))}</strong></button><button type="button" className="month-add-conflict" onClick={(event) => props.onAddConflict(day.date, event.currentTarget)} aria-label={`Add conflict on ${monthDayLabel(day.date)}`}><CalendarPlus size={13} /></button></header>
      <div className="month-day-summary">{assignments.length ? <span><b>{assignments.length}</b> {assignments.length === 1 ? "lesson" : "lessons"} · {minutes} min</span> : <span className="month-open">No lessons</span>}{conflicts.slice(0, 2).map((conflict) => <button type="button" onClick={(event) => props.onEditConflict(conflict, event.currentTarget)} key={conflict.id}><i />{conflict.title}</button>)}{conflicts.length > 2 ? <small>+{conflicts.length - 2} conflicts</small> : null}{allDayBlocked ? <em>Teaching blocked</em> : parentCollision ? <em>Parent time overlaps</em> : parentOverCapacity ? <em>Parent time does not fit</em> : overCapacity ? <em>Over available time</em> : null}</div>
      {selected ? <button type="button" className="month-open-week" onClick={props.onViewWeek}>Open this week <ChevronRight size={12} /></button> : null}
    </section>;
  })}</div></main>;
}

function weekday(date: string) { return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
function monthDayLabel(date: string) { return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
