create table private.voice_transcription_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_kind text not null check (bucket_kind in ('ten_minute', 'day')),
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  audio_seconds integer not null default 0 check (audio_seconds >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, bucket_kind, bucket_start)
);

create table private.voice_transcription_leases (
  lease_token uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  slot smallint not null unique check (slot between 1 and 4),
  audio_seconds integer not null check (audio_seconds between 1 and 120),
  acquired_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

alter table private.voice_transcription_usage enable row level security;
alter table private.voice_transcription_leases enable row level security;

revoke all on table private.voice_transcription_usage from public, anon, authenticated;
revoke all on table private.voice_transcription_leases from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on table private.voice_transcription_usage to service_role;
grant select, insert, update, delete on table private.voice_transcription_leases to service_role;

create or replace function public.claim_voice_transcription(
  p_user_id uuid,
  p_lease_token uuid,
  p_audio_seconds integer,
  p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_ten_minute_start timestamptz;
  v_day_start timestamptz;
  v_requests integer;
  v_day_seconds integer;
  v_slot smallint;
  v_retry_after integer;
begin
  if p_audio_seconds not between 1 and 120 then
    raise exception 'INVALID_AUDIO_DURATION';
  end if;
  if p_lease_seconds not between 30 and 120 then
    raise exception 'INVALID_LEASE_TTL';
  end if;

  -- Serialize the short claim transaction across instances. The external
  -- transcription call happens after this function commits, never while a
  -- database lock is held.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-transcription:global', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-transcription:user:' || p_user_id::text, 0));

  delete from private.voice_transcription_leases where expires_at <= v_now;
  delete from private.voice_transcription_usage
  where user_id = p_user_id and bucket_start < v_now - interval '35 days';

  select greatest(1, ceil(extract(epoch from (expires_at - v_now)))::integer)
  into v_retry_after
  from private.voice_transcription_leases
  where user_id = p_user_id;
  if found then
    return jsonb_build_object('allowed', false, 'reason', 'concurrent', 'retryAfter', v_retry_after);
  end if;

  select candidate.slot::smallint
  into v_slot
  from generate_series(1, 4) as candidate(slot)
  where not exists (
    select 1 from private.voice_transcription_leases lease where lease.slot = candidate.slot
  )
  order by candidate.slot
  limit 1;
  if v_slot is null then
    select greatest(1, ceil(extract(epoch from (min(expires_at) - v_now)))::integer)
    into v_retry_after
    from private.voice_transcription_leases;
    return jsonb_build_object('allowed', false, 'reason', 'capacity', 'retryAfter', coalesce(v_retry_after, 5));
  end if;

  v_ten_minute_start := date_bin(interval '10 minutes', v_now, timestamptz '2000-01-01 00:00:00+00');
  v_day_start := (date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC');

  insert into private.voice_transcription_usage(user_id, bucket_kind, bucket_start)
  values
    (p_user_id, 'ten_minute', v_ten_minute_start),
    (p_user_id, 'day', v_day_start)
  on conflict do nothing;

  select request_count into v_requests
  from private.voice_transcription_usage
  where user_id = p_user_id and bucket_kind = 'ten_minute' and bucket_start = v_ten_minute_start;
  if v_requests >= 5 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_ten_minute_start + interval '10 minutes' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'rate_limit', 'retryAfter', v_retry_after);
  end if;

  select audio_seconds into v_day_seconds
  from private.voice_transcription_usage
  where user_id = p_user_id and bucket_kind = 'day' and bucket_start = v_day_start;
  if v_day_seconds + p_audio_seconds > 1200 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_day_start + interval '1 day' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'retryAfter', v_retry_after);
  end if;

  update private.voice_transcription_usage
  set request_count = request_count + 1,
      audio_seconds = audio_seconds + p_audio_seconds,
      updated_at = v_now
  where user_id = p_user_id
    and ((bucket_kind = 'ten_minute' and bucket_start = v_ten_minute_start)
      or (bucket_kind = 'day' and bucket_start = v_day_start));

  insert into private.voice_transcription_leases(lease_token, user_id, slot, audio_seconds, acquired_at, expires_at)
  values (p_lease_token, p_user_id, v_slot, p_audio_seconds, v_now, v_now + make_interval(secs => p_lease_seconds));

  return jsonb_build_object('allowed', true, 'leaseToken', p_lease_token, 'retryAfter', 0);
end;
$$;

create or replace function public.release_voice_transcription(
  p_user_id uuid,
  p_lease_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with deleted as (
    delete from private.voice_transcription_leases
    where user_id = p_user_id and lease_token = p_lease_token
    returning 1
  )
  select exists(select 1 from deleted);
$$;

revoke all on function public.claim_voice_transcription(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.release_voice_transcription(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_voice_transcription(uuid, uuid, integer, integer) to service_role;
grant execute on function public.release_voice_transcription(uuid, uuid) to service_role;

comment on table private.voice_transcription_usage is 'Durable per-parent request and decoded-audio budgets for voice dictation.';
comment on table private.voice_transcription_leases is 'Distributed per-parent and four-slot global concurrency guard for voice transcription.';
