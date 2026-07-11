create extension if not exists pg_trgm with schema extensions;

alter table public.evidence_items
  drop constraint evidence_items_processing_status_check;
alter table public.evidence_items
  add constraint evidence_items_processing_status_check
  check (processing_status in ('received', 'queued', 'processing', 'ready', 'needs_review', 'failed'));

alter table public.agent_runs
  drop constraint agent_runs_intent_check;
alter table public.agent_runs
  add constraint agent_runs_intent_check
  check (intent in ('organize', 'understand', 'update_records', 'next_step', 'weekly_plan', 'lesson', 'summary', 'practice', 'portfolio'));

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'partial', 'failed')),
  total_actions smallint not null check (total_actions between 1 and 20),
  completed_actions smallint not null default 0 check (completed_actions >= 0),
  failed_actions smallint not null default 0 check (failed_actions >= 0),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_actions + failed_actions <= total_actions)
);

create table public.agent_job_actions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  intent text not null check (intent in ('organize', 'understand', 'update_records', 'next_step', 'weekly_plan', 'lesson', 'summary', 'practice', 'portfolio')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  artifact_id uuid references public.artifacts(id) on delete set null,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, intent)
);

create table public.agent_job_evidence (
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete cascade,
  primary key (job_id, evidence_id)
);

alter table public.agent_runs
  add column job_action_id uuid unique references public.agent_job_actions(id) on delete set null;

create table public.organization_corrections (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  evidence_id uuid references public.evidence_items(id) on delete set null,
  from_category_name text,
  to_category_id uuid not null references public.categories(id) on delete cascade,
  evidence_title text,
  evidence_excerpt text,
  cues text[] not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index agent_jobs_family_created_idx on public.agent_jobs(family_id, created_at desc);
create index agent_jobs_recovery_idx on public.agent_jobs(status, last_heartbeat_at, created_at)
  where status in ('queued', 'processing');
create index agent_job_actions_job_status_idx on public.agent_job_actions(job_id, status);
create index agent_job_evidence_evidence_idx on public.agent_job_evidence(evidence_id);
create index organization_corrections_family_created_idx on public.organization_corrections(family_id, created_at desc);
create index organization_corrections_cues_idx on public.organization_corrections using gin(cues);
create index evidence_items_search_trgm_idx on public.evidence_items using gin (
  (lower(coalesce(title, '') || ' ' || coalesce(raw_text, '') || ' ' || coalesce(extracted_text, ''))) extensions.gin_trgm_ops
);
create index evidence_categories_tags_idx on public.evidence_categories using gin(tags);
create index skill_observations_search_trgm_idx on public.skill_observations using gin (
  (lower(subject || ' ' || skill_label || ' ' || rationale)) extensions.gin_trgm_ops
);
create index artifacts_search_trgm_idx on public.artifacts using gin (
  (lower(title || ' ' || coalesce(summary, '') || ' ' || coalesce(rationale, ''))) extensions.gin_trgm_ops
);

with ranked as (
  select id, row_number() over (
    partition by family_id, student_id, lower(skill_key)
    order by updated_at desc, created_at desc, id desc
  ) as row_number
  from public.skill_observations
  where approval_status = 'draft'
), superseded as (
  update public.skill_observations
  set approval_status = 'superseded', updated_at = now()
  where id in (select id from ranked where row_number > 1)
  returning id
)
update public.approval_requests
set status = 'cancelled', decided_at = now(), decision_note = 'Superseded by a newer draft'
where entity_type = 'skill_observation'
  and entity_id in (select id from superseded)
  and status = 'pending';

create unique index skill_observations_one_draft_per_skill_idx
  on public.skill_observations(family_id, student_id, lower(skill_key))
  where approval_status = 'draft';

create trigger agent_jobs_set_updated_at before update on public.agent_jobs
for each row execute function private.set_updated_at();
create trigger agent_job_actions_set_updated_at before update on public.agent_job_actions
for each row execute function private.set_updated_at();

alter table public.agent_jobs enable row level security;
alter table public.agent_job_actions enable row level security;
alter table public.agent_job_evidence enable row level security;
alter table public.organization_corrections enable row level security;

create policy "agent jobs are visible to family members"
on public.agent_jobs for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "agent job actions are visible to family members"
on public.agent_job_actions for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "agent job evidence is visible to family members"
on public.agent_job_evidence for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "organization corrections are visible to family members"
on public.organization_corrections for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "family editors can record organization corrections"
on public.organization_corrections for insert to authenticated
with check (
  (select private.can_edit_family(family_id))
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.categories c
    where c.id = to_category_id and c.family_id = family_id
  )
);

create policy "family editors can delete organization corrections"
on public.organization_corrections for delete to authenticated
using ((select private.can_edit_family(family_id)));

grant select on public.agent_jobs, public.agent_job_actions, public.agent_job_evidence to authenticated;
grant select, insert, delete on public.organization_corrections to authenticated;
