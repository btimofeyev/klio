-- Record an explicit parent score as one family-scoped transaction.

create or replace function public.record_explicit_parent_score(
  p_family_id uuid,
  p_assignment_id uuid,
  p_actor_id uuid,
  p_agent_turn_id uuid,
  p_score numeric,
  p_submission_id uuid default null,
  p_score_label text default null,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment public.assignments%rowtype;
  submission public.assignment_submissions%rowtype;
  review public.assignment_reviews%rowtype;
  target public.curriculum_pacing_targets%rowtype;
  progress_value numeric;
  now_at timestamptz := now();
begin
  if p_score < 0 or p_score > 100 then raise exception 'EXPLICIT_SCORE_INVALID'; end if;
  if not exists (
    select 1 from public.family_members
    where family_id = p_family_id and user_id = p_actor_id and role in ('owner', 'editor')
  ) then raise exception 'EXPLICIT_SCORE_FORBIDDEN'; end if;
  if not exists (
    select 1 from public.agent_turns
    where id = p_agent_turn_id and family_id = p_family_id and requested_by = p_actor_id
  ) then raise exception 'EXPLICIT_SCORE_TURN_INVALID'; end if;

  select * into assignment from public.assignments
  where id = p_assignment_id and family_id = p_family_id for update;
  if assignment.id is null then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;

  if p_submission_id is not null then
    select * into submission from public.assignment_submissions
    where id = p_submission_id and family_id = p_family_id and assignment_id = p_assignment_id for update;
    if submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  else
    insert into public.assignment_submissions(
      family_id, assignment_id, student_id, submitted_by, note, status, submitted_at
    ) values (
      p_family_id, p_assignment_id, assignment.student_id, p_actor_id,
      'Parent provided an explicit score.', 'reviewed', now_at
    ) returning * into submission;
  end if;

  select * into review from public.assignment_reviews
  where family_id = p_family_id and submission_id = submission.id and status in ('draft', 'approved')
  order by created_at desc limit 1 for update;

  if review.id is null then
    insert into public.assignment_reviews(
      family_id, assignment_id, submission_id, student_id, agent_turn_id,
      status, draft_score, score, score_label, draft_feedback, feedback,
      score_origin, grading_state, written_review_required, written_review_completed,
      evidence_strength, reviewed_by, reviewed_at
    ) values (
      p_family_id, p_assignment_id, submission.id, assignment.student_id, p_agent_turn_id,
      'approved', p_score, p_score, nullif(left(coalesce(p_score_label, ''), 40), ''),
      nullif(left(coalesce(p_feedback, ''), 5000), ''), nullif(left(coalesce(p_feedback, ''), 5000), ''),
      'explicit_parent', 'final', false, true, 'parent_report', p_actor_id, now_at
    ) returning * into review;
  else
    update public.assignment_reviews set
      status = 'approved', draft_score = p_score, score = p_score,
      score_label = nullif(left(coalesce(p_score_label, ''), 40), ''),
      draft_feedback = nullif(left(coalesce(p_feedback, ''), 5000), ''),
      feedback = nullif(left(coalesce(p_feedback, ''), 5000), ''),
      score_origin = 'explicit_parent', grading_state = 'final',
      written_review_required = false, written_review_completed = true,
      evidence_strength = 'parent_report', reviewed_by = p_actor_id, reviewed_at = now_at
    where id = review.id returning * into review;
  end if;

  update public.assignment_submissions set status = 'reviewed' where id = submission.id;
  update public.assignments set status = 'completed', completed_at = coalesce(completed_at, now_at), version = version + 1
  where id = assignment.id;
  update public.weekly_plan_items set completed_at = coalesce(completed_at, now_at)
  where family_id = p_family_id and assignment_id = assignment.id;

  if assignment.curriculum_unit_id is not null and assignment.sequence_number is not null then
    select * into target from public.curriculum_pacing_targets
    where family_id = p_family_id and student_id = assignment.student_id
      and curriculum_unit_id = assignment.curriculum_unit_id and status = 'active'
      and assignment.sequence_number between start_sequence and target_sequence
    order by created_at desc limit 1;
    if target.id is not null and target.goal_id is not null then
      progress_value := greatest(0, assignment.sequence_number - target.start_sequence + 1);
      insert into public.goal_progress_records(
        family_id, goal_id, student_id, recorded_by, actor_type, source_kind,
        source_review_id, observed_on, progress_value, progress_unit, note
      ) values (
        p_family_id, target.goal_id, assignment.student_id, p_actor_id, 'parent', 'approved_review',
        review.id, current_date, progress_value, 'assignments', 'Explicit parent-provided score.'
      ) on conflict (goal_id, source_review_id)
        where source_kind = 'approved_review' and source_review_id is not null do nothing;
    end if;
  end if;

  insert into public.audit_events(family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    p_family_id, p_actor_id, 'parent', 'assignment_review.explicit_parent_score_recorded',
    'assignment_review', review.id,
    jsonb_build_object('assignment_id', assignment.id, 'submission_id', submission.id, 'score', p_score)
  );
  return jsonb_build_object(
    'reviewId', review.id, 'assignmentId', assignment.id, 'submissionId', submission.id,
    'score', p_score, 'scoreOrigin', 'explicit_parent', 'gradingState', 'final'
  );
end;
$$;

revoke all on function public.record_explicit_parent_score(uuid, uuid, uuid, uuid, numeric, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_explicit_parent_score(uuid, uuid, uuid, uuid, numeric, uuid, text, text) to service_role;

comment on function public.record_explicit_parent_score(uuid, uuid, uuid, uuid, numeric, uuid, text, text)
  is 'Atomically preserves an explicit parent score, completion, pacing provenance, and audit history.';
