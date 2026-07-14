-- Idempotent local product fixture for the assignment -> review -> replan loop.
do $$
<<seed_jacob_operating_loop>>
declare
  family_id uuid := 'e9b1ec74-6784-450d-bcfb-402cc107e9be';
  student_id uuid := '75801534-9340-4464-8e6f-8f34b1f3a96f';
  parent_id uuid;
  algebra_unit_id uuid;
  algebra_8_id uuid;
  submission_id uuid;
begin
  select created_by into parent_id from public.families where id = family_id;
  if parent_id is null then raise notice 'Klio fixture family is not present'; return; end if;

  select id into algebra_unit_id from public.curriculum_units
  where curriculum_units.family_id = seed_jacob_operating_loop.family_id
    and curriculum_units.student_id = seed_jacob_operating_loop.student_id
    and title = 'Algebra I' limit 1;
  if algebra_unit_id is null then
    insert into public.curriculum_units (family_id, student_id, created_by, subject, title, sequence_label, next_sequence_number, default_minutes, schedule_rule)
    values (family_id, student_id, parent_id, 'Algebra I', 'Algebra I', 'Lesson', 9, 45, '{"weekdays":[1,2,3,4],"scheduledTime":"09:00"}')
    returning id into algebra_unit_id;
  end if;

  update public.assignments set curriculum_unit_id = algebra_unit_id,
    sequence_number = (regexp_match(title, 'Lesson ([0-9]+)'))[1]::integer
  where assignments.family_id = seed_jacob_operating_loop.family_id
    and assignments.student_id = seed_jacob_operating_loop.student_id
    and subject = 'Algebra I' and title ~ 'Lesson [0-9]+';

  update public.assignments set status = 'completed', completed_at = '2026-07-13 15:00:00-04'
  where assignments.family_id = seed_jacob_operating_loop.family_id and title = 'Algebra I · Lesson 6';
  update public.weekly_plan_items set completed_at = '2026-07-13 15:00:00-04'
  where weekly_plan_items.family_id = seed_jacob_operating_loop.family_id and title = 'Algebra I · Lesson 6';

  select id into algebra_8_id from public.assignments
  where assignments.family_id = seed_jacob_operating_loop.family_id and title = 'Algebra I · Lesson 8' limit 1;
  if algebra_8_id is not null and not exists (select 1 from public.assignment_submissions where assignment_id = algebra_8_id) then
    insert into public.assignment_submissions (family_id, assignment_id, student_id, submitted_by, note, status, submitted_at)
    values (family_id, algebra_8_id, student_id, parent_id, 'Quiz score: 84%. Recheck negative slope errors before the next lesson.', 'ready_for_review', '2026-07-15 12:20:00-04')
    returning id into submission_id;
    insert into public.assignment_submission_evidence (family_id, submission_id, evidence_id)
    values (family_id, submission_id, '91000000-0000-4000-8000-000000000009');
    insert into public.assignment_reviews (family_id, assignment_id, submission_id, student_id, status, draft_score, draft_feedback, rubric, mastery_signals, uncertainty_flags)
    values (family_id, algebra_8_id, submission_id, student_id, 'draft', 84,
      'Jacob identified slope and y-intercept accurately. Revisit graphing negative slopes before advancing.',
      '[{"criterion":"Slope and intercept","level":"secure"},{"criterion":"Negative slope graphing","level":"developing"}]',
      '[{"skill":"Graph linear equations with negative slopes","status":"developing"}]',
      '["One quiz is not enough to establish durable mastery."]');
    update public.assignments set status = 'needs_review', submitted_at = '2026-07-15 12:20:00-04' where id = algebra_8_id;
  end if;
end $$;
