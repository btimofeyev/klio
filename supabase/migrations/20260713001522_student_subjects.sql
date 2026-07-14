alter table public.students
  add constraint students_id_family_unique unique (id, family_id);

create table public.student_subjects (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  course_name text check (course_name is null or char_length(course_name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade
);

create unique index student_subjects_active_name_idx
  on public.student_subjects(family_id, student_id, lower(name))
  where status = 'active';
create index student_subjects_family_student_idx
  on public.student_subjects(family_id, student_id, position);

create trigger student_subjects_set_updated_at before update on public.student_subjects
for each row execute function private.set_updated_at();
create trigger student_subjects_bump_agent_context after insert or update or delete on public.student_subjects
for each row execute function private.bump_family_agent_context();

alter table public.student_subjects enable row level security;
create policy "student subjects visible to family"
on public.student_subjects for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "student subjects insertable by family editors"
on public.student_subjects for insert to authenticated
with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "student subjects editable by family editors"
on public.student_subjects for update to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)));
create policy "student subjects deletable by family editors"
on public.student_subjects for delete to authenticated
using ((select private.can_edit_family(family_id)));

grant select, insert, update, delete on public.student_subjects to authenticated;

comment on table public.student_subjects is
  'The durable subjects and optional course names a family is teaching to one learner.';
