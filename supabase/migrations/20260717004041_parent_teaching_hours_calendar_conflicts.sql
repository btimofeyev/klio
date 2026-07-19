create table public.calendar_conflicts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid,
  conflict_date date not null,
  all_day boolean not null default false,
  starts_at time,
  ends_at time,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade,
  constraint calendar_conflicts_time_shape check (
    (all_day and starts_at is null and ends_at is null)
    or
    (not all_day and starts_at is not null and ends_at is not null and ends_at > starts_at)
  )
);

create index calendar_conflicts_family_date_idx
  on public.calendar_conflicts(family_id, conflict_date);
create index calendar_conflicts_family_student_date_idx
  on public.calendar_conflicts(family_id, student_id, conflict_date);

create trigger calendar_conflicts_set_updated_at before update on public.calendar_conflicts
for each row execute function private.set_updated_at();
create trigger calendar_conflicts_bump_agent_context after insert or update or delete on public.calendar_conflicts
for each row execute function private.bump_family_agent_context();

alter table public.calendar_conflicts enable row level security;

create policy "calendar conflicts visible to family"
on public.calendar_conflicts for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "calendar conflicts created by family editors"
on public.calendar_conflicts for insert to authenticated
with check (
  (select private.can_edit_family(family_id))
  and created_by = (select auth.uid())
);

create policy "calendar conflicts editable by family editors"
on public.calendar_conflicts for update to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)));

create policy "calendar conflicts deletable by family editors"
on public.calendar_conflicts for delete to authenticated
using ((select private.can_edit_family(family_id)));

grant select, insert, delete on public.calendar_conflicts to authenticated;
grant update (student_id, conflict_date, all_day, starts_at, ends_at, title, note)
  on public.calendar_conflicts to authenticated;

comment on table public.calendar_conflicts is
  'Parent-created one-time constraints on family or learner teaching availability.';
