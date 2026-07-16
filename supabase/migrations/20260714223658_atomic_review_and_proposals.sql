-- Make multi-record grade decisions and parent-approved planning changes atomic.

drop trigger if exists planning_proposals_bump_agent_context on public.planning_proposals;

alter table public.assignment_reviews drop constraint assignment_reviews_score_origin_check;
alter table public.assignment_reviews add constraint assignment_reviews_score_origin_check
  check (score_origin in ('agent_inferred', 'parent_edited_agent_draft', 'explicit_parent', 'imported_explicit'));

create unique index goal_progress_one_approved_review_idx
  on public.goal_progress_records(goal_id, source_review_id)
  where source_kind = 'approved_review' and source_review_id is not null;

create or replace function public.finalize_assignment_review(
  p_review_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.assignment_reviews%rowtype;
  assignment public.assignments%rowtype;
  now_at timestamptz := now();
  final_score numeric;
  target public.curriculum_pacing_targets%rowtype;
  progress_value numeric;
begin
  if p_decision not in ('approve', 'reject', 'return') then raise exception 'REVIEW_DECISION_INVALID'; end if;
  select * into review from public.assignment_reviews where id = p_review_id for update;
  if review.id is null then raise exception 'REVIEW_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.family_members
    where family_id = review.family_id and user_id = p_actor_id and role in ('owner', 'editor')
  ) then raise exception 'REVIEW_FORBIDDEN'; end if;
  if review.status <> 'draft' then
    return jsonb_build_object('status', review.status, 'reviewId', review.id, 'duplicate', true);
  end if;
  select * into assignment from public.assignments where id = review.assignment_id and family_id = review.family_id for update;
  if assignment.id is null then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;

  if p_decision = 'approve' then
    final_score := nullif(p_values->>'score', '')::numeric;
    if final_score is not null and (final_score < 0 or final_score > 100) then raise exception 'REVIEW_SCORE_INVALID'; end if;
    update public.assignment_reviews set
      status = 'approved',
      score = final_score,
      score_label = nullif(left(coalesce(p_values->>'scoreLabel', ''), 40), ''),
      feedback = left(coalesce(p_values->>'feedback', ''), 5000),
      rubric = coalesce(p_values->'rubric', '[]'::jsonb),
      mastery_signals = coalesce(p_values->'masterySignals', '[]'::jsonb),
      skill_key = nullif(left(coalesce(p_values->>'skillKey', ''), 160), ''),
      comparable_key = nullif(left(coalesce(p_values->>'comparableKey', p_values->>'skillKey', ''), 200), ''),
      score_origin = case
        when score_origin in ('explicit_parent', 'imported_explicit') then score_origin
        when coalesce((p_values->>'scoreEdited')::boolean, false) then 'parent_edited_agent_draft'
        else 'agent_inferred'
      end,
      grading_state = 'final',
      written_review_completed = true,
      reviewed_by = p_actor_id,
      reviewed_at = now_at
    where id = review.id;
    update public.assignment_submissions set status = 'reviewed' where id = review.submission_id and family_id = review.family_id;
    update public.assignments set status = 'completed', completed_at = now_at, version = version + 1 where id = review.assignment_id and family_id = review.family_id;
    update public.weekly_plan_items set completed_at = now_at where assignment_id = review.assignment_id and family_id = review.family_id;

    if assignment.curriculum_unit_id is not null and assignment.sequence_number is not null then
      select * into target from public.curriculum_pacing_targets
      where family_id = review.family_id and student_id = review.student_id
        and curriculum_unit_id = assignment.curriculum_unit_id and status = 'active'
        and assignment.sequence_number between start_sequence and target_sequence
      order by created_at desc limit 1;
      if target.id is not null and target.goal_id is not null then
        progress_value := greatest(0, assignment.sequence_number - target.start_sequence + 1);
        insert into public.goal_progress_records(
          family_id, goal_id, student_id, recorded_by, actor_type, source_kind,
          source_review_id, observed_on, progress_value, progress_unit, note
        ) values (
          review.family_id, target.goal_id, review.student_id, p_actor_id, 'parent', 'approved_review',
          review.id, current_date, progress_value, 'assignments', 'Finalized parent-approved curriculum review.'
        ) on conflict (goal_id, source_review_id) where source_kind = 'approved_review' and source_review_id is not null do nothing;
      end if;
    end if;
  else
    update public.assignment_reviews set
      status = 'rejected', grading_state = 'provisional', score = null,
      feedback = left(coalesce(p_values->>'feedback', draft_feedback, ''), 5000),
      return_reason = nullif(left(coalesce(p_values->>'returnReason', ''), 2000), ''),
      returned_at = case when p_decision = 'return' then now_at else null end,
      reviewed_by = p_actor_id, reviewed_at = now_at
    where id = review.id;
    update public.assignment_submissions set status = 'returned' where id = review.submission_id and family_id = review.family_id;
    update public.assignments set status = 'doing', version = version + 1 where id = review.assignment_id and family_id = review.family_id;
  end if;

  insert into public.audit_events(family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    review.family_id, p_actor_id, 'parent', 'assignment_review.' || p_decision,
    'assignment_review', review.id,
    jsonb_build_object('assignment_id', review.assignment_id, 'score', case when p_decision = 'approve' then final_score else null end)
  );
  return jsonb_build_object(
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'reviewId', review.id,
    'assignmentId', review.assignment_id,
    'studentId', review.student_id,
    'score', case when p_decision = 'approve' then final_score else null end,
    'gradingState', case when p_decision = 'approve' then 'final' else 'provisional' end,
    'duplicate', false
  );
end;
$$;

create or replace function public.apply_planning_proposal(p_proposal_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.planning_proposals%rowtype;
  current_version bigint;
  changes jsonb;
  change jsonb;
  created_id uuid;
  target_row public.assignments%rowtype;
begin
  select * into proposal from public.planning_proposals where id = p_proposal_id for update;
  if proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.family_members
    where family_id = proposal.family_id and user_id = p_actor_id and role in ('owner', 'editor')
  ) then raise exception 'PROPOSAL_FORBIDDEN'; end if;
  if proposal.status = 'applied' then return jsonb_build_object('status', 'applied', 'proposalId', proposal.id, 'duplicate', true); end if;
  if proposal.status <> 'proposed' then raise exception 'PROPOSAL_NOT_ACTIVE'; end if;
  select agent_context_version into current_version from public.families where id = proposal.family_id for update;
  if current_version <> proposal.snapshot_version then
    update public.planning_proposals set status = 'expired', reviewed_by = p_actor_id, reviewed_at = now() where id = proposal.id;
    return jsonb_build_object('status', 'expired', 'error', 'PROPOSAL_SNAPSHOT_STALE');
  end if;
  changes := proposal.proposed_changes;

  if proposal.action_name in ('create_goal', 'update_goal') then
    if proposal.action_name = 'create_goal' then
      insert into public.learning_goals(
        family_id, student_id, term_id, created_by, title, subject, description, goal_kind,
        target_value, target_unit, target_date, weekly_effort_minutes, weekly_cadence,
        priority, constraints, status
      ) values (
        proposal.family_id, proposal.student_id, nullif(changes->>'termId', '')::uuid, p_actor_id,
        left(changes->>'title', 200), left(changes->>'subject', 80), nullif(changes->>'description', ''),
        changes->>'goalKind', nullif(changes->>'targetValue', '')::numeric, nullif(changes->>'targetUnit', ''),
        nullif(changes->>'targetDate', '')::date, nullif(changes->>'weeklyEffortMinutes', '')::integer,
        nullif(changes->>'weeklyCadence', '')::smallint, coalesce((changes->>'priority')::smallint, 50),
        nullif(changes->>'constraints', ''), 'active'
      ) returning id into created_id;
    else
      update public.learning_goals set
        title = left(changes->>'title', 200), subject = left(changes->>'subject', 80),
        description = nullif(changes->>'description', ''), target_value = nullif(changes->>'targetValue', '')::numeric,
        target_unit = nullif(changes->>'targetUnit', ''), target_date = nullif(changes->>'targetDate', '')::date,
        weekly_effort_minutes = nullif(changes->>'weeklyEffortMinutes', '')::integer,
        weekly_cadence = nullif(changes->>'weeklyCadence', '')::smallint,
        priority = coalesce((changes->>'priority')::smallint, priority), constraints = nullif(changes->>'constraints', ''),
        version = version + 1
      where id = proposal.target_goal_id and family_id = proposal.family_id and student_id = proposal.student_id
      returning id into created_id;
    end if;
  elsif proposal.action_name = 'create_curriculum' then
    insert into public.curriculum_units(
      family_id, student_id, created_by, subject, title, default_minutes, schedule_rule, status
    ) values (
      proposal.family_id, proposal.student_id, p_actor_id, left(changes->>'subject', 80), left(changes->>'title', 200),
      coalesce((changes->>'defaultMinutes')::integer, 40),
      jsonb_build_object('days', '[]'::jsonb, 'weeklyFrequency', (changes->>'weeklyCadence')::integer), 'active'
    ) returning id into created_id;
  elsif proposal.action_name = 'change_curriculum_cadence' then
    update public.curriculum_units set
      default_minutes = coalesce((changes->>'defaultMinutes')::integer, default_minutes),
      schedule_rule = schedule_rule || jsonb_build_object('weeklyFrequency', (changes->>'weeklyCadence')::integer)
    where id = proposal.target_curriculum_unit_id and family_id = proposal.family_id and student_id = proposal.student_id
    returning id into created_id;
  elsif proposal.action_name in ('prepare_week', 'prepare_term') then
    for change in select * from jsonb_array_elements(coalesce(changes->'changes', '[]'::jsonb)) loop
      select * into target_row from public.assignments
      where id = (change->>'assignmentId')::uuid and family_id = proposal.family_id and student_id = proposal.student_id for update;
      if target_row.id is null then raise exception 'PROPOSAL_ASSIGNMENT_NOT_FOUND'; end if;
      update public.assignments set
        scheduled_date = coalesce(nullif(change->>'scheduledDate', '')::date, scheduled_date),
        estimated_minutes = coalesce(nullif(change->>'estimatedMinutes', '')::integer, estimated_minutes),
        version = version + 1
      where id = target_row.id;
      update public.weekly_plan_items set
        scheduled_date = coalesce(nullif(change->>'scheduledDate', '')::date, scheduled_date),
        estimated_minutes = coalesce(nullif(change->>'estimatedMinutes', '')::integer, estimated_minutes)
      where assignment_id = target_row.id and family_id = proposal.family_id;
    end loop;
  elsif proposal.action_name = 'resize_schedule_work' then
    update public.assignments set estimated_minutes = (changes->>'after')::integer, version = version + 1
    where id = proposal.target_assignment_id and family_id = proposal.family_id and student_id = proposal.student_id
    returning id into created_id;
    update public.weekly_plan_items set estimated_minutes = (changes->>'after')::integer
    where assignment_id = proposal.target_assignment_id and family_id = proposal.family_id;
  else
    raise exception 'PROPOSAL_ACTION_UNSUPPORTED';
  end if;

  update public.planning_proposals set status = 'applied', reviewed_by = p_actor_id, reviewed_at = now() where id = proposal.id;
  insert into public.audit_events(family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (proposal.family_id, p_actor_id, 'parent', 'planning_proposal.applied', 'planning_proposal', proposal.id,
    jsonb_build_object('action_name', proposal.action_name, 'created_id', created_id));
  return jsonb_build_object('status', 'applied', 'proposalId', proposal.id, 'entityId', created_id, 'duplicate', false);
end;
$$;

revoke all on function public.finalize_assignment_review(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.apply_planning_proposal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_assignment_review(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.apply_planning_proposal(uuid, uuid) to service_role;

comment on function public.finalize_assignment_review(uuid, uuid, text, jsonb) is 'Atomic parent review decision; rejected/provisional drafts never become learner facts.';
comment on function public.apply_planning_proposal(uuid, uuid) is 'Applies one stale-safe parent-approved domain proposal; never arbitrary records or fields.';
