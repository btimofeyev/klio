alter table public.curriculum_units
  add column target_lesson_count integer not null default 100
    constraint curriculum_units_target_lesson_count_check check (target_lesson_count between 1 and 500),
  add column publisher text constraint curriculum_units_publisher_length check (publisher is null or char_length(publisher) <= 120),
  add column product_name text constraint curriculum_units_product_name_length check (product_name is null or char_length(product_name) <= 200),
  add column grade_label text constraint curriculum_units_grade_label_length check (grade_label is null or char_length(grade_label) <= 80),
  add column edition_label text constraint curriculum_units_edition_label_length check (edition_label is null or char_length(edition_label) <= 120),
  add column isbn text constraint curriculum_units_isbn_length check (isbn is null or char_length(isbn) <= 20),
  add column identity_status text not null default 'generic'
    constraint curriculum_units_identity_status_check check (identity_status in ('generic', 'recognized', 'verified')),
  add column scope_source_kind text not null default 'generic'
    constraint curriculum_units_scope_source_kind_check check (scope_source_kind in ('generic', 'model_prior', 'web_search', 'parent_evidence', 'curated_catalog')),
  add column scope_confidence numeric(4,3)
    constraint curriculum_units_scope_confidence_check check (scope_confidence is null or scope_confidence between 0 and 1),
  add column scope_verified_at timestamptz;

alter table public.assignments
  add column curriculum_item_kind text
    constraint assignments_curriculum_item_kind_check check (curriculum_item_kind is null or curriculum_item_kind in ('lesson', 'assessment', 'review', 'project', 'activity')),
  add column curriculum_item_state text
    constraint assignments_curriculum_item_state_check check (curriculum_item_state is null or curriculum_item_state in ('placeholder', 'enriched')),
  add column curriculum_path jsonb
    constraint assignments_curriculum_path_check check (curriculum_path is null or (jsonb_typeof(curriculum_path) = 'array' and jsonb_array_length(curriculum_path) <= 8));

create table public.assignment_materials (
  assignment_id uuid not null,
  evidence_id uuid not null,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary', 'supporting')),
  position integer not null default 0 check (position between 0 and 1000),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (assignment_id, evidence_id),
  foreign key (assignment_id, family_id) references public.assignments(id, family_id) on delete cascade,
  foreign key (evidence_id, family_id) references public.evidence_items(id, family_id) on delete restrict
);

create table public.curriculum_material_suggestions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  assignment_id uuid not null,
  evidence_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'applied', 'dismissed', 'failed')),
  model text check (model is null or char_length(model) <= 120),
  proposed_title text check (proposed_title is null or char_length(proposed_title) between 1 and 200),
  proposed_kind text check (proposed_kind is null or proposed_kind in ('lesson', 'assessment', 'review', 'project', 'activity')),
  proposed_instructions text check (proposed_instructions is null or char_length(proposed_instructions) <= 2000),
  proposed_minutes integer check (proposed_minutes is null or proposed_minutes between 5 and 480),
  proposed_path jsonb check (proposed_path is null or (jsonb_typeof(proposed_path) = 'array' and jsonb_array_length(proposed_path) <= 8 and pg_column_size(proposed_path) <= 4096)),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  rationale text check (rationale is null or char_length(rationale) <= 1000),
  uncertainty_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(uncertainty_flags) = 'array' and jsonb_array_length(uncertainty_flags) <= 20 and pg_column_size(uncertainty_flags) <= 8192),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot) = 'object' and pg_column_size(before_snapshot) <= 16384),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  unique (id, family_id),
  foreign key (assignment_id, family_id) references public.assignments(id, family_id) on delete cascade,
  foreign key (evidence_id, family_id) references public.evidence_items(id, family_id) on delete restrict
);

create unique index curriculum_material_suggestions_one_open_idx
  on public.curriculum_material_suggestions(assignment_id, evidence_id)
  where status in ('queued', 'processing', 'ready');

create table public.curriculum_scope_suggestions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  curriculum_unit_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'applied', 'dismissed', 'failed', 'superseded')),
  publisher text check (publisher is null or char_length(publisher) <= 120),
  product_name text check (product_name is null or char_length(product_name) <= 200),
  grade_label text check (grade_label is null or char_length(grade_label) <= 80),
  edition_label text check (edition_label is null or char_length(edition_label) <= 120),
  isbn text check (isbn is null or char_length(isbn) <= 20),
  identity_status text not null default 'generic' check (identity_status in ('generic', 'recognized', 'verified')),
  source_kind text not null check (source_kind in ('model_prior', 'web_search', 'parent_evidence', 'curated_catalog')),
  source_fingerprint text not null check (char_length(source_fingerprint) between 16 and 200),
  source_evidence_ids uuid[] not null default '{}'::uuid[] check (cardinality(source_evidence_ids) <= 20),
  source_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(source_urls) = 'array' and jsonb_array_length(source_urls) <= 20 and pg_column_size(source_urls) <= 32768),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  assumptions jsonb not null default '[]'::jsonb check (jsonb_typeof(assumptions) = 'array' and jsonb_array_length(assumptions) <= 20 and pg_column_size(assumptions) <= 16384),
  proposed_target_count integer check (proposed_target_count is null or proposed_target_count between 1 and 500),
  proposed_items jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed_items) = 'array' and jsonb_array_length(proposed_items) <= 500 and pg_column_size(proposed_items) <= 1048576),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot) = 'object' and pg_column_size(before_snapshot) <= 32768),
  model text check (model is null or char_length(model) <= 120),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  unique (id, family_id),
  foreign key (curriculum_unit_id, family_id) references public.curriculum_units(id, family_id) on delete cascade
);

create unique index curriculum_scope_suggestions_one_open_idx
  on public.curriculum_scope_suggestions(family_id, curriculum_unit_id, source_fingerprint)
  where status in ('queued', 'processing', 'ready');

create table public.curriculum_scope_suggestion_evidence (
  suggestion_id uuid not null,
  evidence_id uuid not null,
  family_id uuid not null references public.families(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (suggestion_id, evidence_id),
  foreign key (suggestion_id, family_id) references public.curriculum_scope_suggestions(id, family_id) on delete cascade,
  foreign key (evidence_id, family_id) references public.evidence_items(id, family_id) on delete restrict
);

alter table public.assignments
  add column curriculum_scope_suggestion_id uuid,
  add constraint assignments_scope_suggestion_family_fkey
    foreign key (curriculum_scope_suggestion_id, family_id) references public.curriculum_scope_suggestions(id, family_id) on delete set null;

-- Preserve existing identity, schedule, status, and history while marking which
-- curriculum rows are still exact generated placeholders.
update public.assignments assignment
set curriculum_item_kind = 'lesson',
    curriculum_item_state = case
      when assignment.title = unit.title || ' · ' || unit.sequence_label || ' ' || assignment.sequence_number::text
        then 'placeholder'
      else 'enriched'
    end,
    curriculum_path = '[]'::jsonb
from public.curriculum_units unit
where assignment.curriculum_unit_id = unit.id
  and assignment.family_id = unit.family_id;

with maximums as (
  select unit.id, greatest(100, coalesce(max(assignment.sequence_number), 0))::integer as target
  from public.curriculum_units unit
  left join public.assignments assignment
    on assignment.family_id = unit.family_id
   and assignment.curriculum_unit_id = unit.id
   and assignment.sequence_number is not null
  group by unit.id
)
update public.curriculum_units unit
set target_lesson_count = maximums.target
from maximums
where unit.id = maximums.id;

insert into public.assignments (
  family_id, student_id, curriculum_unit_id, created_by, created_by_type,
  title, subject, sequence_number, status, scheduled_date, scheduled_time,
  estimated_minutes, source_kind, attention_mode, parent_attention_minutes,
  curriculum_item_kind, curriculum_item_state, curriculum_path
)
select
  unit.family_id, unit.student_id, unit.id, unit.created_by, 'parent',
  unit.title || ' · ' || unit.sequence_label || ' ' || sequence.value,
  unit.subject, sequence.value, 'planned', null, null,
  unit.default_minutes, 'curriculum', null, null,
  'lesson', 'placeholder', '[]'::jsonb
from public.curriculum_units unit
cross join lateral generate_series(1, unit.target_lesson_count) as sequence(value)
where unit.status in ('active', 'paused')
  and not exists (
    select 1 from public.assignments assignment
    where assignment.curriculum_unit_id = unit.id
      and assignment.sequence_number = sequence.value
  );

update public.curriculum_units unit
set next_sequence_number = coalesce((
  select max(assignment.sequence_number) + 1
  from public.assignments assignment
  where assignment.curriculum_unit_id = unit.id
    and assignment.sequence_number is not null
), 1);

create index assignments_curriculum_unscheduled_next_idx
  on public.assignments(family_id, curriculum_unit_id, sequence_number, id)
  where scheduled_date is null and status = 'planned' and curriculum_unit_id is not null;
create index assignments_curriculum_schedule_status_idx
  on public.assignments(family_id, curriculum_unit_id, scheduled_date, status, sequence_number);
create index assignment_materials_family_assignment_position_idx
  on public.assignment_materials(family_id, assignment_id, position, evidence_id);
create index assignment_materials_evidence_idx on public.assignment_materials(evidence_id);
create index curriculum_material_suggestions_family_assignment_status_idx
  on public.curriculum_material_suggestions(family_id, assignment_id, status, created_at desc);
create index curriculum_material_suggestions_evidence_idx on public.curriculum_material_suggestions(evidence_id);
create index curriculum_scope_suggestions_family_unit_status_idx
  on public.curriculum_scope_suggestions(family_id, curriculum_unit_id, status, created_at desc);
create index curriculum_scope_suggestion_evidence_evidence_idx on public.curriculum_scope_suggestion_evidence(evidence_id);

create trigger curriculum_material_suggestions_set_updated_at before update on public.curriculum_material_suggestions
  for each row execute function private.set_updated_at();
create trigger curriculum_scope_suggestions_set_updated_at before update on public.curriculum_scope_suggestions
  for each row execute function private.set_updated_at();

alter table public.assignment_materials enable row level security;
alter table public.curriculum_material_suggestions enable row level security;
alter table public.curriculum_scope_suggestions enable row level security;
alter table public.curriculum_scope_suggestion_evidence enable row level security;

create policy "assignment materials visible to family" on public.assignment_materials
  for select to authenticated using ((select private.is_family_member(family_id)));
create policy "assignment materials created by editors" on public.assignment_materials
  for insert to authenticated with check ((select private.can_edit_family(family_id)));
create policy "assignment materials updated by editors" on public.assignment_materials
  for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "assignment materials deleted by editors" on public.assignment_materials
  for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "material suggestions visible to family" on public.curriculum_material_suggestions
  for select to authenticated using ((select private.is_family_member(family_id)));
create policy "material suggestions created by editors" on public.curriculum_material_suggestions
  for insert to authenticated with check ((select private.can_edit_family(family_id)) and requested_by = (select auth.uid()));
create policy "material suggestions reviewed by editors" on public.curriculum_material_suggestions
  for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

create policy "scope suggestions visible to family" on public.curriculum_scope_suggestions
  for select to authenticated using ((select private.is_family_member(family_id)));
create policy "scope suggestions created by editors" on public.curriculum_scope_suggestions
  for insert to authenticated with check ((select private.can_edit_family(family_id)) and requested_by = (select auth.uid()));
create policy "scope suggestions reviewed by editors" on public.curriculum_scope_suggestions
  for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

create policy "scope suggestion evidence visible to family" on public.curriculum_scope_suggestion_evidence
  for select to authenticated using ((select private.is_family_member(family_id)));
create policy "scope suggestion evidence created by editors" on public.curriculum_scope_suggestion_evidence
  for insert to authenticated with check ((select private.can_edit_family(family_id)));
create policy "scope suggestion evidence deleted by editors" on public.curriculum_scope_suggestion_evidence
  for delete to authenticated using ((select private.can_edit_family(family_id)));

revoke all on public.assignment_materials, public.curriculum_material_suggestions,
  public.curriculum_scope_suggestions, public.curriculum_scope_suggestion_evidence from anon;
grant select, insert, update, delete on public.assignment_materials to authenticated, service_role;
grant select, insert, update on public.curriculum_material_suggestions to authenticated, service_role;
grant select, insert, update on public.curriculum_scope_suggestions to authenticated, service_role;
grant select, insert, delete on public.curriculum_scope_suggestion_evidence to authenticated, service_role;

create or replace function public.schedule_curriculum_assignments(
  p_family_id uuid,
  p_actor_id uuid,
  p_placements jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_count integer;
  scheduled_count integer;
  placement_count integer;
begin
  if p_actor_id is distinct from (select auth.uid())
    or not (select private.can_edit_family(p_family_id)) then
    raise exception 'CURRICULUM_SCHEDULE_FORBIDDEN';
  end if;
  if jsonb_typeof(p_placements) <> 'array' then raise exception 'CURRICULUM_SCHEDULE_INVALID'; end if;
  requested_count := jsonb_array_length(p_placements);
  if requested_count > 100 then raise exception 'CURRICULUM_SCHEDULE_TOO_LARGE'; end if;
  if requested_count = 0 then return jsonb_build_object('status', 'scheduled', 'count', 0); end if;

  with requested as (
    select * from jsonb_to_recordset(p_placements) as value(
      assignment_id uuid,
      scheduled_date date,
      scheduled_time time without time zone,
      estimated_minutes integer,
      position integer
    )
  ), updated as (
    update public.assignments assignment
    set scheduled_date = requested.scheduled_date,
        scheduled_time = requested.scheduled_time,
        estimated_minutes = requested.estimated_minutes,
        version = assignment.version + 1
    from requested
    where assignment.id = requested.assignment_id
      and assignment.family_id = p_family_id
      and assignment.curriculum_unit_id is not null
      and assignment.status = 'planned'
      and assignment.scheduled_date is null
      and requested.scheduled_date is not null
      and requested.estimated_minutes between 5 and 480
    returning assignment.id, assignment.family_id, assignment.student_id,
      assignment.curriculum_unit_id, assignment.title, assignment.subject,
      assignment.instructions, assignment.scheduled_date, assignment.scheduled_time,
      assignment.estimated_minutes
  ), inserted as (
    insert into public.weekly_plan_items (
      family_id, student_id, assignment_id, artifact_id, title, description,
      subject, scheduled_date, scheduled_time, estimated_minutes,
      curriculum_url, source_kind, position
    )
    select
      updated.family_id, updated.student_id, updated.id, null, updated.title,
      updated.instructions, updated.subject, updated.scheduled_date,
      updated.scheduled_time, updated.estimated_minutes, unit.curriculum_url,
      'klio', requested.position
    from updated
    join requested on requested.assignment_id = updated.id
    join public.curriculum_units unit
      on unit.id = updated.curriculum_unit_id and unit.family_id = updated.family_id
    returning id
  )
  select (select count(*) from updated), (select count(*) from inserted)
  into scheduled_count, placement_count;

  if scheduled_count <> requested_count or placement_count <> requested_count then
    raise exception 'CURRICULUM_SCHEDULE_CONFLICT';
  end if;
  return jsonb_build_object('status', 'scheduled', 'count', scheduled_count);
end;
$$;

revoke all on function public.schedule_curriculum_assignments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.schedule_curriculum_assignments(uuid, uuid, jsonb) to authenticated;

create or replace function public.apply_curriculum_scope_suggestion(
  p_family_id uuid,
  p_actor_id uuid,
  p_suggestion_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.curriculum_scope_suggestions;
  requested_count integer;
  updated_count integer;
begin
  if p_actor_id is distinct from (select auth.uid())
    or not (select private.can_edit_family(p_family_id)) then
    raise exception 'CURRICULUM_SCOPE_APPLY_FORBIDDEN';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'CURRICULUM_SCOPE_APPLY_INVALID'; end if;
  requested_count := jsonb_array_length(p_items);
  if requested_count > 500 then raise exception 'CURRICULUM_SCOPE_APPLY_TOO_LARGE'; end if;
  select * into proposal from public.curriculum_scope_suggestions
  where id = p_suggestion_id and family_id = p_family_id and status = 'ready'
  for update;
  if proposal.id is null then raise exception 'CURRICULUM_SCOPE_SUGGESTION_STALE'; end if;

  with requested as (
    select * from jsonb_to_recordset(p_items) as value(
      assignment_id uuid,
      sequence_number integer,
      title text,
      kind text,
      path jsonb,
      minutes integer
    )
  ), updated as (
    update public.assignments assignment
    set title = requested.title,
        curriculum_item_kind = requested.kind,
        curriculum_path = coalesce(requested.path, '[]'::jsonb),
        estimated_minutes = coalesce(requested.minutes, assignment.estimated_minutes),
        curriculum_item_state = 'enriched',
        curriculum_scope_suggestion_id = proposal.id,
        version = assignment.version + 1
    from requested
    where assignment.id = requested.assignment_id
      and assignment.family_id = p_family_id
      and assignment.curriculum_unit_id = proposal.curriculum_unit_id
      and assignment.sequence_number = requested.sequence_number
      and assignment.status = 'planned'
      and char_length(requested.title) between 1 and 200
      and requested.kind in ('lesson', 'assessment', 'review', 'project', 'activity')
      and (requested.minutes is null or requested.minutes between 5 and 480)
      and jsonb_typeof(coalesce(requested.path, '[]'::jsonb)) = 'array'
      and jsonb_array_length(coalesce(requested.path, '[]'::jsonb)) <= 8
    returning assignment.id, assignment.title, assignment.estimated_minutes
  ), synchronized as (
    update public.weekly_plan_items placement
    set title = updated.title,
        estimated_minutes = updated.estimated_minutes
    from updated
    where placement.family_id = p_family_id
      and placement.assignment_id = updated.id
    returning placement.id
  )
  select count(*) into updated_count from updated;

  if updated_count <> requested_count then raise exception 'CURRICULUM_SCOPE_APPLY_CONFLICT'; end if;
  update public.curriculum_scope_suggestions
  set status = 'applied', reviewed_by = p_actor_id, reviewed_at = timezone('utc', now())
  where id = proposal.id and family_id = p_family_id;
  return jsonb_build_object('status', 'applied', 'count', updated_count);
end;
$$;

revoke all on function public.apply_curriculum_scope_suggestion(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_curriculum_scope_suggestion(uuid, uuid, uuid, jsonb) to authenticated;

comment on table public.assignment_materials is 'Parent curriculum sources attached to stable assignments; never learner submission evidence.';
comment on table public.curriculum_material_suggestions is 'Source-grounded lesson metadata proposals requiring parent confirmation.';
comment on table public.curriculum_scope_suggestions is 'Publisher-aware course outline proposals with explicit provenance and assumptions.';
