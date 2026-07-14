create unique index curriculum_units_one_active_course_idx
  on public.curriculum_units (family_id, student_id, lower(subject), lower(title))
  where status <> 'archived';

insert into public.curriculum_units (
  family_id,
  student_id,
  created_by,
  subject,
  title
)
select
  ss.family_id,
  ss.student_id,
  ss.created_by,
  ss.name,
  ss.course_name
from public.student_subjects ss
where ss.status = 'active'
  and nullif(btrim(ss.course_name), '') is not null
  and not exists (
    select 1
    from public.curriculum_units cu
    where cu.family_id = ss.family_id
      and cu.student_id = ss.student_id
      and lower(cu.subject) = lower(ss.name)
      and lower(cu.title) = lower(ss.course_name)
      and cu.status <> 'archived'
  );

comment on index public.curriculum_units_one_active_course_idx is
  'A learner adds a subject/course combination to the curriculum library once.';
