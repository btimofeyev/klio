-- A selected subject is enough for Klio to build a schedule. A specific course
-- name improves the label but is not required to create a curriculum sequence.
insert into public.curriculum_units (
  family_id,
  student_id,
  created_by,
  subject,
  title,
  schedule_rule
)
select
  ss.family_id,
  ss.student_id,
  ss.created_by,
  ss.name,
  coalesce(nullif(btrim(ss.course_name), ''), ss.name),
  jsonb_build_object('weeklyFrequency', ss.weekly_frequency)
from public.student_subjects ss
where ss.status = 'active'
  and not exists (
    select 1
    from public.curriculum_units cu
    where cu.family_id = ss.family_id
      and cu.student_id = ss.student_id
      and lower(cu.subject) = lower(ss.name)
      and cu.status <> 'archived'
  );
