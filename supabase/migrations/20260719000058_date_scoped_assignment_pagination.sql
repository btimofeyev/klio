create index assignments_family_scheduled_cursor_idx
  on public.assignments(family_id, scheduled_date, scheduled_time, id)
  where scheduled_date is not null;

create index assignments_family_curriculum_cursor_idx
  on public.assignments(family_id, curriculum_unit_id, sequence_number, id)
  where curriculum_unit_id is not null;

create or replace function public.list_scheduled_assignments_page(
  p_family_id uuid,
  p_from date,
  p_to date,
  p_student_id uuid default null,
  p_after_date date default null,
  p_after_time time without time zone default null,
  p_after_id uuid default null,
  p_limit integer default 101
)
returns setof public.assignments
language sql
stable
security invoker
set search_path = ''
as $$
  select page.*
  from (
    select assignment.*
    from public.assignments as assignment
    where p_after_date is null
      and assignment.family_id = p_family_id
      and assignment.scheduled_date between p_from and p_to
      and (p_student_id is null or assignment.student_id = p_student_id)

    union all

    select assignment.*
    from public.assignments as assignment
    where p_after_date is not null
      and assignment.family_id = p_family_id
      and assignment.scheduled_date between p_from and p_to
      and assignment.scheduled_date > p_after_date
      and (p_student_id is null or assignment.student_id = p_student_id)

    union all

    select assignment.*
    from public.assignments as assignment
    where p_after_date is not null
      and p_after_time is not null
      and assignment.family_id = p_family_id
      and assignment.scheduled_date = p_after_date
      and assignment.scheduled_date between p_from and p_to
      and assignment.scheduled_time is not null
      and (assignment.scheduled_time, assignment.id) > (p_after_time, p_after_id)
      and (p_student_id is null or assignment.student_id = p_student_id)

    union all

    select assignment.*
    from public.assignments as assignment
    where p_after_date is not null
      and p_after_time is not null
      and assignment.family_id = p_family_id
      and assignment.scheduled_date = p_after_date
      and assignment.scheduled_date between p_from and p_to
      and assignment.scheduled_time is null
      and (p_student_id is null or assignment.student_id = p_student_id)

    union all

    select assignment.*
    from public.assignments as assignment
    where p_after_date is not null
      and p_after_time is null
      and assignment.family_id = p_family_id
      and assignment.scheduled_date = p_after_date
      and assignment.scheduled_date between p_from and p_to
      and assignment.scheduled_time is null
      and assignment.id > p_after_id
      and (p_student_id is null or assignment.student_id = p_student_id)
  ) as page
  order by page.scheduled_date asc, page.scheduled_time asc nulls last, page.id asc
  limit least(greatest(coalesce(p_limit, 101), 1), 101);
$$;

create or replace function public.list_curriculum_assignments_page(
  p_family_id uuid,
  p_curriculum_unit_id uuid,
  p_student_id uuid default null,
  p_after_sequence integer default null,
  p_after_id uuid default null,
  p_limit integer default 51
)
returns setof public.assignments
language sql
stable
security invoker
set search_path = ''
as $$
  select page.*
  from (
    select assignment.*
    from public.assignments as assignment
    where p_after_id is null
      and assignment.family_id = p_family_id
      and assignment.curriculum_unit_id = p_curriculum_unit_id
      and (p_student_id is null or assignment.student_id = p_student_id)

    union all

    select assignment.*
    from public.assignments as assignment
    where p_after_id is not null
      and p_after_sequence is not null
      and assignment.family_id = p_family_id
      and assignment.curriculum_unit_id = p_curriculum_unit_id
      and assignment.sequence_number is not null
      and (assignment.sequence_number, assignment.id) > (p_after_sequence, p_after_id)
      and (p_student_id is null or assignment.student_id = p_student_id)

    union all

    select assignment.*
    from public.assignments as assignment
    where p_after_id is not null
      and p_after_sequence is not null
      and assignment.family_id = p_family_id
      and assignment.curriculum_unit_id = p_curriculum_unit_id
      and assignment.sequence_number is null
      and (p_student_id is null or assignment.student_id = p_student_id)

    union all

    select assignment.*
    from public.assignments as assignment
    where p_after_id is not null
      and p_after_sequence is null
      and assignment.family_id = p_family_id
      and assignment.curriculum_unit_id = p_curriculum_unit_id
      and assignment.sequence_number is null
      and assignment.id > p_after_id
      and (p_student_id is null or assignment.student_id = p_student_id)
  ) as page
  where exists (
    select 1
    from public.curriculum_units as unit
    where unit.id = p_curriculum_unit_id
      and unit.family_id = p_family_id
      and (p_student_id is null or unit.student_id = p_student_id)
  )
  order by page.sequence_number asc nulls last, page.id asc
  limit least(greatest(coalesce(p_limit, 51), 1), 101);
$$;

create or replace function public.curriculum_assignment_stats(
  p_family_id uuid,
  p_student_id uuid default null
)
returns table (
  curriculum_unit_id uuid,
  assignment_count bigint,
  completed_count bigint,
  active_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    unit.id as curriculum_unit_id,
    count(assignment.id) as assignment_count,
    count(assignment.id) filter (where assignment.status = 'completed') as completed_count,
    count(assignment.id) filter (where assignment.status not in ('completed', 'skipped')) as active_count
  from public.curriculum_units as unit
  left join public.assignments as assignment
    on assignment.family_id = unit.family_id
   and assignment.curriculum_unit_id = unit.id
   and (p_student_id is null or assignment.student_id = p_student_id)
  where unit.family_id = p_family_id
    and unit.status <> 'archived'
    and (p_student_id is null or unit.student_id = p_student_id)
  group by unit.id
  order by unit.id;
$$;

revoke execute on function public.list_scheduled_assignments_page(uuid, date, date, uuid, date, time without time zone, uuid, integer) from public, anon;
revoke execute on function public.list_curriculum_assignments_page(uuid, uuid, uuid, integer, uuid, integer) from public, anon;
revoke execute on function public.curriculum_assignment_stats(uuid, uuid) from public, anon;

grant execute on function public.list_scheduled_assignments_page(uuid, date, date, uuid, date, time without time zone, uuid, integer) to authenticated, service_role;
grant execute on function public.list_curriculum_assignments_page(uuid, uuid, uuid, integer, uuid, integer) to authenticated, service_role;
grant execute on function public.curriculum_assignment_stats(uuid, uuid) to authenticated, service_role;
