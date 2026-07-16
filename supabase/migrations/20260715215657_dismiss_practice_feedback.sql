-- A parent can retire supplemental practice without recording a false result.
-- The reason becomes durable corrective context for later practice generation.

alter table public.practice_sessions
  drop constraint practice_sessions_status_check,
  add constraint practice_sessions_status_check
    check (status in ('ready', 'in_progress', 'completed', 'expired', 'dismissed')),
  add column dismissed_at timestamptz,
  add column dismissed_by uuid references auth.users(id) on delete set null,
  add column dismissal_reason text
    check (dismissal_reason is null or dismissal_reason in (
      'learned_in_curriculum', 'already_understands', 'not_right_fit'
    )),
  add constraint practice_sessions_dismissal_state_check check (
    (status = 'dismissed' and dismissed_at is not null and dismissed_by is not null and dismissal_reason is not null)
    or
    (status <> 'dismissed' and dismissed_at is null and dismissed_by is null and dismissal_reason is null)
  );

create or replace function private.record_dismissed_practice_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason_label text;
begin
  reason_label := case new.dismissal_reason
    when 'learned_in_curriculum' then 'The learner covered this skill successfully in regular curriculum work.'
    when 'already_understands' then 'The parent confirmed that the learner already understands this skill.'
    else 'The parent said this supplemental practice was not the right fit.'
  end;

  insert into public.parent_agent_corrections (
    family_id, student_id, domain, correction_kind, target_type, target_entity_id,
    original_value, corrected_value, note, created_by
  ) values (
    new.family_id, new.student_id, 'practice', 'practice_no_longer_needed', 'practice_session', new.id,
    jsonb_build_object('status', old.status, 'artifact_id', new.artifact_id, 'spec', new.spec),
    jsonb_build_object('status', 'dismissed', 'reason', new.dismissal_reason),
    reason_label, new.dismissed_by
  );

  update public.klio_insights
  set status = 'superseded', dismissed_at = new.dismissed_at, dismissed_by = new.dismissed_by
  where family_id = new.family_id
    and status = 'active'
    and (
      action_ref ->> 'practiceSessionId' = new.id::text
      or (new.artifact_id is not null and action_ref ->> 'artifactId' = new.artifact_id::text)
    );

  insert into public.audit_events (
    family_id, actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    new.family_id, new.dismissed_by, 'parent', 'practice.dismissed', 'practice_session', new.id,
    jsonb_build_object('artifact_id', new.artifact_id, 'reason', new.dismissal_reason)
  );

  insert into public.proactive_evaluations (
    family_id, student_id, requested_by, event_kind, entity_type, entity_id, idempotency_key
  ) values (
    new.family_id, new.student_id, new.dismissed_by, 'parent_correction', 'practice_session', new.id,
    'practice-dismissed:' || new.id::text
  ) on conflict (family_id, idempotency_key) do nothing;

  return new;
end;
$$;

create trigger practice_sessions_record_dismissal
after update of status on public.practice_sessions
for each row
when (new.status = 'dismissed' and old.status is distinct from new.status)
execute function private.record_dismissed_practice_feedback();

comment on column public.practice_sessions.dismissal_reason is
  'Why a parent retired supplemental practice without recording a learner result; used as bounded corrective context.';
