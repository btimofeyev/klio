-- Explicit grading finality, parent-reviewable planning proposals, clarification
-- lifecycle, and a shared family execution lease for bounded worker concurrency.

alter table public.assignment_reviews
  add column score_origin text not null default 'agent_inferred'
    check (score_origin in ('agent_inferred', 'explicit_parent', 'imported_explicit')),
  add column grading_state text not null default 'provisional'
    check (grading_state in ('provisional', 'final')),
  add column written_review_required boolean not null default false,
  add column written_review_completed boolean not null default false,
  add column evidence_strength text not null default 'curriculum'
    check (evidence_strength in ('curriculum', 'supplemental', 'parent_report')),
  add column comparable_key text check (comparable_key is null or char_length(comparable_key) <= 200),
  add column returned_at timestamptz,
  add column return_reason text check (return_reason is null or char_length(return_reason) <= 2000);

update public.assignment_reviews
set grading_state = case when status = 'approved' then 'final' else 'provisional' end,
    written_review_completed = status = 'approved',
    comparable_key = skill_key
where true;

alter table public.assignment_reviews
  add constraint assignment_reviews_final_requires_approval check (
    grading_state <> 'final'
    or (status = 'approved' and (not written_review_required or written_review_completed))
  );

alter table public.practice_results
  add column auto_score numeric(5,2) check (auto_score is null or auto_score between 0 and 100),
  add column final_score numeric(5,2) check (final_score is null or final_score between 0 and 100),
  add column scoring_state text not null default 'final' check (scoring_state in ('provisional', 'final')),
  add column written_review_required boolean not null default false,
  add column written_review_completed boolean not null default false,
  add column finalized_by uuid references auth.users(id) on delete set null,
  add column finalized_at timestamptz,
  add column evidence_strength text not null default 'supplemental' check (evidence_strength in ('curriculum', 'supplemental')),
  add column comparable_key text check (comparable_key is null or char_length(comparable_key) <= 200);

update public.practice_results
set auto_score = score,
    final_score = score,
    written_review_completed = true,
    finalized_at = created_at
where true;

alter table public.practice_results
  add constraint practice_results_final_reviewed_check check (
    scoring_state <> 'final'
    or (final_score is not null and (not written_review_required or written_review_completed))
  ),
  add constraint practice_results_mastery_final_check check (
    not mastery_met or (scoring_state = 'final' and written_review_completed)
  );

create table public.planning_proposals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid,
  agent_turn_id uuid,
  proposal_kind text not null check (proposal_kind in ('learner_goal', 'curriculum', 'curriculum_cadence', 'assignment', 'schedule_block', 'schedule_resize', 'weekly_plan', 'term_plan', 'grade')),
  action_name text not null check (action_name in ('create_goal', 'update_goal', 'create_curriculum', 'change_curriculum_cadence', 'create_assignment', 'create_schedule_block', 'resize_schedule_work', 'prepare_week', 'prepare_term', 'record_inferred_grade')),
  risk text not null check (risk in ('low', 'moderate', 'high')),
  title text not null check (char_length(title) between 1 and 200),
  summary text not null check (char_length(summary) between 1 and 1200),
  reason text not null check (char_length(reason) between 1 and 2000),
  proposed_changes jsonb not null check (jsonb_typeof(proposed_changes) = 'object' and octet_length(proposed_changes::text) <= 20000),
  target_goal_id uuid,
  target_curriculum_unit_id uuid,
  target_assignment_id uuid,
  snapshot_version bigint not null check (snapshot_version >= 0),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'applied', 'expired', 'cancelled')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  unique (family_id, idempotency_key),
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade,
  foreign key (agent_turn_id, family_id) references public.agent_turns(id, family_id) on delete set null,
  foreign key (target_goal_id, family_id) references public.learning_goals(id, family_id) on delete cascade,
  foreign key (target_curriculum_unit_id, family_id) references public.curriculum_units(id, family_id) on delete cascade,
  foreign key (target_assignment_id, family_id) references public.assignments(id, family_id) on delete cascade
);

create index planning_proposals_family_status_idx
  on public.planning_proposals(family_id, status, created_at desc);
create trigger planning_proposals_set_updated_at before update on public.planning_proposals
for each row execute function private.set_updated_at();
create trigger planning_proposals_bump_agent_context after insert or update or delete on public.planning_proposals
for each row execute function private.bump_family_agent_context();

alter table public.planning_proposals enable row level security;
create policy "planning proposals visible to family" on public.planning_proposals
for select to authenticated using ((select private.is_family_member(family_id)));
grant select on public.planning_proposals to authenticated;
grant select, insert, update, delete on public.planning_proposals to service_role;

alter table public.question_threads
  add column status text not null default 'open' check (status in ('open', 'answered', 'cancelled')),
  add column awaiting_turn_id uuid,
  add column resumed_by_turn_id uuid,
  add column answered_by uuid references auth.users(id) on delete set null,
  add column answered_at timestamptz,
  add column cancelled_by uuid references auth.users(id) on delete set null,
  add column cancelled_at timestamptz,
  add constraint question_threads_id_family_unique unique (id, family_id),
  add constraint question_threads_awaiting_turn_family_fkey foreign key (awaiting_turn_id, family_id) references public.agent_turns(id, family_id) on delete set null,
  add constraint question_threads_resumed_turn_family_fkey foreign key (resumed_by_turn_id, family_id) references public.agent_turns(id, family_id) on delete set null;

alter table public.question_messages
  add column reply_to_message_id uuid,
  add column idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  add constraint question_messages_id_family_unique unique (id, family_id),
  add constraint question_messages_thread_family_fkey foreign key (thread_id, family_id) references public.question_threads(id, family_id) on delete cascade,
  add constraint question_messages_reply_family_fkey foreign key (reply_to_message_id, family_id) references public.question_messages(id, family_id) on delete restrict;

create unique index question_messages_family_idempotency_idx
  on public.question_messages(family_id, idempotency_key) where idempotency_key is not null;
create unique index question_messages_one_parent_reply_idx
  on public.question_messages(thread_id, reply_to_message_id)
  where role = 'user' and reply_to_message_id is not null;
create index question_threads_waiting_turn_idx
  on public.question_threads(family_id, awaiting_turn_id) where status = 'open';
create trigger question_threads_bump_agent_context after insert or update or delete on public.question_threads
for each row execute function private.bump_family_agent_context();
create trigger question_messages_bump_agent_context after insert or update or delete on public.question_messages
for each row execute function private.bump_family_agent_context();

create table public.family_execution_leases (
  family_id uuid primary key references public.families(id) on delete cascade,
  owner_token uuid not null,
  work_kind text not null check (work_kind in ('workspace_turn', 'proactive_evaluation')),
  work_id uuid not null,
  acquired_at timestamptz not null default timezone('utc', now()),
  heartbeat_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

alter table public.family_execution_leases enable row level security;
grant select, insert, update, delete on public.family_execution_leases to service_role;

create or replace function public.acquire_family_execution_lease(
  p_family_id uuid,
  p_owner_token uuid,
  p_work_kind text,
  p_work_id uuid,
  p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  if p_work_kind not in ('workspace_turn', 'proactive_evaluation') then raise exception 'INVALID_WORK_KIND'; end if;
  if p_ttl_seconds not between 30 and 300 then raise exception 'INVALID_LEASE_TTL'; end if;
  insert into public.family_execution_leases(family_id, owner_token, work_kind, work_id, expires_at)
  values (p_family_id, p_owner_token, p_work_kind, p_work_id, now() + make_interval(secs => p_ttl_seconds))
  on conflict (family_id) do update
    set owner_token = excluded.owner_token,
        work_kind = excluded.work_kind,
        work_id = excluded.work_id,
        acquired_at = now(),
        heartbeat_at = now(),
        expires_at = excluded.expires_at
    where public.family_execution_leases.expires_at < now()
       or (public.family_execution_leases.owner_token = p_owner_token and public.family_execution_leases.work_id = p_work_id)
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.heartbeat_family_execution_lease(p_family_id uuid, p_owner_token uuid, p_ttl_seconds integer default 120)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.family_execution_leases
    set heartbeat_at = now(), expires_at = now() + make_interval(secs => p_ttl_seconds)
    where family_id = p_family_id and owner_token = p_owner_token and expires_at >= now()
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.release_family_execution_lease(p_family_id uuid, p_owner_token uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.family_execution_leases where family_id = p_family_id and owner_token = p_owner_token returning 1
  ) select exists(select 1 from deleted);
$$;

revoke all on function public.acquire_family_execution_lease(uuid, uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_family_execution_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_family_execution_lease(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_family_execution_lease(uuid, uuid, text, uuid, integer) to service_role;
grant execute on function public.heartbeat_family_execution_lease(uuid, uuid, integer) to service_role;
grant execute on function public.release_family_execution_lease(uuid, uuid) to service_role;

alter table public.agent_tool_calls drop constraint agent_tool_calls_tool_name_check;
alter table public.agent_tool_calls add constraint agent_tool_calls_tool_name_check check (tool_name in (
  'read_capture', 'read_family_context', 'read_goals_and_pacing', 'read_review_queue',
  'read_assignment_review_context', 'read_relevant_history', 'file_capture', 'create_reminder',
  'ask_parent', 'record_explicit_completion', 'record_explicit_parent_score', 'update_assignment_status',
  'move_unfinished_work', 'create_assignment', 'create_schedule_block', 'move_schedule_work',
  'resize_schedule_work', 'propose_learner_goal', 'propose_curriculum_change',
  'draft_assignment_review', 'return_work_with_draft_feedback', 'create_targeted_lesson',
  'create_supplemental_practice', 'remove_supplemental_practice', 'prepare_planning_changes',
  'present_action_card', 'update_subject_summary_draft', 'build_dashboard', 'draft_weekly_plan',
  'create_lesson', 'create_practice_activity', 'build_portfolio', 'update_records_draft'
));

alter table public.agent_events drop constraint agent_events_kind_check;
alter table public.agent_events add constraint agent_events_kind_check check (kind in (
  'turn.queued', 'turn.started', 'agent.progress', 'tool.requested', 'tool.completed',
  'clarification.requested', 'clarification.answered', 'clarification.cancelled', 'turn.resumed',
  'turn.completed', 'turn.failed'
));

comment on table public.planning_proposals is 'Snapshot-bound, domain-specific parent review for goals, curriculum, schedule, and inferred grades.';
comment on table public.family_execution_leases is 'Shared per-family mutation lease across workspace and proactive workers.';
