alter function public.apply_agent_workspace_tool(uuid, text, text, jsonb, jsonb)
  rename to apply_agent_workspace_tool_v1;

create function public.apply_agent_workspace_tool(
  p_turn_id uuid,
  p_tool_name text,
  p_idempotency_key text,
  p_arguments jsonb,
  p_arguments_redacted jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  target_turn public.agent_turns%rowtype;
  family_version bigint;
  tool_call_id uuid;
  reminder_id uuid;
  result jsonb;
begin
  if p_tool_name <> 'create_reminder' or nullif(p_arguments->>'sourceEvidenceId', '') is not null then
    return public.apply_agent_workspace_tool_v1(p_turn_id, p_tool_name, p_idempotency_key, p_arguments, p_arguments_redacted);
  end if;

  select * into target_turn from public.agent_turns where id = p_turn_id for update;
  if not found then raise exception 'AGENT_TURN_NOT_FOUND'; end if;
  if target_turn.status not in ('running', 'awaiting_parent') then raise exception 'AGENT_TURN_NOT_ACTIVE'; end if;

  select agent_context_version into family_version from public.families where id = target_turn.family_id for update;
  if family_version is distinct from target_turn.current_snapshot_version then raise exception 'AGENT_SNAPSHOT_STALE'; end if;

  select id, result_summary into tool_call_id, result
  from public.agent_tool_calls
  where turn_id = p_turn_id and idempotency_key = p_idempotency_key and status = 'completed';
  if found then return result; end if;

  if nullif(trim(p_arguments->>'title'), '') is null then raise exception 'REMINDER_TITLE_REQUIRED'; end if;
  if nullif(p_arguments->>'studentId', '') is not null and not exists (
    select 1 from public.students where id = (p_arguments->>'studentId')::uuid and family_id = target_turn.family_id
  ) then raise exception 'STUDENT_NOT_FOUND'; end if;

  insert into public.agent_tool_calls (
    family_id, turn_id, tool_name, risk, status, arguments_redacted,
    snapshot_version, idempotency_key, started_at
  ) values (
    target_turn.family_id, target_turn.id, p_tool_name, 'low_risk_write', 'executing',
    coalesce(p_arguments_redacted, '{}'::jsonb), family_version, p_idempotency_key, now()
  ) returning id into tool_call_id;

  insert into public.reminders (
    family_id, student_id, source_evidence_id, agent_tool_call_id, title, due_at,
    status, created_by_type, created_by, confidence, rationale
  ) values (
    target_turn.family_id, nullif(p_arguments->>'studentId', '')::uuid, null, tool_call_id,
    left(trim(p_arguments->>'title'), 200), nullif(p_arguments->>'dueAt', '')::timestamptz,
    'pending', 'agent', target_turn.requested_by,
    coalesce(nullif(p_arguments->>'confidence', '')::numeric, 1), p_arguments->>'rationale'
  ) returning id into reminder_id;

  result := jsonb_build_object('outcome', 'reminder', 'reminderId', reminder_id, 'created', true);
  select agent_context_version into family_version from public.families where id = target_turn.family_id;
  update public.agent_turns set current_snapshot_version = family_version, outcome = 'reminder' where id = target_turn.id;
  update public.agent_tool_calls set status = 'completed', result_summary = result, completed_at = now() where id = tool_call_id;
  insert into public.audit_events (family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (target_turn.family_id, null, 'agent', 'agent.tool_completed', 'create_reminder', reminder_id, jsonb_build_object('turn_id', target_turn.id, 'tool_call_id', tool_call_id, 'direct_parent_request', true));
  return result;
exception when others then
  if tool_call_id is not null then
    update public.agent_tool_calls set status = 'failed', completed_at = now(), result_summary = jsonb_build_object('error', sqlstate) where id = tool_call_id;
  end if;
  raise;
end;
$$;

revoke all on function public.apply_agent_workspace_tool_v1(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.apply_agent_workspace_tool(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_agent_workspace_tool_v1(uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.apply_agent_workspace_tool(uuid, text, text, jsonb, jsonb) to service_role;
