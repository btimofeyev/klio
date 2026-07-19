-- A single Klio turn can prepare one schedule proposal per learner. Applying one
-- proposal advances the family snapshot, but should not invalidate untouched,
-- disjoint proposals from that same turn.
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
  safe_sibling_batch boolean := false;
begin
  select * into proposal
  from public.planning_proposals
  where id = p_proposal_id
  for update;

  if proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if not exists (
    select 1
    from public.family_members
    where family_id = proposal.family_id
      and user_id = p_actor_id
      and role in ('owner', 'editor')
  ) then
    raise exception 'PROPOSAL_FORBIDDEN';
  end if;
  if proposal.status = 'applied' then
    return jsonb_build_object('status', 'applied', 'proposalId', proposal.id, 'duplicate', true);
  end if;

  changes := proposal.proposed_changes;
  select agent_context_version into current_version
  from public.families
  where id = proposal.family_id
  for update;

  -- Recover only a schedule proposal from the same agent turn as an already
  -- applied proposal for another learner, and only while every concrete target
  -- still matches the state captured when this proposal was created.
  if proposal.action_name in ('prepare_week', 'prepare_term')
    and proposal.agent_turn_id is not null
    and proposal.status in ('proposed', 'expired')
    and exists (
      select 1
      from public.planning_proposals sibling
      where sibling.family_id = proposal.family_id
        and sibling.agent_turn_id = proposal.agent_turn_id
        and sibling.snapshot_version = proposal.snapshot_version
        and sibling.id <> proposal.id
        and sibling.status = 'applied'
        and sibling.action_name in ('prepare_week', 'prepare_term')
        and sibling.student_id is distinct from proposal.student_id
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(changes->'changes', '[]'::jsonb)) as proposed_change(value)
      left join public.assignments assignment
        on assignment.id = (proposed_change.value->>'assignmentId')::uuid
        and assignment.family_id = proposal.family_id
        and assignment.student_id = proposal.student_id
      where assignment.id is null
        or assignment.updated_at > proposal.created_at
        or (
          proposed_change.value ? 'previousVersion'
          and assignment.version is distinct from (proposed_change.value->>'previousVersion')::integer
        )
        or (
          proposed_change.value ? 'previousScheduledDate'
          and assignment.scheduled_date is distinct from nullif(proposed_change.value->>'previousScheduledDate', '')::date
        )
        or (
          proposed_change.value ? 'previousEstimatedMinutes'
          and assignment.estimated_minutes is distinct from nullif(proposed_change.value->>'previousEstimatedMinutes', '')::integer
        )
        or exists (
          select 1
          from public.weekly_plan_items plan_item
          where plan_item.family_id = proposal.family_id
            and plan_item.assignment_id = assignment.id
            and plan_item.updated_at > proposal.created_at
        )
    )
  then
    safe_sibling_batch := true;
  end if;

  if proposal.status <> 'proposed' and not (proposal.status = 'expired' and safe_sibling_batch) then
    raise exception 'PROPOSAL_NOT_ACTIVE';
  end if;
  if current_version <> proposal.snapshot_version and not safe_sibling_batch then
    update public.planning_proposals
    set status = 'expired', reviewed_by = p_actor_id, reviewed_at = now()
    where id = proposal.id;
    return jsonb_build_object('status', 'expired', 'error', 'PROPOSAL_SNAPSHOT_STALE');
  end if;

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
      where id = proposal.target_goal_id
        and family_id = proposal.family_id
        and student_id = proposal.student_id
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
    where id = proposal.target_curriculum_unit_id
      and family_id = proposal.family_id
      and student_id = proposal.student_id
    returning id into created_id;
  elsif proposal.action_name in ('prepare_week', 'prepare_term') then
    for change in
      select * from jsonb_array_elements(coalesce(changes->'changes', '[]'::jsonb))
    loop
      select * into target_row
      from public.assignments
      where id = (change->>'assignmentId')::uuid
        and family_id = proposal.family_id
        and student_id = proposal.student_id
      for update;
      if target_row.id is null then raise exception 'PROPOSAL_ASSIGNMENT_NOT_FOUND'; end if;

      -- The sibling exception never weakens target-level conflict detection.
      if safe_sibling_batch and (
        target_row.updated_at > proposal.created_at
        or (change ? 'previousVersion' and target_row.version is distinct from (change->>'previousVersion')::integer)
        or (change ? 'previousScheduledDate' and target_row.scheduled_date is distinct from nullif(change->>'previousScheduledDate', '')::date)
        or (change ? 'previousEstimatedMinutes' and target_row.estimated_minutes is distinct from nullif(change->>'previousEstimatedMinutes', '')::integer)
      ) then
        update public.planning_proposals
        set status = 'expired', reviewed_by = p_actor_id, reviewed_at = now()
        where id = proposal.id;
        return jsonb_build_object('status', 'expired', 'error', 'PROPOSAL_TARGET_STALE');
      end if;

      update public.assignments set
        scheduled_date = coalesce(nullif(change->>'scheduledDate', '')::date, scheduled_date),
        estimated_minutes = coalesce(nullif(change->>'estimatedMinutes', '')::integer, estimated_minutes),
        version = version + 1
      where id = target_row.id;
      update public.weekly_plan_items set
        scheduled_date = coalesce(nullif(change->>'scheduledDate', '')::date, scheduled_date),
        estimated_minutes = coalesce(nullif(change->>'estimatedMinutes', '')::integer, estimated_minutes)
      where assignment_id = target_row.id
        and family_id = proposal.family_id;
    end loop;
  elsif proposal.action_name = 'resize_schedule_work' then
    update public.assignments set
      estimated_minutes = (changes->>'after')::integer,
      version = version + 1
    where id = proposal.target_assignment_id
      and family_id = proposal.family_id
      and student_id = proposal.student_id
    returning id into created_id;
    update public.weekly_plan_items set estimated_minutes = (changes->>'after')::integer
    where assignment_id = proposal.target_assignment_id
      and family_id = proposal.family_id;
  else
    raise exception 'PROPOSAL_ACTION_UNSUPPORTED';
  end if;

  update public.planning_proposals
  set status = 'applied', reviewed_by = p_actor_id, reviewed_at = now()
  where id = proposal.id;
  insert into public.audit_events(family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    proposal.family_id, p_actor_id, 'parent', 'planning_proposal.applied',
    'planning_proposal', proposal.id,
    jsonb_build_object('action_name', proposal.action_name, 'created_id', created_id, 'sibling_batch', safe_sibling_batch)
  );
  return jsonb_build_object(
    'status', 'applied', 'proposalId', proposal.id, 'entityId', created_id,
    'duplicate', false, 'siblingBatch', safe_sibling_batch
  );
end;
$$;

revoke all on function public.apply_planning_proposal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_planning_proposal(uuid, uuid) to service_role;

comment on function public.apply_planning_proposal(uuid, uuid) is
  'Atomically applies one parent-approved domain proposal. Same-turn schedule proposals for different learners remain valid only while their concrete targets are unchanged.';
