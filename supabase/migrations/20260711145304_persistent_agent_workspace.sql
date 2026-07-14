alter table public.families
  add column agent_context_version bigint not null default 0 check (agent_context_version >= 0);

create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  provider text not null check (provider in ('codex_app_server', 'responses')),
  provider_thread_id text,
  agent_kind text not null default 'family_workspace' check (agent_kind = 'family_workspace'),
  generation integer not null default 1 check (generation > 0),
  status text not null default 'active' check (status in ('active', 'awaiting_parent', 'replacing', 'archived', 'failed')),
  runtime_version text,
  turn_count integer not null default 0 check (turn_count >= 0),
  last_turn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  unique (provider, provider_thread_id)
);

create unique index agent_threads_one_current_family_idx
  on public.agent_threads(family_id, agent_kind)
  where status in ('active', 'awaiting_parent', 'replacing');

create table public.agent_turns (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  family_id uuid not null references public.families(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  source_evidence_id uuid references public.evidence_items(id) on delete set null,
  trigger text not null check (trigger in ('capture', 'parent_message', 'clarification_answer', 'scheduled', 'retry')),
  goal text not null check (goal in ('capture', 'dashboard', 'lesson', 'practice', 'weekly_plan', 'portfolio', 'records', 'general')),
  status text not null default 'queued' check (status in ('queued', 'running', 'awaiting_parent', 'completed', 'failed', 'cancelled')),
  outcome text check (outcome is null or outcome in ('reminder', 'filed', 'question', 'draft', 'completed', 'none')),
  provider_turn_id text,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  initial_snapshot_version bigint not null check (initial_snapshot_version >= 0),
  current_snapshot_version bigint not null check (current_snapshot_version >= 0),
  snapshot_hash text not null check (char_length(snapshot_hash) = 64),
  snapshot_summary jsonb not null default '{}'::jsonb,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  last_heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  public_result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  unique (family_id, idempotency_key),
  foreign key (thread_id, family_id) references public.agent_threads(id, family_id) on delete cascade
);

create table public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  turn_id uuid not null,
  provider_item_id text,
  tool_name text not null check (tool_name in (
    'read_capture', 'read_family_context', 'file_capture', 'create_reminder', 'ask_parent',
    'update_subject_summary_draft', 'build_dashboard', 'draft_weekly_plan', 'create_lesson',
    'create_practice_activity', 'build_portfolio', 'update_records_draft'
  )),
  risk text not null check (risk in ('read', 'low_risk_write', 'approval_required')),
  status text not null default 'requested' check (status in ('requested', 'executing', 'completed', 'rejected', 'failed')),
  arguments_redacted jsonb not null default '{}'::jsonb,
  result_summary jsonb,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  snapshot_version bigint not null check (snapshot_version >= 0),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, family_id),
  unique (turn_id, idempotency_key),
  foreign key (turn_id, family_id) references public.agent_turns(id, family_id) on delete cascade
);

create table public.agent_events (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  turn_id uuid not null,
  sequence integer not null check (sequence > 0),
  kind text not null check (kind in (
    'turn.queued', 'turn.started', 'agent.progress', 'tool.requested', 'tool.completed',
    'clarification.requested', 'turn.completed', 'turn.failed'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (turn_id, sequence),
  foreign key (turn_id, family_id) references public.agent_turns(id, family_id) on delete cascade
);

create index agent_threads_family_updated_idx on public.agent_threads(family_id, updated_at desc);
create index agent_turns_family_created_idx on public.agent_turns(family_id, created_at desc);
create index agent_turns_claim_idx on public.agent_turns(status, created_at) where status in ('queued', 'running');
create unique index agent_turns_one_running_family_idx on public.agent_turns(family_id) where status = 'running';
create index agent_tool_calls_turn_created_idx on public.agent_tool_calls(turn_id, created_at);
create index agent_events_turn_sequence_idx on public.agent_events(turn_id, sequence);

create trigger agent_threads_set_updated_at before update on public.agent_threads
for each row execute function private.set_updated_at();
create trigger agent_turns_set_updated_at before update on public.agent_turns
for each row execute function private.set_updated_at();

alter table public.reminders add column agent_tool_call_id uuid;
alter table public.reminders add constraint reminders_agent_tool_call_family_fkey
  foreign key (agent_tool_call_id, family_id) references public.agent_tool_calls(id, family_id) on delete restrict;

alter table public.evidence_categories add column agent_tool_call_id uuid;
alter table public.evidence_categories add constraint evidence_categories_agent_tool_call_family_fkey
  foreign key (agent_tool_call_id, family_id) references public.agent_tool_calls(id, family_id) on delete restrict;

alter table public.question_threads add column agent_thread_id uuid;
alter table public.question_threads add constraint question_threads_agent_thread_family_fkey
  foreign key (agent_thread_id, family_id) references public.agent_threads(id, family_id) on delete restrict;

alter table public.question_messages add column agent_turn_id uuid;
alter table public.question_messages add constraint question_messages_agent_turn_family_fkey
  foreign key (agent_turn_id, family_id) references public.agent_turns(id, family_id) on delete restrict;

alter table public.agent_runs add column agent_thread_id uuid;
alter table public.agent_runs add column agent_turn_id uuid;
alter table public.agent_runs add constraint agent_runs_agent_thread_family_fkey
  foreign key (agent_thread_id, family_id) references public.agent_threads(id, family_id) on delete restrict;
alter table public.agent_runs add constraint agent_runs_agent_turn_family_fkey
  foreign key (agent_turn_id, family_id) references public.agent_turns(id, family_id) on delete restrict;

create or replace function private.bump_family_agent_context()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_family_id uuid;
begin
  target_family_id := case when tg_op = 'DELETE' then old.family_id else new.family_id end;
  update public.families
  set agent_context_version = agent_context_version + 1
  where id = target_family_id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.bump_family_row_agent_context()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.name, new.timezone, new.available_days, new.weekly_minutes)
    is distinct from row(old.name, old.timezone, old.available_days, old.weekly_minutes) then
    new.agent_context_version := old.agent_context_version + 1;
  end if;
  return new;
end;
$$;

create trigger families_bump_agent_context before update on public.families
for each row execute function private.bump_family_row_agent_context();

create trigger students_bump_agent_context after insert or update or delete on public.students
for each row execute function private.bump_family_agent_context();
create trigger evidence_items_bump_agent_context after insert or update or delete on public.evidence_items
for each row execute function private.bump_family_agent_context();
create trigger evidence_students_bump_agent_context after insert or update or delete on public.evidence_students
for each row execute function private.bump_family_agent_context();
create trigger categories_bump_agent_context after insert or update or delete on public.categories
for each row execute function private.bump_family_agent_context();
create trigger evidence_categories_bump_agent_context after insert or update or delete on public.evidence_categories
for each row execute function private.bump_family_agent_context();
create trigger reminders_bump_agent_context after insert or update or delete on public.reminders
for each row execute function private.bump_family_agent_context();
create trigger skill_observations_bump_agent_context after insert or update or delete on public.skill_observations
for each row execute function private.bump_family_agent_context();
create trigger artifacts_bump_agent_context after insert or update or delete on public.artifacts
for each row execute function private.bump_family_agent_context();
create trigger organization_corrections_bump_agent_context after insert or update or delete on public.organization_corrections
for each row execute function private.bump_family_agent_context();
create trigger weekly_plan_items_bump_agent_context after insert or update or delete on public.weekly_plan_items
for each row execute function private.bump_family_agent_context();
create trigger practice_sessions_bump_agent_context after insert or update or delete on public.practice_sessions
for each row execute function private.bump_family_agent_context();
create trigger practice_results_bump_agent_context after insert or update or delete on public.practice_results
for each row execute function private.bump_family_agent_context();

alter table public.agent_threads enable row level security;
alter table public.agent_turns enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.agent_events enable row level security;

create policy "agent threads are visible to family members"
on public.agent_threads for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "agent turns are visible to family members"
on public.agent_turns for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "agent tool calls are visible to family members"
on public.agent_tool_calls for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "agent events are visible to family members"
on public.agent_events for select to authenticated
using ((select private.is_family_member(family_id)));

grant select on public.agent_threads, public.agent_turns, public.agent_tool_calls, public.agent_events to authenticated;

alter table public.artifacts drop constraint artifacts_type_check;
alter table public.artifacts add constraint artifacts_type_check
  check (type in ('analysis', 'next_step', 'dashboard', 'weekly_plan', 'lesson', 'summary', 'practice', 'portfolio'));

create or replace function public.apply_agent_workspace_tool(
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
  entity_id uuid;
  approval_id uuid;
  filed_category_id uuid;
  artifact_type text;
  result jsonb;
begin
  select * into target_turn
  from public.agent_turns
  where id = p_turn_id
  for update;
  if not found then raise exception 'AGENT_TURN_NOT_FOUND'; end if;
  if target_turn.status not in ('running', 'awaiting_parent') then raise exception 'AGENT_TURN_NOT_ACTIVE'; end if;

  select agent_context_version into family_version
  from public.families
  where id = target_turn.family_id
  for update;
  if family_version is distinct from target_turn.current_snapshot_version then
    raise exception 'AGENT_SNAPSHOT_STALE';
  end if;

  select id, result_summary into tool_call_id, result
  from public.agent_tool_calls
  where turn_id = p_turn_id and idempotency_key = p_idempotency_key and status = 'completed';
  if found then return result; end if;

  insert into public.agent_tool_calls (
    family_id, turn_id, tool_name, risk, status, arguments_redacted,
    snapshot_version, idempotency_key, started_at
  ) values (
    target_turn.family_id, target_turn.id, p_tool_name,
    case when p_tool_name in ('create_reminder', 'file_capture', 'ask_parent') then 'low_risk_write' else 'approval_required' end,
    'executing', coalesce(p_arguments_redacted, '{}'::jsonb), family_version, p_idempotency_key, now()
  ) returning id into tool_call_id;

  if p_tool_name = 'create_reminder' then
    if nullif(trim(p_arguments->>'title'), '') is null then raise exception 'REMINDER_TITLE_REQUIRED'; end if;
    if not exists (
      select 1 from public.evidence_items
      where id = (p_arguments->>'sourceEvidenceId')::uuid and family_id = target_turn.family_id
    ) then raise exception 'SOURCE_EVIDENCE_NOT_FOUND'; end if;
    if nullif(p_arguments->>'studentId', '') is not null and not exists (
      select 1 from public.students
      where id = (p_arguments->>'studentId')::uuid and family_id = target_turn.family_id
    ) then raise exception 'STUDENT_NOT_FOUND'; end if;

    insert into public.reminders (
      family_id, student_id, source_evidence_id, agent_tool_call_id, title, due_at,
      status, created_by_type, created_by, confidence, rationale
    ) values (
      target_turn.family_id, nullif(p_arguments->>'studentId', '')::uuid,
      (p_arguments->>'sourceEvidenceId')::uuid, tool_call_id,
      left(trim(p_arguments->>'title'), 200), nullif(p_arguments->>'dueAt', '')::timestamptz,
      'pending', 'agent', target_turn.requested_by,
      coalesce(nullif(p_arguments->>'confidence', '')::numeric, 1), p_arguments->>'rationale'
    )
    on conflict (family_id, source_evidence_id, lower(title)) where status = 'pending' and source_evidence_id is not null
    do update set due_at = excluded.due_at
    returning id into entity_id;
    result := jsonb_build_object('outcome', 'reminder', 'reminderId', entity_id, 'created', true);

  elsif p_tool_name = 'file_capture' then
    if p_arguments->>'category' not in ('Math', 'Language Arts', 'Science', 'Social Studies', 'Art', 'Music', 'Physical Education', 'Life Skills', 'Other') then
      raise exception 'CATEGORY_NOT_ALLOWED';
    end if;
    if not exists (
      select 1 from public.evidence_items
      where id = (p_arguments->>'evidenceId')::uuid and family_id = target_turn.family_id
    ) then raise exception 'EVIDENCE_NOT_FOUND'; end if;
    if not exists (
      select 1 from public.students
      where id = (p_arguments->>'studentId')::uuid and family_id = target_turn.family_id
    ) then raise exception 'STUDENT_NOT_FOUND'; end if;

    insert into public.categories (family_id, name, slug, description, created_by_type, created_by)
    values (
      target_turn.family_id, p_arguments->>'category',
      regexp_replace(lower(p_arguments->>'category'), '[^a-z0-9]+', '-', 'g'),
      (p_arguments->>'category') || ' learning records and source evidence.', 'agent', target_turn.requested_by
    )
    on conflict (family_id, slug) do update set name = excluded.name
    returning id into filed_category_id;

    insert into public.evidence_categories (
      family_id, evidence_id, category_id, agent_tool_call_id, assigned_by,
      confidence, document_type, tags
    ) values (
      target_turn.family_id, (p_arguments->>'evidenceId')::uuid, filed_category_id, tool_call_id, 'agent',
      coalesce(nullif(p_arguments->>'confidence', '')::numeric, 0.5),
      left(coalesce(nullif(trim(p_arguments->>'documentType'), ''), 'Record'), 80),
      coalesce(array(select jsonb_array_elements_text(p_arguments->'tags')), '{}')
    )
    on conflict (evidence_id, category_id) do update set
      agent_tool_call_id = excluded.agent_tool_call_id,
      confidence = excluded.confidence,
      document_type = excluded.document_type,
      tags = excluded.tags;

    update public.evidence_items
    set capture_route = 'learning', processing_status = 'ready', error_message = null
    where id = (p_arguments->>'evidenceId')::uuid and family_id = target_turn.family_id;
    entity_id := (p_arguments->>'evidenceId')::uuid;
    result := jsonb_build_object('outcome', 'filed', 'evidenceId', entity_id, 'categoryId', filed_category_id, 'artifactCreated', false, 'approvalCreated', false);

  elsif p_tool_name = 'ask_parent' then
    if target_turn.requested_by is null then raise exception 'REQUESTING_PARENT_REQUIRED'; end if;
    if nullif(trim(p_arguments->>'question'), '') is null then raise exception 'QUESTION_REQUIRED'; end if;

    insert into public.question_threads (family_id, student_id, title, created_by, agent_thread_id)
    values (
      target_turn.family_id, nullif(p_arguments->>'studentId', '')::uuid,
      left(trim(p_arguments->>'question'), 200), target_turn.requested_by, target_turn.thread_id
    ) returning id into entity_id;
    insert into public.question_messages (thread_id, family_id, role, content, created_by, agent_turn_id)
    values (entity_id, target_turn.family_id, 'assistant', left(trim(p_arguments->>'question'), 10000), null, target_turn.id);
    update public.agent_threads set status = 'awaiting_parent' where id = target_turn.thread_id;
    update public.agent_turns set status = 'awaiting_parent', outcome = 'question' where id = target_turn.id;
    result := jsonb_build_object('outcome', 'question', 'questionThreadId', entity_id, 'awaitingParent', true);

  elsif p_tool_name in (
    'update_subject_summary_draft', 'build_dashboard', 'draft_weekly_plan', 'create_lesson',
    'create_practice_activity', 'build_portfolio', 'update_records_draft'
  ) then
    if target_turn.requested_by is null then raise exception 'REQUESTING_PARENT_REQUIRED'; end if;
    artifact_type := case p_tool_name
      when 'update_subject_summary_draft' then 'summary'
      when 'build_dashboard' then 'dashboard'
      when 'draft_weekly_plan' then 'weekly_plan'
      when 'create_lesson' then 'lesson'
      when 'create_practice_activity' then 'practice'
      when 'build_portfolio' then 'portfolio'
      else 'analysis'
    end;
    if nullif(trim(p_arguments->>'title'), '') is null then raise exception 'ARTIFACT_TITLE_REQUIRED'; end if;
    if nullif(p_arguments->>'studentId', '') is not null and not exists (
      select 1 from public.students
      where id = (p_arguments->>'studentId')::uuid and family_id = target_turn.family_id
    ) then raise exception 'STUDENT_NOT_FOUND'; end if;

    insert into public.artifacts (
      family_id, student_id, created_by, type, title, summary, content, rationale, status
    ) values (
      target_turn.family_id, nullif(p_arguments->>'studentId', '')::uuid, target_turn.requested_by,
      artifact_type, left(trim(p_arguments->>'title'), 200), p_arguments->>'summary',
      coalesce(p_arguments->'content', '{}'::jsonb), p_arguments->>'rationale', 'draft'
    ) returning id into entity_id;
    insert into public.approval_requests (family_id, entity_type, entity_id)
    values (target_turn.family_id, 'artifact', entity_id)
    returning id into approval_id;
    update public.agent_tool_calls set approval_request_id = approval_id where id = tool_call_id;
    result := jsonb_build_object('outcome', 'draft', 'artifactId', entity_id, 'approvalRequestId', approval_id, 'artifactType', artifact_type);

  else
    raise exception 'AGENT_TOOL_NOT_SUPPORTED';
  end if;

  select agent_context_version into family_version from public.families where id = target_turn.family_id;
  update public.agent_turns
  set current_snapshot_version = family_version,
      outcome = case when result->>'outcome' in ('reminder', 'filed', 'question', 'draft') then result->>'outcome' else outcome end
  where id = target_turn.id;
  update public.agent_tool_calls
  set status = 'completed', result_summary = result, completed_at = now()
  where id = tool_call_id;

  insert into public.audit_events (family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (target_turn.family_id, null, 'agent', 'agent.tool_completed', p_tool_name, entity_id, jsonb_build_object('turn_id', target_turn.id, 'tool_call_id', tool_call_id));
  return result;
exception when others then
  if tool_call_id is not null then
    update public.agent_tool_calls
    set status = 'failed', completed_at = now(), result_summary = jsonb_build_object('error', sqlstate)
    where id = tool_call_id;
  end if;
  raise;
end;
$$;

revoke all on function public.apply_agent_workspace_tool(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_agent_workspace_tool(uuid, text, text, jsonb, jsonb) to service_role;
grant all on public.agent_threads, public.agent_turns, public.agent_tool_calls, public.agent_events to service_role;
grant usage, select on sequence public.agent_events_id_seq to service_role;
