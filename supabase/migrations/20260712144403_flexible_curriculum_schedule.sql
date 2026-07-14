-- A family's working schedule is not an artifact. Parent-owned curriculum blocks
-- may stand alone while Klio-generated support can still link back to an artifact.
alter table public.weekly_plan_items
  alter column artifact_id drop not null;

alter table public.weekly_plan_items
  add column scheduled_time time,
  add column curriculum_url text,
  add column source_kind text not null default 'parent'
    check (source_kind in ('parent', 'klio', 'imported')),
  add column rescheduled_count integer not null default 0
    check (rescheduled_count between 0 and 100);

alter table public.weekly_plan_items
  add constraint weekly_plan_items_curriculum_url_length
  check (curriculum_url is null or char_length(curriculum_url) <= 2000);

create index weekly_plan_items_family_schedule_idx
  on public.weekly_plan_items(family_id, scheduled_date, scheduled_time, position);
