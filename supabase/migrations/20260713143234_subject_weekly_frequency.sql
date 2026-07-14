alter table public.student_subjects
  add column weekly_frequency smallint not null default 5
    check (weekly_frequency between 1 and 7);

update public.curriculum_units unit
set schedule_rule = jsonb_set(
  coalesce(unit.schedule_rule, '{}'::jsonb),
  '{weeklyFrequency}',
  to_jsonb(subject.weekly_frequency),
  true
)
from public.student_subjects subject
where subject.family_id = unit.family_id
  and subject.student_id = unit.student_id
  and lower(subject.name) = lower(unit.subject)
  and subject.status = 'active';

comment on column public.student_subjects.weekly_frequency is
  'Parent-selected number of sessions this subject should receive in a normal week.';
