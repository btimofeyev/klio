create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.parent_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete cascade,
  timezone text not null default 'America/New_York',
  available_days jsonb not null default '[]'::jsonb,
  weekly_minutes integer check (weekly_minutes is null or weekly_minutes between 0 and 10080),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (family_id, user_id)
);

create or replace function private.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_edit_family(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = (select auth.uid())
      and fm.role in ('owner', 'editor')
  );
$$;

create or replace function private.is_family_owner(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = (select auth.uid())
      and fm.role = 'owner'
  );
$$;

revoke all on function private.is_family_member(uuid) from public;
revoke all on function private.can_edit_family(uuid) from public;
revoke all on function private.is_family_owner(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_family_member(uuid) to authenticated;
grant execute on function private.can_edit_family(uuid) to authenticated;
grant execute on function private.is_family_owner(uuid) to authenticated;

create table public.students (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  birth_year smallint check (birth_year is null or birth_year between 1990 and 2100),
  grade_band text check (grade_band is null or grade_band in ('pre-k', 'k-2', '3-5', '6-8', '9-12', 'other')),
  learning_preferences text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('photo', 'document', 'voice', 'note', 'grade', 'book', 'activity', 'csv_import', 'practice_result')),
  title text check (title is null or char_length(title) <= 200),
  raw_text text,
  storage_path text,
  mime_type text,
  file_size bigint check (file_size is null or file_size between 0 and 52428800),
  source_at timestamptz not null default timezone('utc', now()),
  processing_status text not null default 'received' check (processing_status in ('received', 'processing', 'ready', 'needs_review', 'failed')),
  extracted_text text,
  extraction jsonb,
  provenance jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (raw_text is not null or storage_path is not null)
);

create table public.evidence_students (
  evidence_id uuid not null references public.evidence_items(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (evidence_id, student_id)
);

create table public.skill_observations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  authored_by uuid references auth.users(id) on delete set null,
  author_type text not null check (author_type in ('agent', 'parent')),
  subject text not null check (char_length(subject) between 1 and 80),
  skill_key text not null check (char_length(skill_key) between 1 and 160),
  skill_label text not null check (char_length(skill_label) between 1 and 200),
  status text not null check (status in ('emerging', 'developing', 'secure', 'needs-review')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  rationale text not null,
  uncertainty_flags jsonb not null default '[]'::jsonb,
  approval_status text not null default 'draft' check (approval_status in ('draft', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.observation_evidence (
  observation_id uuid not null references public.skill_observations(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete cascade,
  primary key (observation_id, evidence_id)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  intent text not null check (intent in ('understand', 'update_records', 'next_step', 'weekly_plan', 'lesson', 'summary', 'practice', 'portfolio')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  model text,
  input_summary jsonb not null default '{}'::jsonb,
  tool_trace jsonb not null default '[]'::jsonb,
  output_summary jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.agent_run_evidence (
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete cascade,
  primary key (agent_run_id, evidence_id)
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  type text not null check (type in ('analysis', 'next_step', 'weekly_plan', 'lesson', 'summary', 'practice', 'portfolio')),
  title text not null check (char_length(title) between 1 and 200),
  summary text,
  content jsonb not null,
  rationale text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'archived')),
  version integer not null default 1 check (version > 0),
  supersedes_id uuid references public.artifacts(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.artifact_sources (
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete cascade,
  note text,
  primary key (artifact_id, evidence_id)
);

create table public.weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  scheduled_date date,
  position integer not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 1 and 480),
  subject text,
  skill_key text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  artifact_id uuid references public.artifacts(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  skill_observation_id uuid references public.skill_observations(id) on delete set null,
  spec jsonb not null,
  status text not null default 'ready' check (status in ('ready', 'in_progress', 'completed', 'expired')),
  launched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.practice_results (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  practice_session_id uuid not null references public.practice_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  answers jsonb not null,
  score numeric(5,2) not null check (score between 0 and 100),
  mastery_met boolean not null,
  evidence_id uuid references public.evidence_items(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  storage_path text not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'previewed', 'confirmed', 'failed')),
  mapping jsonb,
  validation_results jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  requested_by_run uuid references public.agent_runs(id) on delete set null,
  entity_type text not null check (entity_type in ('skill_observation', 'artifact')),
  entity_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users(id) on delete set null,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('parent', 'agent', 'system')),
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.subscriptions (
  family_id uuid primary key references public.families(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive' check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  price_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index family_members_user_id_idx on public.family_members(user_id);
create index students_family_id_idx on public.students(family_id);
create index evidence_items_family_created_idx on public.evidence_items(family_id, created_at desc);
create index evidence_students_student_idx on public.evidence_students(student_id);
create index skill_observations_student_idx on public.skill_observations(student_id, created_at desc);
create index agent_runs_family_created_idx on public.agent_runs(family_id, created_at desc);
create index artifacts_family_created_idx on public.artifacts(family_id, created_at desc);
create index weekly_plan_items_artifact_idx on public.weekly_plan_items(artifact_id, position);
create index audit_events_family_created_idx on public.audit_events(family_id, created_at desc);

create trigger parent_profiles_set_updated_at before update on public.parent_profiles for each row execute function private.set_updated_at();
create trigger families_set_updated_at before update on public.families for each row execute function private.set_updated_at();
create trigger students_set_updated_at before update on public.students for each row execute function private.set_updated_at();
create trigger evidence_items_set_updated_at before update on public.evidence_items for each row execute function private.set_updated_at();
create trigger skill_observations_set_updated_at before update on public.skill_observations for each row execute function private.set_updated_at();
create trigger artifacts_set_updated_at before update on public.artifacts for each row execute function private.set_updated_at();
create trigger weekly_plan_items_set_updated_at before update on public.weekly_plan_items for each row execute function private.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function private.set_updated_at();

alter table public.parent_profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.students enable row level security;
alter table public.evidence_items enable row level security;
alter table public.evidence_students enable row level security;
alter table public.skill_observations enable row level security;
alter table public.observation_evidence enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_evidence enable row level security;
alter table public.artifacts enable row level security;
alter table public.artifact_sources enable row level security;
alter table public.weekly_plan_items enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_results enable row level security;
alter table public.imports enable row level security;
alter table public.approval_requests enable row level security;
alter table public.audit_events enable row level security;
alter table public.subscriptions enable row level security;

create policy "profiles_select_own" on public.parent_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "profiles_insert_own" on public.parent_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "profiles_update_own" on public.parent_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "families_select_member" on public.families for select to authenticated using (created_by = (select auth.uid()) or (select private.is_family_member(id)));
create policy "families_insert_creator" on public.families for insert to authenticated with check (created_by = (select auth.uid()));
create policy "families_update_editor" on public.families for update to authenticated using ((select private.can_edit_family(id))) with check ((select private.can_edit_family(id)));
create policy "families_delete_owner" on public.families for delete to authenticated using (created_by = (select auth.uid()));

create policy "members_select_family" on public.family_members for select to authenticated using (user_id = (select auth.uid()) or (select private.is_family_member(family_id)));
create policy "members_insert_creator_or_owner" on public.family_members for insert to authenticated with check (
  (user_id = (select auth.uid()) and exists (select 1 from public.families f where f.id = family_id and f.created_by = (select auth.uid())))
  or (select private.is_family_owner(family_id))
);
create policy "members_update_owner" on public.family_members for update to authenticated using (
  (select private.is_family_owner(family_id))
) with check (
  (select private.is_family_owner(family_id))
);
create policy "members_delete_owner" on public.family_members for delete to authenticated using (
  (select private.is_family_owner(family_id))
);

create policy "students_select_member" on public.students for select to authenticated using ((select private.is_family_member(family_id)));
create policy "students_insert_editor" on public.students for insert to authenticated with check ((select private.can_edit_family(family_id)));
create policy "students_update_editor" on public.students for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "students_delete_editor" on public.students for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "evidence_select_member" on public.evidence_items for select to authenticated using ((select private.is_family_member(family_id)));
create policy "evidence_insert_editor" on public.evidence_items for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));

create policy "evidence_students_select_member" on public.evidence_students for select to authenticated using ((select private.is_family_member(family_id)));
create policy "evidence_students_insert_editor" on public.evidence_students for insert to authenticated with check ((select private.can_edit_family(family_id)));

create policy "observations_select_member" on public.skill_observations for select to authenticated using ((select private.is_family_member(family_id)));
create policy "observations_insert_parent" on public.skill_observations for insert to authenticated with check ((select private.can_edit_family(family_id)) and author_type = 'parent' and authored_by = (select auth.uid()));
create policy "observations_review_editor" on public.skill_observations for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

create policy "observation_evidence_select_member" on public.observation_evidence for select to authenticated using ((select private.is_family_member(family_id)));
create policy "observation_evidence_insert_editor" on public.observation_evidence for insert to authenticated with check ((select private.can_edit_family(family_id)));

create policy "agent_runs_select_member" on public.agent_runs for select to authenticated using ((select private.is_family_member(family_id)));
create policy "agent_runs_insert_editor" on public.agent_runs for insert to authenticated with check ((select private.can_edit_family(family_id)) and requested_by = (select auth.uid()));

create policy "agent_run_evidence_select_member" on public.agent_run_evidence for select to authenticated using ((select private.is_family_member(family_id)));
create policy "agent_run_evidence_insert_editor" on public.agent_run_evidence for insert to authenticated with check ((select private.can_edit_family(family_id)));

create policy "artifacts_select_member" on public.artifacts for select to authenticated using ((select private.is_family_member(family_id)));
create policy "artifacts_insert_editor" on public.artifacts for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "artifacts_update_editor" on public.artifacts for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

create policy "artifact_sources_select_member" on public.artifact_sources for select to authenticated using ((select private.is_family_member(family_id)));
create policy "artifact_sources_insert_editor" on public.artifact_sources for insert to authenticated with check ((select private.can_edit_family(family_id)));

create policy "plan_items_select_member" on public.weekly_plan_items for select to authenticated using ((select private.is_family_member(family_id)));
create policy "plan_items_insert_editor" on public.weekly_plan_items for insert to authenticated with check ((select private.can_edit_family(family_id)));
create policy "plan_items_update_editor" on public.weekly_plan_items for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "plan_items_delete_editor" on public.weekly_plan_items for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "practice_select_member" on public.practice_sessions for select to authenticated using ((select private.is_family_member(family_id)));
create policy "practice_insert_editor" on public.practice_sessions for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "practice_update_editor" on public.practice_sessions for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "results_select_member" on public.practice_results for select to authenticated using ((select private.is_family_member(family_id)));
create policy "results_insert_editor" on public.practice_results for insert to authenticated with check ((select private.can_edit_family(family_id)));

create policy "imports_select_member" on public.imports for select to authenticated using ((select private.is_family_member(family_id)));
create policy "imports_insert_editor" on public.imports for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "imports_update_editor" on public.imports for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

create policy "approvals_select_member" on public.approval_requests for select to authenticated using ((select private.is_family_member(family_id)));
create policy "approvals_update_editor" on public.approval_requests for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

create policy "audit_select_member" on public.audit_events for select to authenticated using ((select private.is_family_member(family_id)));
create policy "subscriptions_select_member" on public.subscriptions for select to authenticated using ((select private.is_family_member(family_id)));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.parent_profiles, public.families, public.family_members, public.students to authenticated;
grant select, insert on public.evidence_items, public.evidence_students to authenticated;
grant select, insert, update on public.skill_observations, public.observation_evidence to authenticated;
grant select, insert on public.agent_runs, public.agent_run_evidence to authenticated;
grant select, insert, update on public.artifacts, public.artifact_sources to authenticated;
grant select, insert, update, delete on public.weekly_plan_items to authenticated;
grant select, insert, update on public.practice_sessions, public.practice_results, public.imports, public.approval_requests to authenticated;
grant select on public.audit_events, public.subscriptions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-evidence',
  'family-evidence',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'text/csv']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "storage_select_family" on storage.objects for select to authenticated using (
  bucket_id = 'family-evidence'
  and (select private.is_family_member(((storage.foldername(name))[1])::uuid))
);
create policy "storage_insert_family" on storage.objects for insert to authenticated with check (
  bucket_id = 'family-evidence'
  and (select private.can_edit_family(((storage.foldername(name))[1])::uuid))
  and owner_id = (select auth.uid()::text)
);
create policy "storage_update_family" on storage.objects for update to authenticated using (
  bucket_id = 'family-evidence'
  and (select private.can_edit_family(((storage.foldername(name))[1])::uuid))
) with check (
  bucket_id = 'family-evidence'
  and (select private.can_edit_family(((storage.foldername(name))[1])::uuid))
);
create policy "storage_delete_family" on storage.objects for delete to authenticated using (
  bucket_id = 'family-evidence'
  and (select private.can_edit_family(((storage.foldername(name))[1])::uuid))
);
