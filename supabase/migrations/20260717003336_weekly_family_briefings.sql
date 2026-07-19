-- One durable, family-scoped weekly briefing plus a database-native enqueue
-- clock. The cron job only creates proactive evaluation work; application
-- workers retain retries, leases, and briefing generation.

create extension if not exists pg_cron;

create table public.weekly_briefings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  evaluation_id uuid not null,
  week_start date not null,
  status text not null default 'active' check (status in ('active', 'dismissed')),
  headline text not null check (char_length(headline) between 1 and 160),
  summary text not null check (char_length(summary) between 1 and 1200),
  sections jsonb not null default '{}'::jsonb check (jsonb_typeof(sections) = 'object'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  action_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(action_refs) = 'array'),
  generated_at timestamptz not null default timezone('utc', now()),
  viewed_at timestamptz,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (family_id, week_start),
  unique (id, family_id),
  foreign key (evaluation_id, family_id)
    references public.proactive_evaluations(id, family_id) on delete cascade,
  check (
    (status = 'active' and dismissed_at is null and dismissed_by is null)
    or (status = 'dismissed' and dismissed_at is not null and dismissed_by is not null)
  )
);

create index weekly_briefings_family_history_idx
  on public.weekly_briefings(family_id, week_start desc, generated_at desc);

create trigger weekly_briefings_set_updated_at before update on public.weekly_briefings
for each row execute function private.set_updated_at();

alter table public.weekly_briefings enable row level security;

create policy "weekly briefings visible to family" on public.weekly_briefings
for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "weekly briefings state editable by family editors" on public.weekly_briefings
for update to authenticated
using ((select private.can_edit_family(family_id)))
with check (
  (select private.can_edit_family(family_id))
  and (dismissed_by is null or dismissed_by = (select auth.uid()))
);

revoke all on table public.weekly_briefings from anon, authenticated;
grant select on table public.weekly_briefings to authenticated;
grant update(status, viewed_at, dismissed_at, dismissed_by) on table public.weekly_briefings to authenticated;
grant all on table public.weekly_briefings to service_role;

comment on table public.weekly_briefings is
  'Deterministic evidence-backed weekly family briefing; generated content is server-owned and retained after dismissal.';

create table private.weekly_briefing_sweeps (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default timezone('utc', now()),
  due_family_count integer not null check (due_family_count >= 0),
  enqueued_count integer not null check (enqueued_count >= 0)
);

revoke all on table private.weekly_briefing_sweeps from public, anon, authenticated;

create or replace function private.enqueue_due_weekly_family_briefings(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_count integer := 0;
  inserted_count integer := 0;
begin
  with local_families as materialized (
    select
      family.id,
      family.timezone,
      p_now at time zone family.timezone as local_now
    from public.families family
    join pg_catalog.pg_timezone_names timezone_name on timezone_name.name = family.timezone
  ), due_families as materialized (
    select
      id,
      date_trunc('week', local_now)::date as week_start
    from local_families
    where local_now >= date_trunc('week', local_now) + interval '5 hours'
  ), inserted as (
    insert into public.proactive_evaluations (
      family_id, student_id, requested_by, event_kind, entity_type, entity_id,
      idempotency_key, result
    )
    select
      due.id, null, null, 'weekly_boundary', 'family', due.id,
      'weekly-briefing:' || due.week_start::text,
      jsonb_build_object('briefingWeekStart', due.week_start::text, 'scheduler', 'supabase_cron')
    from due_families due
    on conflict (family_id, idempotency_key) do nothing
    returning 1
  )
  select
    (select count(*)::integer from due_families),
    (select count(*)::integer from inserted)
  into due_count, inserted_count;

  insert into private.weekly_briefing_sweeps(due_family_count, enqueued_count)
  values (due_count, inserted_count);

  return inserted_count;
end;
$$;

revoke all on function private.enqueue_due_weekly_family_briefings(timestamptz) from public, anon, authenticated;
grant execute on function private.enqueue_due_weekly_family_briefings(timestamptz) to service_role;

select cron.schedule(
  'weekly-family-briefing-enqueue',
  '*/15 * * * *',
  'select private.enqueue_due_weekly_family_briefings();'
);
