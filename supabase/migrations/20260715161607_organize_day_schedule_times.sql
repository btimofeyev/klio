-- Allow the bounded workspace runtime to organize one learner's existing day.
alter table public.agent_tool_calls drop constraint agent_tool_calls_tool_name_check;
alter table public.agent_tool_calls add constraint agent_tool_calls_tool_name_check check (tool_name in (
  'read_capture', 'read_family_context', 'read_goals_and_pacing', 'read_review_queue',
  'read_assignment_review_context', 'read_relevant_history', 'file_capture', 'create_reminder',
  'ask_parent', 'record_explicit_completion', 'record_explicit_parent_score', 'update_assignment_status',
  'move_unfinished_work', 'organize_day_schedule', 'create_assignment', 'create_schedule_block', 'move_schedule_work',
  'resize_schedule_work', 'propose_learner_goal', 'propose_curriculum_change',
  'draft_assignment_review', 'return_work_with_draft_feedback', 'create_targeted_lesson',
  'create_supplemental_practice', 'remove_supplemental_practice', 'prepare_planning_changes',
  'present_action_card', 'update_subject_summary_draft', 'build_dashboard', 'draft_weekly_plan',
  'create_lesson', 'create_practice_activity', 'build_portfolio', 'update_records_draft'
));

-- Move actions historically changed only dates. Preserve that behavior when the
-- time key is absent, while making time-only organization atomic and undoable.
create or replace function public.apply_klio_adjustment(p_proposal_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.adjustment_proposals%rowtype;
  action public.adjustment_actions%rowtype;
  current_version bigint;
  next_date date;
  created_assignment_id uuid;
  artifact_id uuid;
begin
  select * into proposal from public.adjustment_proposals where id = p_proposal_id for update;
  if proposal.id is null then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if proposal.status = 'applied' then return jsonb_build_object('status', 'applied', 'duplicate', true); end if;
  if proposal.status <> 'proposed' then raise exception 'ADJUSTMENT_NOT_PROPOSED'; end if;
  if not exists (select 1 from public.family_members where family_id = proposal.family_id and user_id = p_actor_id and role in ('owner', 'editor')) then
    raise exception 'ADJUSTMENT_FORBIDDEN';
  end if;
  select agent_context_version into current_version from public.families where id = proposal.family_id for update;
  if current_version <> proposal.snapshot_version then
    update public.adjustment_proposals set status = 'expired', undo_status = 'stale' where id = proposal.id;
    return jsonb_build_object('status', 'expired', 'error', 'ADJUSTMENT_SNAPSHOT_STALE');
  end if;

  for action in select * from public.adjustment_actions where proposal_id = proposal.id order by position, id for update loop
    if action.action_type = 'move' then
      next_date := (action.after_state->>'scheduledDate')::date;
      if not exists (
        select 1 from public.assignments where id = action.assignment_id and family_id = proposal.family_id
          and student_id = proposal.student_id
          and scheduled_date is not distinct from (action.before_state->>'scheduledDate')::date
          and (not (action.before_state ? 'scheduledTime') or scheduled_time is not distinct from nullif(action.before_state->>'scheduledTime', '')::time)
      ) then raise exception 'ADJUSTMENT_ACTION_STALE'; end if;
      update public.assignments set
        scheduled_date = next_date,
        scheduled_time = case when action.after_state ? 'scheduledTime' then nullif(action.after_state->>'scheduledTime', '')::time else scheduled_time end,
        version = version + 1
      where id = action.assignment_id and family_id = proposal.family_id;
      update public.weekly_plan_items set
        scheduled_date = next_date,
        scheduled_time = case when action.after_state ? 'scheduledTime' then nullif(action.after_state->>'scheduledTime', '')::time else scheduled_time end,
        rescheduled_count = rescheduled_count + 1
      where assignment_id = action.assignment_id and family_id = proposal.family_id;
    elsif action.action_type = 'add_practice' then
      artifact_id := nullif(action.after_state->>'artifactId', '')::uuid;
      created_assignment_id := coalesce(nullif(action.after_state->>'createdAssignmentId', '')::uuid, gen_random_uuid());
      insert into public.assignments (
        id, family_id, student_id, created_by, created_by_type, title, subject, instructions,
        status, scheduled_date, estimated_minutes, source_kind
      ) values (
        created_assignment_id, proposal.family_id, proposal.student_id, p_actor_id, 'agent',
        coalesce(action.after_state->>'title', 'Focused practice'), coalesce(action.after_state->>'subject', 'Practice'),
        coalesce(action.after_state->>'reason', 'Focused reinforcement based on approved evidence.'),
        'planned', (action.after_state->>'scheduledDate')::date,
        coalesce((action.after_state->>'estimatedMinutes')::integer, 10), 'practice'
      );
      insert into public.weekly_plan_items (
        family_id, artifact_id, assignment_id, student_id, scheduled_date, title, description,
        estimated_minutes, subject, skill_key, source_kind
      ) values (
        proposal.family_id, artifact_id, created_assignment_id, proposal.student_id,
        (action.after_state->>'scheduledDate')::date, coalesce(action.after_state->>'title', 'Focused practice'),
        coalesce(action.after_state->>'reason', 'Focused reinforcement based on approved evidence.'),
        coalesce((action.after_state->>'estimatedMinutes')::integer, 10), coalesce(action.after_state->>'subject', 'Practice'),
        action.after_state->>'skillKey', 'klio'
      );
      update public.adjustment_actions
        set after_state = after_state || jsonb_build_object('createdAssignmentId', created_assignment_id)
        where id = action.id;
    elsif action.action_type = 'remove_practice' then
      if not exists (select 1 from public.assignments where id = action.assignment_id and family_id = proposal.family_id and student_id = proposal.student_id and source_kind = 'practice') then
        raise exception 'ADJUSTMENT_PRACTICE_NOT_FOUND';
      end if;
      delete from public.weekly_plan_items where assignment_id = action.assignment_id and family_id = proposal.family_id;
      update public.assignments set scheduled_date = null, status = 'skipped', skipped_at = now(), version = version + 1 where id = action.assignment_id and family_id = proposal.family_id;
    end if;
    update public.adjustment_actions set status = 'applied' where id = action.id;
  end loop;

  select agent_context_version into current_version from public.families where id = proposal.family_id;
  update public.adjustment_proposals set status = 'applied', approved_by = p_actor_id, approved_at = now(), applied_at = now(),
    after_snapshot_version = current_version, undo_status = 'available', undo_expires_at = now() + interval '30 days'
  where id = proposal.id;
  insert into public.audit_events (family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (proposal.family_id, p_actor_id, 'agent', 'schedule_adjustment.applied', 'adjustment_proposal', proposal.id,
    jsonb_build_object('automatic', true, 'policy', proposal.policy_decision));
  return jsonb_build_object('status', 'applied', 'afterSnapshotVersion', current_version);
end;
$$;

create or replace function public.undo_klio_adjustment(p_proposal_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.adjustment_proposals%rowtype;
  action public.adjustment_actions%rowtype;
  current_version bigint;
  created_assignment_id uuid;
  restored public.assignments%rowtype;
begin
  select * into proposal from public.adjustment_proposals where id = p_proposal_id for update;
  if proposal.id is null then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if proposal.status = 'undone' then return jsonb_build_object('status', 'undone', 'duplicate', true); end if;
  if proposal.status <> 'applied' or proposal.undo_status <> 'available' then raise exception 'UNDO_NOT_AVAILABLE'; end if;
  if not exists (select 1 from public.family_members where family_id = proposal.family_id and user_id = p_actor_id and role in ('owner', 'editor')) then
    raise exception 'UNDO_FORBIDDEN';
  end if;
  select agent_context_version into current_version from public.families where id = proposal.family_id for update;
  if current_version <> proposal.after_snapshot_version then
    update public.adjustment_proposals set undo_status = 'stale' where id = proposal.id;
    return jsonb_build_object('status', 'stale', 'error', 'UNDO_SNAPSHOT_STALE');
  end if;

  for action in select * from public.adjustment_actions where proposal_id = proposal.id order by position desc, id desc for update loop
    if action.action_type = 'move' then
      if not exists (
        select 1 from public.assignments where id = action.assignment_id and family_id = proposal.family_id
          and scheduled_date is not distinct from (action.after_state->>'scheduledDate')::date
          and (not (action.after_state ? 'scheduledTime') or scheduled_time is not distinct from nullif(action.after_state->>'scheduledTime', '')::time)
      ) then raise exception 'UNDO_ACTION_STALE'; end if;
      update public.assignments set
        scheduled_date = (action.before_state->>'scheduledDate')::date,
        scheduled_time = case when action.before_state ? 'scheduledTime' then nullif(action.before_state->>'scheduledTime', '')::time else scheduled_time end,
        version = version + 1
      where id = action.assignment_id and family_id = proposal.family_id;
      update public.weekly_plan_items set
        scheduled_date = (action.before_state->>'scheduledDate')::date,
        scheduled_time = case when action.before_state ? 'scheduledTime' then nullif(action.before_state->>'scheduledTime', '')::time else scheduled_time end,
        rescheduled_count = greatest(0, rescheduled_count - 1)
      where assignment_id = action.assignment_id and family_id = proposal.family_id;
    elsif action.action_type = 'add_practice' then
      created_assignment_id := nullif(action.after_state->>'createdAssignmentId', '')::uuid;
      if created_assignment_id is null then raise exception 'UNDO_PRACTICE_REFERENCE_MISSING'; end if;
      if exists (select 1 from public.assignments where id = created_assignment_id and family_id = proposal.family_id and status in ('completed', 'submitted', 'needs_review')) then
        raise exception 'UNDO_PRACTICE_ALREADY_USED';
      end if;
      delete from public.weekly_plan_items where assignment_id = created_assignment_id and family_id = proposal.family_id;
      delete from public.assignments where id = created_assignment_id and family_id = proposal.family_id and source_kind = 'practice';
    elsif action.action_type = 'remove_practice' then
      update public.assignments set scheduled_date = (action.before_state->>'scheduledDate')::date,
        status = coalesce(action.before_state->>'status', 'planned'), skipped_at = null, version = version + 1
      where id = action.assignment_id and family_id = proposal.family_id and source_kind = 'practice'
      returning * into restored;
      if restored.id is null then raise exception 'UNDO_PRACTICE_NOT_FOUND'; end if;
      insert into public.weekly_plan_items (
        family_id, artifact_id, assignment_id, student_id, scheduled_date, title, description,
        estimated_minutes, subject, skill_key, source_kind
      ) values (
        proposal.family_id, nullif(action.before_state->>'artifactId', '')::uuid, restored.id, restored.student_id,
        restored.scheduled_date, restored.title, restored.instructions, restored.estimated_minutes,
        restored.subject, action.before_state->>'skillKey', 'klio'
      ) on conflict do nothing;
    end if;
    update public.adjustment_actions set status = 'undone' where id = action.id;
  end loop;

  update public.adjustment_proposals set status = 'undone', undo_status = 'undone', undone_by = p_actor_id, undone_at = now() where id = proposal.id;
  insert into public.audit_events (family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (proposal.family_id, p_actor_id, 'parent', 'schedule_adjustment.undone', 'adjustment_proposal', proposal.id, '{}'::jsonb);
  return jsonb_build_object('status', 'undone');
end;
$$;

revoke all on function public.apply_klio_adjustment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.undo_klio_adjustment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_klio_adjustment(uuid, uuid) to service_role;
grant execute on function public.undo_klio_adjustment(uuid, uuid) to service_role;
