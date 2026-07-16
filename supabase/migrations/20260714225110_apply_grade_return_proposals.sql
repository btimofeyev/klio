-- Apply the narrowly-scoped return-work proposal through the atomic review function.

create or replace function public.apply_grade_return_proposal(p_proposal_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.planning_proposals%rowtype;
  current_version bigint;
  review_result jsonb;
begin
  select * into proposal from public.planning_proposals where id = p_proposal_id for update;
  if proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if proposal.action_name <> 'record_inferred_grade' or proposal.proposal_kind <> 'grade' then
    raise exception 'GRADE_PROPOSAL_INVALID';
  end if;
  if not exists (
    select 1 from public.family_members
    where family_id = proposal.family_id and user_id = p_actor_id and role in ('owner', 'editor')
  ) then raise exception 'PROPOSAL_FORBIDDEN'; end if;
  if proposal.status = 'applied' then
    return jsonb_build_object('status', 'applied', 'proposalId', proposal.id, 'duplicate', true);
  end if;
  if proposal.status <> 'proposed' then raise exception 'PROPOSAL_NOT_ACTIVE'; end if;
  select agent_context_version into current_version from public.families where id = proposal.family_id for update;
  if current_version <> proposal.snapshot_version then
    update public.planning_proposals set status = 'expired', reviewed_by = p_actor_id, reviewed_at = now() where id = proposal.id;
    return jsonb_build_object('status', 'expired', 'error', 'PROPOSAL_SNAPSHOT_STALE');
  end if;
  if not exists (
    select 1 from public.assignment_reviews
    where id = nullif(proposal.proposed_changes->>'reviewId', '')::uuid
      and family_id = proposal.family_id and assignment_id = proposal.target_assignment_id
  ) then raise exception 'GRADE_PROPOSAL_REVIEW_NOT_FOUND'; end if;

  select public.finalize_assignment_review(
    (proposal.proposed_changes->>'reviewId')::uuid,
    p_actor_id,
    'return',
    jsonb_build_object(
      'feedback', coalesce(proposal.proposed_changes->>'feedback', ''),
      'returnReason', coalesce(proposal.proposed_changes->>'nextStep', '')
    )
  ) into review_result;
  update public.planning_proposals set status = 'applied', reviewed_by = p_actor_id, reviewed_at = now() where id = proposal.id;
  insert into public.audit_events(family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    proposal.family_id, p_actor_id, 'parent', 'planning_proposal.applied',
    'planning_proposal', proposal.id,
    jsonb_build_object('action_name', proposal.action_name, 'review_result', review_result)
  );
  return jsonb_build_object(
    'status', 'applied', 'proposalId', proposal.id,
    'reviewId', proposal.proposed_changes->>'reviewId', 'duplicate', false
  );
end;
$$;

revoke all on function public.apply_grade_return_proposal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_grade_return_proposal(uuid, uuid) to service_role;

comment on function public.apply_grade_return_proposal(uuid, uuid)
  is 'Applies only a stale-safe parent-approved return-work proposal and atomically updates the review state.';
