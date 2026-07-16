-- Repeatable local-development seed for btimofeyev@gmail.com.
-- Bootstraps the family when the Auth account is new, preserves existing
-- learners, adds Maya (7th) and Noah (2nd), and builds a configurable number
-- of completed school weeks plus the current week for all three learners.
-- Run with:
--   psql 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' \
--     -v ON_ERROR_STOP=1 -f scripts/seed-timofeyev-eight-weeks.sql
-- For one realistic month plus the current week, add: -v completed_weeks=4

\if :{?completed_weeks}
\else
\set completed_weeks 8
\endif

begin;

do $$
declare
  target_parent uuid;
  target_family uuid;
  owner_family_count integer;
begin
  select id into target_parent
  from auth.users
  where lower(email) = 'btimofeyev@gmail.com' and deleted_at is null;

  if target_parent is null then
    raise exception 'Create the local Auth account btimofeyev@gmail.com before applying this seed';
  end if;

  insert into public.parent_profiles(user_id, display_name)
  values (target_parent, 'Ben Timofeyev')
  on conflict (user_id) do update set display_name = excluded.display_name;

  select count(*), min(fm.family_id::text)::uuid
  into owner_family_count, target_family
  from public.family_members fm
  where fm.user_id = target_parent and fm.role = 'owner';

  if owner_family_count > 1 then
    raise exception 'Expected at most one owner workspace for btimofeyev@gmail.com';
  elsif owner_family_count = 0 then
    insert into public.families(name, created_by, timezone, available_days, weekly_minutes)
    values ('Timofeyev Family', target_parent, 'America/New_York', '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb, 3000)
    returning id into target_family;
    insert into public.family_members(family_id, user_id, role)
    values (target_family, target_parent, 'owner');
  end if;

  insert into public.students(
    id, family_id, display_name, birth_year, grade_band, learning_preferences,
    daily_capacity_minutes, schedule_preferences
  )
  values (
    md5(target_family::text || ':student:jacob')::uuid, target_family, 'Jacob', 2011, '9-12',
    'Works best with a clear checklist, short focused blocks, discussion before writing, and visible examples.',
    240, '{"learningDays":["Mon","Tue","Wed","Thu","Fri"]}'::jsonb
  )
  on conflict (id) do update set
    display_name = excluded.display_name, birth_year = excluded.birth_year,
    grade_band = excluded.grade_band, learning_preferences = excluded.learning_preferences,
    daily_capacity_minutes = excluded.daily_capacity_minutes,
    schedule_preferences = excluded.schedule_preferences, active = true, updated_at = now();
end
$$;

create temp table _seed_context on commit drop as
select u.id as parent_id, f.id as family_id
from auth.users u
join public.family_members fm on fm.user_id = u.id and fm.role = 'owner'
join public.families f on f.id = fm.family_id
where lower(u.email) = 'btimofeyev@gmail.com';

do $$
begin
  if (select count(*) from _seed_context) <> 1 then
    raise exception 'Expected exactly one owner workspace for btimofeyev@gmail.com';
  end if;
end
$$;

-- Repair the early development spelling without changing stable record IDs.
update public.student_subjects ss
set name = 'Writing & Grammar', updated_at = now()
from _seed_context c
where ss.family_id = c.family_id and lower(ss.name) = 'writing & grammer';

update public.curriculum_units cu
set subject = 'Writing & Grammar', updated_at = now()
from _seed_context c
where cu.family_id = c.family_id and lower(cu.subject) = 'writing & grammer';

update public.assignments a
set subject = 'Writing & Grammar', updated_at = now()
from _seed_context c
where a.family_id = c.family_id and lower(a.subject) = 'writing & grammer';

update public.categories category
set name = 'Writing & Grammar', slug = 'writing-grammar',
    description = 'Writing & Grammar assignments, assessments, submitted work, and progress evidence.',
    updated_at = now()
from _seed_context c
where category.family_id = c.family_id and category.slug = 'writing-grammer'
  and not exists (
    select 1 from public.categories current
    where current.family_id = c.family_id and current.slug = 'writing-grammar'
  );

update public.families f
set available_days = '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb,
    weekly_minutes = 3000,
    updated_at = now()
from _seed_context c
where f.id = c.family_id;

update public.students s
set grade_band = '9-12',
    daily_capacity_minutes = 240,
    learning_preferences = 'Works best with a clear checklist, short focused blocks, discussion before writing, and visible examples.',
    schedule_preferences = '{"learningDays":["Mon","Tue","Wed","Thu","Fri"]}'::jsonb,
    updated_at = now()
from _seed_context c
where s.family_id = c.family_id and lower(s.display_name) = 'jacob';

insert into public.students
  (id, family_id, display_name, birth_year, grade_band, learning_preferences, daily_capacity_minutes, schedule_preferences)
select md5(c.family_id::text || ':student:maya')::uuid, c.family_id, 'Maya', 2013, '6-8',
  'Enjoys independent reading, visual organization, and project work. Benefits from a written model before longer responses.',
  210, '{"learningDays":["Mon","Tue","Wed","Thu","Fri"]}'::jsonb
from _seed_context c
on conflict (id) do update set
  display_name = excluded.display_name, birth_year = excluded.birth_year, grade_band = excluded.grade_band,
  learning_preferences = excluded.learning_preferences, daily_capacity_minutes = excluded.daily_capacity_minutes,
  schedule_preferences = excluded.schedule_preferences, active = true, updated_at = now();

insert into public.students
  (id, family_id, display_name, birth_year, grade_band, learning_preferences, daily_capacity_minutes, schedule_preferences)
select md5(c.family_id::text || ':student:noah')::uuid, c.family_id, 'Noah', 2018, 'k-2',
  'Learns best through short lessons, manipulatives, read-alouds, drawing, and movement breaks.',
  120, '{"learningDays":["Mon","Tue","Wed","Thu","Fri"]}'::jsonb
from _seed_context c
on conflict (id) do update set
  display_name = excluded.display_name, birth_year = excluded.birth_year, grade_band = excluded.grade_band,
  learning_preferences = excluded.learning_preferences, daily_capacity_minutes = excluded.daily_capacity_minutes,
  schedule_preferences = excluded.schedule_preferences, active = true, updated_at = now();

create temp table _seed_subjects (
  student_name text not null,
  subject_name text not null,
  course_name text not null,
  frequency int not null,
  minutes int not null,
  position int not null,
  skill_key text not null,
  skill_label text not null,
  base_score int not null
) on commit drop;

insert into _seed_subjects values
  ('Jacob','Math','Algebra I',5,45,0,'algebra.linear-equations','Solve and graph linear equations',84),
  ('Jacob','Science','Biology',3,40,1,'biology.cell-systems','Explain biological systems using evidence',86),
  ('Jacob','History','World History',3,40,2,'history.source-analysis','Analyze historical sources and context',88),
  ('Jacob','Literature','English Literature',4,40,3,'english.literary-analysis','Support literary analysis with evidence',87),
  ('Jacob','Writing & Grammar','Composition I',3,35,4,'english.claim-evidence','Develop a claim with evidence and reasoning',82),
  ('Jacob','Bible','Bible Survey',2,30,5,'bible.context','Explain a passage in historical context',91),
  ('Maya','Math','Pre-Algebra',5,40,0,'prealgebra.proportional-reasoning','Use proportional reasoning accurately',79),
  ('Maya','Science','Life Science',3,35,1,'lifescience.ecosystems','Explain relationships within ecosystems',86),
  ('Maya','History','Medieval & Early Modern World',3,35,2,'history.cause-effect','Explain historical cause and effect',84),
  ('Maya','Language Arts','Language Arts 7',4,40,3,'ela.inference-evidence','Support an inference with textual evidence',88),
  ('Maya','Writing & Grammar','Writing & Grammar 7',2,35,4,'writing.paragraph-structure','Organize an explanatory paragraph',81),
  ('Maya','Bible','Foundations of Faith',2,25,5,'bible.theme','Identify a passage theme and application',92),
  ('Noah','Math','Grade 2 Mathematics',5,25,0,'math.place-value','Use place value to add and subtract',83),
  ('Noah','Science','Earth & Life Science 2',2,25,1,'science.observation','Record and compare scientific observations',90),
  ('Noah','History','Communities & Early America',2,25,2,'history.sequence','Sequence events and explain what changed',87),
  ('Noah','Reading','Grade 2 Reading',5,25,3,'reading.fluency-comprehension','Read fluently and retell key details',82),
  ('Noah','Language Arts','Phonics & Writing 2',4,20,4,'phonics.vowel-patterns','Apply common vowel patterns in reading and writing',85),
  ('Noah','Bible','Bible Stories & Character',2,20,5,'bible.retell','Retell a story and identify its lesson',94);

update public.student_subjects ss
set course_name = d.course_name, weekly_frequency = d.frequency, position = d.position,
    status = 'active', updated_at = now()
from _seed_subjects d
join public.students s on lower(s.display_name) = lower(d.student_name)
join _seed_context c on c.family_id = s.family_id
where ss.family_id = c.family_id and ss.student_id = s.id and lower(ss.name) = lower(d.subject_name);

insert into public.student_subjects
  (id, family_id, student_id, created_by, name, course_name, weekly_frequency, position, status)
select md5(c.family_id::text || ':subject:' || lower(d.student_name) || ':' || lower(d.subject_name))::uuid,
  c.family_id, s.id, c.parent_id, d.subject_name, d.course_name, d.frequency, d.position, 'active'
from _seed_subjects d
join _seed_context c on true
join public.students s on s.family_id = c.family_id and lower(s.display_name) = lower(d.student_name)
where not exists (
  select 1 from public.student_subjects current
  where current.family_id = c.family_id and current.student_id = s.id
    and current.status = 'active' and lower(current.name) = lower(d.subject_name)
);

update public.curriculum_units cu
set default_minutes = d.minutes,
    schedule_rule = jsonb_build_object('days', case d.frequency
      when 5 then jsonb_build_array('Monday','Tuesday','Wednesday','Thursday','Friday')
      when 4 then jsonb_build_array('Monday','Tuesday','Thursday','Friday')
      when 3 then jsonb_build_array('Monday','Wednesday','Friday')
      else jsonb_build_array('Tuesday','Thursday') end),
    status = 'active', updated_at = now()
from _seed_subjects d
join public.students s on lower(s.display_name) = lower(d.student_name)
join _seed_context c on c.family_id = s.family_id
where cu.family_id = c.family_id and cu.student_id = s.id
  and lower(cu.subject) = lower(d.subject_name) and lower(cu.title) = lower(d.course_name);

insert into public.curriculum_units
  (id, family_id, student_id, created_by, subject, title, sequence_label, next_sequence_number, default_minutes, schedule_rule, status)
select md5(c.family_id::text || ':curriculum:' || lower(d.student_name) || ':' || lower(d.subject_name))::uuid,
  c.family_id, s.id, c.parent_id, d.subject_name, d.course_name, 'Lesson', d.frequency * (:completed_weeks + 1) + 1, d.minutes,
  jsonb_build_object('days', case d.frequency
    when 5 then jsonb_build_array('Monday','Tuesday','Wednesday','Thursday','Friday')
    when 4 then jsonb_build_array('Monday','Tuesday','Thursday','Friday')
    when 3 then jsonb_build_array('Monday','Wednesday','Friday')
    else jsonb_build_array('Tuesday','Thursday') end), 'active'
from _seed_subjects d
join _seed_context c on true
join public.students s on s.family_id = c.family_id and lower(s.display_name) = lower(d.student_name)
where not exists (
  select 1 from public.curriculum_units current
  where current.family_id = c.family_id and current.student_id = s.id and current.status <> 'archived'
    and lower(current.subject) = lower(d.subject_name) and lower(current.title) = lower(d.course_name)
);

insert into public.categories (family_id, name, slug, description, created_by_type, created_by)
select distinct c.family_id, d.subject_name,
  trim(both '-' from regexp_replace(lower(d.subject_name), '[^a-z0-9]+', '-', 'g')),
  d.subject_name || ' assignments, assessments, submitted work, and progress evidence.', 'parent', c.parent_id
from _seed_subjects d join _seed_context c on true
on conflict (family_id, slug) do update set
  name = excluded.name, description = excluded.description, updated_at = now();

create temp table _seed_lessons on commit drop as
with seed_start as (
  select (date_trunc('week', current_date)::date - (:completed_weeks * 7)) as start_date
), expanded as (
  select c.family_id, c.parent_id, s.id as student_id, s.display_name, s.grade_band,
    d.*, cu.id as curriculum_unit_id, w.week_index, occurrence,
    (w.week_index * d.frequency + occurrence) as sequence_number,
    (seed_start.start_date + (w.week_index * 7)
      + ((occurrence - 1 + d.position * 2) % 5))::date as scheduled_date
  from _seed_context c
  join public.students s on s.family_id = c.family_id and s.active
  join _seed_subjects d on lower(d.student_name) = lower(s.display_name)
  join public.curriculum_units cu on cu.family_id = c.family_id and cu.student_id = s.id
    and lower(cu.subject) = lower(d.subject_name) and lower(cu.title) = lower(d.course_name) and cu.status = 'active'
  cross join seed_start
  cross join generate_series(0, :completed_weeks) as w(week_index)
  cross join lateral generate_series(1, d.frequency) as n(occurrence)
), ranked as (
  select expanded.*,
    row_number() over (partition by student_id, scheduled_date order by position, occurrence) as daily_slot
  from expanded
)
select ranked.*,
  md5(family_id::text || ':assignment:' || student_id::text || ':' || lower(subject_name) || ':' || sequence_number)::uuid as assignment_id,
  (case grade_band when '9-12' then time '08:30' when '6-8' then time '08:45' else time '09:00' end
    + ((daily_slot - 1) * case grade_band when 'k-2' then interval '30 minutes' else interval '50 minutes' end))::time as scheduled_time,
  case
    when week_index = (:completed_weeks - 1) and ((display_name = 'Jacob' and subject_name = 'History')
      or (display_name = 'Maya' and subject_name = 'Writing & Grammar')
      or (display_name = 'Noah' and subject_name = 'Science')) and occurrence = frequency then 'planned'
    when scheduled_date < current_date then 'completed'
    else 'planned'
  end as assignment_status
from ranked;

insert into public.assignments
  (id, family_id, student_id, curriculum_unit_id, created_by, created_by_type, title, subject, instructions,
   sequence_number, status, scheduled_date, scheduled_time, estimated_minutes, completed_at, source_kind)
select assignment_id, family_id, student_id, curriculum_unit_id, parent_id, 'parent',
  course_name || ' · Lesson ' || sequence_number, subject_name,
  case subject_name
    when 'Math' then 'Complete the lesson examples, practice set, and one correction check.'
    when 'Science' then 'Read the lesson, record observations, and explain one result using evidence.'
    when 'History' then 'Read the assigned section and complete the map, timeline, or source questions.'
    when 'Literature' then 'Read the assigned selection and record a claim with supporting text evidence.'
    when 'Language Arts' then 'Complete the reading or language lesson and support responses with evidence.'
    when 'Reading' then 'Read aloud, practice the focus pattern, and retell the key details.'
    when 'Bible' then 'Read the passage, narrate the main idea, and record one application.'
    else 'Complete the curriculum lesson and save one representative response.' end,
  sequence_number, assignment_status, scheduled_date, scheduled_time, minutes,
  case when assignment_status = 'completed' then scheduled_date::timestamp + scheduled_time + interval '35 minutes' else null end,
  'curriculum'
from _seed_lessons
on conflict (id) do update set
  title = excluded.title, subject = excluded.subject, instructions = excluded.instructions,
  status = excluded.status, scheduled_date = excluded.scheduled_date, scheduled_time = excluded.scheduled_time,
  estimated_minutes = excluded.estimated_minutes, completed_at = excluded.completed_at, updated_at = now();

update public.curriculum_units cu
set next_sequence_number = latest.next_sequence, updated_at = now()
from (
  select curriculum_unit_id, max(sequence_number) + 1 as next_sequence
  from _seed_lessons group by curriculum_unit_id
) latest
where cu.id = latest.curriculum_unit_id;

insert into public.weekly_plan_items
  (id, family_id, student_id, scheduled_date, scheduled_time, position, title, description,
   estimated_minutes, subject, completed_at, source_kind, assignment_id)
select md5(family_id::text || ':plan:' || assignment_id::text)::uuid, family_id, student_id,
  scheduled_date, scheduled_time, daily_slot, course_name || ' · Lesson ' || sequence_number,
  'Current curriculum work for this week.', minutes, subject_name,
  case when assignment_status = 'completed' then scheduled_date::timestamp + scheduled_time + interval '35 minutes' else null end,
  'parent', assignment_id
from _seed_lessons
where week_index = :completed_weeks
on conflict (id) do update set
  scheduled_date = excluded.scheduled_date, scheduled_time = excluded.scheduled_time,
  position = excluded.position, title = excluded.title, description = excluded.description,
  estimated_minutes = excluded.estimated_minutes, subject = excluded.subject,
  completed_at = excluded.completed_at, assignment_id = excluded.assignment_id, updated_at = now();

create temp table _seed_assessments on commit drop as
select l.*,
  case
    when display_name = 'Jacob' and subject_name = 'Science' and week_index = (:completed_weeks - 3) then 86
    when display_name = 'Jacob' and subject_name = 'Science' and week_index = (:completed_weeks - 2) then 78
    when display_name = 'Jacob' and subject_name = 'Science' and week_index = (:completed_weeks - 1) then 69
    when display_name = 'Maya' and subject_name = 'Math' and week_index = (:completed_weeks - 3) then 72
    when display_name = 'Maya' and subject_name = 'Math' and week_index = (:completed_weeks - 2) then 79
    when display_name = 'Maya' and subject_name = 'Math' and week_index = (:completed_weeks - 1) then 86
    when display_name = 'Noah' and subject_name = 'Reading' and week_index = (:completed_weeks - 3) then 76
    when display_name = 'Noah' and subject_name = 'Reading' and week_index = (:completed_weeks - 2) then 84
    when display_name = 'Noah' and subject_name = 'Reading' and week_index = (:completed_weeks - 1) then 91
    else greatest(65, least(98, base_score + ((week_index % 3) - 1) * 2 + (position % 2)))
  end as score,
  case
    when display_name = 'Jacob' and subject_name = 'Science' and week_index >= (:completed_weeks - 3) then 'biology.osmosis-explanations'
    else skill_key
  end as assessed_skill_key,
  case
    when display_name = 'Jacob' and subject_name = 'Science' and week_index >= (:completed_weeks - 3) then 'Explain osmosis using concentration and water movement'
    else skill_label
  end as assessed_skill_label,
  md5(family_id::text || ':submission:' || assignment_id::text)::uuid as submission_id,
  md5(family_id::text || ':review:' || assignment_id::text)::uuid as review_id,
  md5(family_id::text || ':evidence:' || assignment_id::text)::uuid as evidence_id
from _seed_lessons l
where week_index < :completed_weeks and occurrence = frequency and assignment_status = 'completed';

insert into public.evidence_items
  (id, family_id, created_by, kind, title, raw_text, source_at, processing_status, provenance, capture_route, capture_submission_id, created_at)
select evidence_id, family_id, parent_id, 'grade', course_name || ' · Week ' || (week_index + 1) || ' check',
  format('Score: %s%%. %s', score,
    case
      when display_name = 'Jacob' and subject_name = 'Science' and week_index >= (:completed_weeks - 3)
        then 'The response identified water movement but became less consistent when explaining how concentration drives osmosis.'
      when score >= 90 then 'The learner completed the check accurately and explained the key idea independently.'
      when score >= 80 then 'The learner showed solid understanding with one or two correctable errors.'
      when score >= 70 then 'The core idea is developing; the next lesson should revisit the demonstrated error.'
      else 'The source supports additional focused review before the next assessment.' end),
  scheduled_date::timestamp + time '15:00', 'ready',
  jsonb_build_object('seed','timofeyev-eight-weeks-v1','week',week_index + 1,'assignment_id',assignment_id),
  'learning', md5(family_id::text || ':capture:' || assignment_id::text)::uuid,
  scheduled_date::timestamp + time '15:00'
from _seed_assessments
on conflict (id) do update set
  title = excluded.title, raw_text = excluded.raw_text, source_at = excluded.source_at,
  processing_status = excluded.processing_status, provenance = excluded.provenance,
  capture_route = excluded.capture_route, updated_at = now();

insert into public.evidence_students (evidence_id, student_id, family_id)
select evidence_id, student_id, family_id from _seed_assessments
on conflict do nothing;

insert into public.evidence_categories
  (family_id, evidence_id, category_id, assigned_by, confidence, document_type, tags)
select a.family_id, a.evidence_id, c.id, 'parent', 1, 'Weekly curriculum check',
  array[lower(replace(a.course_name, ' ', '-')), 'week-' || (a.week_index + 1)]
from _seed_assessments a
join public.categories c on c.family_id = a.family_id
  and c.slug = trim(both '-' from regexp_replace(lower(a.subject_name), '[^a-z0-9]+', '-', 'g'))
on conflict (evidence_id, category_id) do update set
  confidence = excluded.confidence, document_type = excluded.document_type, tags = excluded.tags;

insert into public.assignment_submissions
  (id, family_id, assignment_id, student_id, submitted_by, note, status, submitted_at, created_at)
select submission_id, family_id, assignment_id, student_id, parent_id,
  'Weekly curriculum check submitted with the recorded result.', 'reviewed',
  scheduled_date::timestamp + time '15:00', scheduled_date::timestamp + time '15:00'
from _seed_assessments
on conflict (id) do update set
  note = excluded.note, status = excluded.status, submitted_at = excluded.submitted_at, updated_at = now();

insert into public.assignment_submission_evidence (family_id, submission_id, evidence_id)
select family_id, submission_id, evidence_id from _seed_assessments
on conflict do nothing;

insert into public.assignment_reviews
  (id, family_id, assignment_id, submission_id, student_id, status, score, score_label, feedback,
   rubric, mastery_signals, uncertainty_flags, reviewed_by, reviewed_at, created_at, skill_key, evidence_kind,
   score_origin, grading_state, written_review_required, written_review_completed, evidence_strength, comparable_key)
select review_id, family_id, assignment_id, submission_id, student_id, 'approved', score, score || '%',
  case
    when display_name = 'Jacob' and subject_name = 'Science' and week_index >= (:completed_weeks - 3)
      then 'Use concentration language explicitly, then connect it to the direction of water movement across the membrane.'
    when score >= 90 then 'Strong independent work. Continue with the regular curriculum sequence.'
    when score >= 80 then 'Good progress. Correct the missed item and explain why the correction works.'
    when score >= 70 then 'The central skill is developing. Review the demonstrated error before the next check.'
    else 'Pause for a short, targeted reteach using the submitted work before moving on.' end,
  jsonb_build_array(jsonb_build_object('criterion',assessed_skill_label,'score',score,'maxScore',100)),
  jsonb_build_array(jsonb_build_object('skill',assessed_skill_label,'status',case when score >= 90 then 'secure' when score >= 75 then 'developing' else 'emerging' end)),
  '[]'::jsonb, parent_id, scheduled_date::timestamp + time '16:00', scheduled_date::timestamp + time '16:00',
  assessed_skill_key, 'curriculum', 'explicit_parent', 'final', true, true, 'curriculum', assessed_skill_key
from _seed_assessments
on conflict (id) do update set
  status = excluded.status, score = excluded.score, score_label = excluded.score_label,
  feedback = excluded.feedback, rubric = excluded.rubric, mastery_signals = excluded.mastery_signals,
  reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
  skill_key = excluded.skill_key, evidence_kind = excluded.evidence_kind,
  score_origin = excluded.score_origin, grading_state = excluded.grading_state,
  written_review_required = excluded.written_review_required,
  written_review_completed = excluded.written_review_completed,
  evidence_strength = excluded.evidence_strength, comparable_key = excluded.comparable_key,
  updated_at = now();

insert into public.skill_observations
  (id, family_id, student_id, authored_by, author_type, subject, skill_key, skill_label, status,
   confidence, rationale, approval_status, reviewed_by, reviewed_at, created_at)
select md5(family_id::text || ':observation:' || student_id::text || ':' || lower(subject_name))::uuid,
  family_id, student_id, parent_id, 'parent', subject_name, assessed_skill_key, assessed_skill_label,
  case when score >= 90 then 'secure' when score >= 75 then 'developing' else 'emerging' end,
  .9,
  format('The most recent approved curriculum check was %s%% after %s completed weeks of related work.', score, :completed_weeks),
  'approved', parent_id, reviewed_at, reviewed_at
from (
  select a.*, scheduled_date::timestamp + time '16:00' as reviewed_at,
    row_number() over (partition by student_id, subject_name order by week_index desc) as recency
  from _seed_assessments a
) latest
where recency = 1
on conflict (id) do update set
  skill_key = excluded.skill_key, skill_label = excluded.skill_label, status = excluded.status,
  confidence = excluded.confidence, rationale = excluded.rationale, approval_status = excluded.approval_status,
  reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = now();

insert into public.observation_evidence (observation_id, evidence_id, family_id)
select md5(a.family_id::text || ':observation:' || a.student_id::text || ':' || lower(a.subject_name))::uuid,
  a.evidence_id, a.family_id
from (
  select assessments.*,
    row_number() over (partition by student_id, subject_name order by week_index desc) as recency
  from _seed_assessments assessments
) a
where a.recency = 1
on conflict do nothing;

-- Parent-owned planning facts for the bounded on-track engine.
update public.academic_terms current
set name = 'Current homeschool term',
    starts_on = (date_trunc('week', current_date)::date - (:completed_weeks * 7)),
    ends_on = (date_trunc('week', current_date)::date + 60),
    target_instructional_days = (:completed_weeks + 9) * 5,
    notes = 'Parent-configurable planning term for local development; not a legal compliance determination.',
    updated_at = now()
from _seed_context c
where current.family_id = c.family_id and current.status = 'active';

insert into public.academic_terms
  (id, family_id, created_by, name, starts_on, ends_on, target_instructional_days, status, notes)
select md5(c.family_id::text || ':term:seeded-month')::uuid, c.family_id, c.parent_id,
  'Current homeschool term',
  (date_trunc('week', current_date)::date - (:completed_weeks * 7)),
  (date_trunc('week', current_date)::date + 60),
  (:completed_weeks + 9) * 5, 'active',
  'Parent-configurable planning term for local development; not a legal compliance determination.'
from _seed_context c
where not exists (
  select 1 from public.academic_terms current
  where current.family_id = c.family_id and current.status = 'active'
)
on conflict (id) do update set
  name = excluded.name, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
  target_instructional_days = excluded.target_instructional_days, status = excluded.status,
  notes = excluded.notes, updated_at = now();

create temp table _seed_term on commit drop as
select distinct on (t.family_id) t.id, t.family_id, t.starts_on, t.ends_on
from public.academic_terms t
join _seed_context c on c.family_id = t.family_id
where t.status = 'active'
order by t.family_id, t.starts_on desc;

insert into public.academic_term_weekdays(family_id, term_id, weekday)
select t.family_id, t.id, weekday
from _seed_term t cross join generate_series(1, 5) weekday
on conflict do nothing;

insert into public.learning_goals
  (id, family_id, student_id, term_id, created_by, title, subject, description,
   goal_kind, target_value, target_unit, target_date, weekly_effort_minutes,
   weekly_cadence, priority, constraints, status)
select md5(c.family_id::text || ':goal:' || s.id::text || ':' || lower(d.subject_name))::uuid,
  c.family_id, s.id, t.id, c.parent_id,
  'Continue ' || d.course_name || ' through the term', d.subject_name,
  'Maintain the parent-defined curriculum sequence while preserving review and correction time.',
  'curriculum_progress', d.frequency * (:completed_weeks + 9), 'assignments', t.ends_on,
  d.frequency * d.minutes, d.frequency,
  case when d.position < 2 then 75 else 55 end,
  case when s.grade_band = 'k-2' then 'Keep lessons short and include movement or read-aloud time.'
       when s.grade_band = '6-8' then 'Leave room for written revisions and project work.'
       else 'Protect focused writing, lab, and correction blocks.' end,
  'active'
from _seed_subjects d
join _seed_context c on true
join _seed_term t on t.family_id = c.family_id
join public.students s on s.family_id = c.family_id and lower(s.display_name) = lower(d.student_name)
on conflict (id) do update set
  term_id = excluded.term_id, title = excluded.title, description = excluded.description,
  target_value = excluded.target_value, target_unit = excluded.target_unit,
  target_date = excluded.target_date, weekly_effort_minutes = excluded.weekly_effort_minutes,
  weekly_cadence = excluded.weekly_cadence, priority = excluded.priority,
  constraints = excluded.constraints, status = excluded.status, version = public.learning_goals.version + 1,
  updated_at = now();

insert into public.curriculum_pacing_targets
  (id, family_id, student_id, term_id, curriculum_unit_id, goal_id, created_by,
   starts_on, target_completion_date, start_sequence, target_sequence,
   expected_assignments, weekly_cadence, weekly_effort_minutes, priority, constraints, status)
select md5(c.family_id::text || ':pace:' || cu.id::text)::uuid,
  c.family_id, s.id, t.id, cu.id,
  md5(c.family_id::text || ':goal:' || s.id::text || ':' || lower(d.subject_name))::uuid,
  c.parent_id, t.starts_on, t.ends_on, 1, d.frequency * (:completed_weeks + 9),
  d.frequency * (:completed_weeks + 9), d.frequency, d.frequency * d.minutes,
  case when d.position < 2 then 75 else 55 end,
  'Follow the parent-selected cadence; recommend tradeoffs rather than exceeding daily capacity.', 'active'
from _seed_subjects d
join _seed_context c on true
join _seed_term t on t.family_id = c.family_id
join public.students s on s.family_id = c.family_id and lower(s.display_name) = lower(d.student_name)
join public.curriculum_units cu on cu.family_id = c.family_id and cu.student_id = s.id
  and lower(cu.subject) = lower(d.subject_name) and lower(cu.title) = lower(d.course_name)
on conflict (term_id, curriculum_unit_id) do update set
  goal_id = excluded.goal_id, starts_on = excluded.starts_on,
  target_completion_date = excluded.target_completion_date,
  start_sequence = excluded.start_sequence, target_sequence = excluded.target_sequence,
  expected_assignments = excluded.expected_assignments,
  weekly_cadence = excluded.weekly_cadence,
  weekly_effort_minutes = excluded.weekly_effort_minutes,
  priority = excluded.priority, constraints = excluded.constraints, status = excluded.status,
  version = public.curriculum_pacing_targets.version + 1, updated_at = now();

insert into public.instructional_day_records
  (id, family_id, student_id, term_id, created_by, instructional_date, status,
   instructional_minutes, note)
select md5(a.family_id::text || ':instructional-day:' || a.student_id::text || ':' || a.scheduled_date::text)::uuid,
  a.family_id, a.student_id, t.id, min(a.parent_id::text)::uuid, a.scheduled_date, 'held',
  sum(a.minutes)::integer,
  'Parent-configurable instructional record generated from completed curriculum work; not a legal attendance determination.'
from _seed_lessons a
join _seed_term t on t.family_id = a.family_id
where a.week_index < :completed_weeks and a.assignment_status = 'completed'
group by a.family_id, a.student_id, t.id, a.scheduled_date
on conflict (family_id, student_id, instructional_date) do update set
  term_id = excluded.term_id, status = excluded.status,
  instructional_minutes = excluded.instructional_minutes, note = excluded.note,
  updated_at = now();

insert into public.reminders
  (id, family_id, student_id, title, notes, due_at, status, created_by_type,
   created_by, confidence, rationale)
select md5(a.family_id::text || ':reminder:unfinished:' || a.assignment_id::text)::uuid,
  a.family_id, a.student_id, 'Reschedule ' || a.course_name || ' · Lesson ' || a.sequence_number,
  'This curriculum lesson was intentionally left unfinished so Klio can demonstrate bounded follow-through.',
  current_date + interval '1 day' + time '16:00', 'pending', 'parent', a.parent_id, 1,
  'Realistic seeded unfinished work for the parent to review.'
from _seed_lessons a
where a.week_index = (:completed_weeks - 1) and a.assignment_status = 'planned'
on conflict (id) do update set
  title = excluded.title, notes = excluded.notes, due_at = excluded.due_at,
  status = excluded.status, rationale = excluded.rationale, updated_at = now();

insert into public.family_autonomy_policies(family_id, preset, policies, updated_by)
select c.family_id, 'proactive', '{}'::jsonb, c.parent_id from _seed_context c
on conflict (family_id) do update set preset = excluded.preset, policies = excluded.policies,
  updated_by = excluded.updated_by, updated_at = now();

insert into public.proactive_evaluations
  (id, family_id, student_id, requested_by, event_kind, entity_type, entity_id, idempotency_key, status)
select md5(a.family_id::text || ':evaluation:jacob-biology-eight-weeks')::uuid,
  a.family_id, a.student_id, a.parent_id, 'grade_approved', 'assignment_review', a.review_id,
  'seed:timofeyev-eight-weeks:jacob-biology-trend', 'queued'
from _seed_assessments a
where a.display_name = 'Jacob' and a.subject_name = 'Science' and a.week_index = (:completed_weeks - 1)
on conflict (family_id, idempotency_key) do nothing;

insert into public.audit_events
  (family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
select c.family_id, c.parent_id, 'system', 'development.seed_applied', 'family', c.family_id,
  jsonb_build_object('seed','timofeyev-eight-weeks-v1','learners',jsonb_build_array('Jacob','Maya','Noah'),'completed_weeks',:completed_weeks)
from _seed_context c
where not exists (
  select 1 from public.audit_events e
  where e.family_id = c.family_id and e.action = 'development.seed_applied'
    and e.metadata->>'seed' = 'timofeyev-eight-weeks-v1'
);

commit;
