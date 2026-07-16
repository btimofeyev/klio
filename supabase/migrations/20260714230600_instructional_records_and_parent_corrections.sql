-- Parent-configurable actual instructional days and durable negative examples.

create table public.instructional_day_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null,
  term_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  instructional_date date not null,
  status text not null check (status in ('held', 'partial', 'cancelled')),
  instructional_minutes integer check (instructional_minutes is null or instructional_minutes between 0 and 1440),
  note text check (note is null or char_length(note) <= 1000),
  source_evidence_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (family_id, student_id, instructional_date),
  unique (id, family_id),
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade,
  foreign key (term_id, family_id) references public.academic_terms(id, family_id) on delete cascade,
  foreign key (source_evidence_id, family_id) references public.evidence_items(id, family_id) on delete restrict,
  check (status <> 'held' or instructional_minutes is null or instructional_minutes > 0)
);

create index instructional_day_records_family_student_date_idx
  on public.instructional_day_records(family_id, student_id, instructional_date desc);

create table public.parent_agent_corrections (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid,
  domain text not null check (domain in ('grading', 'organization', 'planning', 'practice')),
  correction_kind text not null check (char_length(correction_kind) between 1 and 80),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_entity_id uuid not null,
  original_value jsonb not null default '{}'::jsonb check (octet_length(original_value::text) <= 10000),
  corrected_value jsonb not null default '{}'::jsonb check (octet_length(corrected_value::text) <= 10000),
  note text check (note is null or char_length(note) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade
);

create index parent_agent_corrections_family_student_created_idx
  on public.parent_agent_corrections(family_id, student_id, created_at desc);

create or replace function private.record_assignment_review_parent_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'approved'
     and old.draft_score is distinct from new.score and new.reviewed_by is not null then
    insert into public.parent_agent_corrections(
      family_id, student_id, domain, correction_kind, target_type, target_entity_id,
      original_value, corrected_value, note, created_by
    ) values (
      new.family_id, new.student_id, 'grading', 'parent_edited_score', 'assignment_review', new.id,
      jsonb_build_object('draft_score', old.draft_score, 'draft_feedback', left(coalesce(old.draft_feedback, ''), 1000)),
      jsonb_build_object('score', new.score, 'feedback', left(coalesce(new.feedback, ''), 1000)),
      'Parent edited a Klio grading draft before approval.', new.reviewed_by
    );
  elsif old.status = 'draft' and new.status = 'rejected' and new.reviewed_by is not null then
    insert into public.parent_agent_corrections(
      family_id, student_id, domain, correction_kind, target_type, target_entity_id,
      original_value, corrected_value, note, created_by
    ) values (
      new.family_id, new.student_id, 'grading', 'parent_rejected_draft', 'assignment_review', new.id,
      jsonb_build_object('draft_score', old.draft_score, 'draft_feedback', left(coalesce(old.draft_feedback, ''), 1000), 'mastery_signals', old.mastery_signals),
      jsonb_build_object('status', 'rejected'),
      coalesce(new.return_reason, 'Parent rejected the grading draft.'), new.reviewed_by
    );
  end if;
  return new;
end;
$$;

create trigger assignment_reviews_record_parent_correction
after update on public.assignment_reviews
for each row execute function private.record_assignment_review_parent_correction();

create trigger instructional_day_records_set_updated_at before update on public.instructional_day_records
for each row execute function private.set_updated_at();
create trigger instructional_day_records_bump_agent_context after insert or update or delete on public.instructional_day_records
for each row execute function private.bump_family_agent_context();
create trigger parent_agent_corrections_bump_agent_context after insert on public.parent_agent_corrections
for each row execute function private.bump_family_agent_context();

alter table public.instructional_day_records enable row level security;
alter table public.parent_agent_corrections enable row level security;

create policy "instructional records visible to family" on public.instructional_day_records
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "instructional records created by editors" on public.instructional_day_records
for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "instructional records updated by editors" on public.instructional_day_records
for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "instructional records deleted by editors" on public.instructional_day_records
for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "parent corrections visible to family" on public.parent_agent_corrections
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "parent corrections appended by editors" on public.parent_agent_corrections
for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));

grant select, insert, update, delete on public.instructional_day_records to authenticated;
grant select, insert on public.parent_agent_corrections to authenticated;
grant select, insert, update, delete on public.instructional_day_records, public.parent_agent_corrections to service_role;

comment on table public.instructional_day_records is 'Optional parent-recorded instructional days and minutes; not a legal attendance determination.';
comment on table public.parent_agent_corrections is 'Append-only parent corrections used as negative examples for later Klio recommendations.';
