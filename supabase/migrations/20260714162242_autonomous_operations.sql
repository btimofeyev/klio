-- Autonomous homeschool operations: cautious evaluations, calm receipts, policy, and undo.

create table public.family_autonomy_policies (
  family_id uuid primary key references public.families(id) on delete cascade,
  preset text not null default 'proactive' check (preset in ('helpful', 'proactive', 'ask_first', 'custom')),
  policies jsonb not null default '{}'::jsonb check (jsonb_typeof(policies) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.proactive_evaluations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  event_kind text not null check (event_kind in (
    'assignment_completed', 'assignment_submitted', 'grade_approved', 'practice_completed',
    'assignment_unfinished', 'schedule_adjusted', 'capture_filed', 'parent_correction',
    'day_reconciliation', 'day_preparation', 'weekly_boundary', 'evidence_changed', 'manual'
  )),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  outcome text check (outcome is null or outcome in ('no_action', 'insight', 'automatic_action', 'review_required', 'needs_detail')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  last_progress_at timestamptz,
  completed_at timestamptz,
  summary text check (summary is null or char_length(summary) <= 1000),
  result jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, idempotency_key),
  unique (id, family_id)
);

create table public.klio_insights (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  evaluation_id uuid,
  kind text not null check (kind in ('noticed', 'adjusted', 'practice_ready', 'review_ready', 'needs_detail', 'on_track')),
  title text not null check (char_length(title) between 1 and 160),
  summary text not null check (char_length(summary) between 1 and 1000),
  reason text check (reason is null or char_length(reason) <= 1200),
  priority smallint not null default 50 check (priority between 0 and 100),
  status text not null default 'active' check (status in ('active', 'dismissed', 'superseded')),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  action_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(action_ref) = 'object'),
  dedupe_key text not null check (char_length(dedupe_key) between 8 and 200),
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, dedupe_key),
  unique (id, family_id),
  foreign key (evaluation_id, family_id) references public.proactive_evaluations(id, family_id) on delete set null
);

alter table public.assignment_reviews
  add column skill_key text check (skill_key is null or char_length(skill_key) <= 160),
  add column evidence_kind text not null default 'curriculum' check (evidence_kind in ('curriculum', 'practice'));

alter table public.agent_turns
  drop constraint agent_turns_trigger_check,
  add constraint agent_turns_trigger_check check (trigger in ('capture', 'parent_message', 'clarification_answer', 'scheduled', 'retry', 'proactive_event')),
  add column student_id uuid references public.students(id) on delete set null,
  add column task_name text check (task_name is null or char_length(task_name) <= 200),
  add column subject text check (subject is null or char_length(subject) <= 80),
  add column source_count smallint not null default 0 check (source_count between 0 and 100),
  add column normalized_step text check (normalized_step is null or normalized_step in (
    'received', 'waiting', 'reading', 'checking', 'updating_week', 'creating_practice',
    'preparing_feedback', 'waiting_detail', 'ready_review', 'finished', 'paused', 'failed'
  )),
  add column expected_output text check (expected_output is null or char_length(expected_output) <= 300),
  add column last_progress_at timestamptz,
  add column cancel_requested_at timestamptz,
  add column dismissed_at timestamptz;

alter table public.agent_tool_calls
  drop constraint agent_tool_calls_tool_name_check,
  add constraint agent_tool_calls_tool_name_check check (tool_name in (
    'read_capture', 'read_family_context', 'file_capture', 'create_reminder', 'ask_parent',
    'record_explicit_completion', 'move_unfinished_work',
    'update_subject_summary_draft', 'build_dashboard', 'draft_weekly_plan', 'create_lesson',
    'create_practice_activity', 'build_portfolio', 'update_records_draft'
  ));

alter table public.adjustment_proposals
  drop constraint adjustment_proposals_status_check,
  add constraint adjustment_proposals_status_check check (status in ('proposed', 'approved', 'rejected', 'applied', 'expired', 'undone', 'failed')),
  add column idempotency_key text,
  add column trigger_event jsonb not null default '{}'::jsonb,
  add column policy_decision jsonb not null default '{}'::jsonb,
  add column after_snapshot_version bigint check (after_snapshot_version is null or after_snapshot_version >= 0),
  add column undo_status text not null default 'not_available' check (undo_status in ('not_available', 'available', 'undone', 'stale', 'failed')),
  add column undo_expires_at timestamptz,
  add column undone_by uuid references auth.users(id) on delete set null,
  add column undone_at timestamptz;

create unique index adjustment_proposals_family_idempotency_idx
  on public.adjustment_proposals(family_id, idempotency_key) where idempotency_key is not null;

alter table public.adjustment_actions
  drop constraint adjustment_actions_action_type_check,
  add constraint adjustment_actions_action_type_check check (action_type in ('move', 'change_duration', 'add_practice', 'remove_practice', 'skip')),
  drop constraint adjustment_actions_status_check,
  add constraint adjustment_actions_status_check check (status in ('proposed', 'applied', 'undone', 'failed'));

create index proactive_evaluations_claim_idx on public.proactive_evaluations(status, queued_at)
  where status in ('queued', 'running');
create unique index proactive_evaluations_one_running_family_idx on public.proactive_evaluations(family_id)
  where status = 'running';
create index klio_insights_family_active_idx on public.klio_insights(family_id, status, priority desc, created_at desc);
create index assignment_reviews_trend_idx on public.assignment_reviews(family_id, student_id, skill_key, reviewed_at desc)
  where status = 'approved' and score is not null;

create trigger family_autonomy_policies_set_updated_at before update on public.family_autonomy_policies
for each row execute function private.set_updated_at();
create trigger proactive_evaluations_set_updated_at before update on public.proactive_evaluations
for each row execute function private.set_updated_at();
create trigger klio_insights_set_updated_at before update on public.klio_insights
for each row execute function private.set_updated_at();
create trigger family_autonomy_policies_bump_agent_context after insert or update or delete on public.family_autonomy_policies
for each row execute function private.bump_family_agent_context();

alter table public.family_autonomy_policies enable row level security;
alter table public.proactive_evaluations enable row level security;
alter table public.klio_insights enable row level security;

create policy "autonomy policy visible to family" on public.family_autonomy_policies for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "autonomy policy editable by family" on public.family_autonomy_policies for all to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)) and updated_by = (select auth.uid()));
create policy "evaluations visible to family" on public.proactive_evaluations for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "insights visible to family" on public.klio_insights for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "insights dismissible by family" on public.klio_insights for update to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)));

grant select, insert, update on public.family_autonomy_policies to authenticated;
grant select on public.proactive_evaluations, public.klio_insights to authenticated;
grant update(status, dismissed_by, dismissed_at) on public.klio_insights to authenticated;
grant all on public.family_autonomy_policies, public.proactive_evaluations, public.klio_insights to service_role;

comment on table public.proactive_evaluations is 'Idempotent family-scoped evaluations created only for meaningful homeschool events.';
comment on table public.klio_insights is 'Ranked parent-facing outcomes with evidence and action references; never raw model or provider events.';

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
          and student_id = proposal.student_id and scheduled_date is not distinct from (action.before_state->>'scheduledDate')::date
      ) then raise exception 'ADJUSTMENT_ACTION_STALE'; end if;
      update public.assignments set scheduled_date = next_date, version = version + 1 where id = action.assignment_id and family_id = proposal.family_id;
      update public.weekly_plan_items set scheduled_date = next_date, rescheduled_count = rescheduled_count + 1 where assignment_id = action.assignment_id and family_id = proposal.family_id;
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
      ) then raise exception 'UNDO_ACTION_STALE'; end if;
      update public.assignments set scheduled_date = (action.before_state->>'scheduledDate')::date, version = version + 1 where id = action.assignment_id and family_id = proposal.family_id;
      update public.weekly_plan_items set scheduled_date = (action.before_state->>'scheduledDate')::date, rescheduled_count = greatest(0, rescheduled_count - 1) where assignment_id = action.assignment_id and family_id = proposal.family_id;
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
