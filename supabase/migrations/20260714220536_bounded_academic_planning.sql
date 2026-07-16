-- Normalized planning facts used to calculate whether a learner is on track.
-- These are parent-owned records, not legal-compliance prescriptions.

alter table public.evidence_items
  add constraint evidence_items_id_family_unique unique (id, family_id);

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  starts_on date not null,
  ends_on date not null,
  target_instructional_days integer check (target_instructional_days is null or target_instructional_days between 1 and 366),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'archived')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  check (ends_on >= starts_on)
);

create unique index academic_terms_one_active_family_idx
  on public.academic_terms(family_id) where status = 'active';
create index academic_terms_family_dates_idx
  on public.academic_terms(family_id, starts_on, ends_on);

create table public.academic_term_weekdays (
  family_id uuid not null references public.families(id) on delete cascade,
  term_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (term_id, weekday),
  foreign key (term_id, family_id) references public.academic_terms(id, family_id) on delete cascade
);

create table public.instructional_day_overrides (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  term_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  instructional_date date not null,
  is_instructional boolean not null,
  available_minutes integer check (available_minutes is null or available_minutes between 0 and 1440),
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (term_id, instructional_date),
  unique (id, family_id),
  foreign key (term_id, family_id) references public.academic_terms(id, family_id) on delete cascade
);

create index instructional_day_overrides_family_date_idx
  on public.instructional_day_overrides(family_id, instructional_date);

create table public.learning_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null,
  term_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  subject text not null check (char_length(subject) between 1 and 80),
  description text check (description is null or char_length(description) <= 3000),
  goal_kind text not null default 'curriculum_progress' check (goal_kind in ('curriculum_progress', 'milestone', 'effort', 'credit', 'hours', 'standard', 'custom')),
  target_value numeric(10,2) check (target_value is null or target_value >= 0),
  target_unit text check (target_unit is null or char_length(target_unit) <= 40),
  target_date date,
  weekly_effort_minutes integer check (weekly_effort_minutes is null or weekly_effort_minutes between 0 and 10080),
  weekly_cadence smallint check (weekly_cadence is null or weekly_cadence between 0 and 14),
  priority smallint not null default 50 check (priority between 0 and 100),
  constraints text check (constraints is null or char_length(constraints) <= 2000),
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'blocked', 'completed', 'cancelled')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade,
  foreign key (term_id, family_id) references public.academic_terms(id, family_id) on delete set null
);

create index learning_goals_family_student_status_idx
  on public.learning_goals(family_id, student_id, status, target_date);
create index learning_goals_family_term_subject_idx
  on public.learning_goals(family_id, term_id, subject);

create table public.curriculum_pacing_targets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null,
  term_id uuid not null,
  curriculum_unit_id uuid not null,
  goal_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  starts_on date not null,
  target_completion_date date not null,
  start_sequence integer not null default 1 check (start_sequence > 0),
  target_sequence integer not null check (target_sequence > 0),
  expected_assignments integer check (expected_assignments is null or expected_assignments > 0),
  weekly_cadence smallint not null check (weekly_cadence between 1 and 14),
  weekly_effort_minutes integer not null check (weekly_effort_minutes between 5 and 10080),
  priority smallint not null default 50 check (priority between 0 and 100),
  constraints text check (constraints is null or char_length(constraints) <= 2000),
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  unique (term_id, curriculum_unit_id),
  check (target_completion_date >= starts_on),
  check (target_sequence >= start_sequence),
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade,
  foreign key (term_id, family_id) references public.academic_terms(id, family_id) on delete cascade,
  foreign key (curriculum_unit_id, family_id) references public.curriculum_units(id, family_id) on delete cascade,
  foreign key (goal_id, family_id) references public.learning_goals(id, family_id) on delete set null
);

create index curriculum_pacing_family_student_status_idx
  on public.curriculum_pacing_targets(family_id, student_id, status, target_completion_date);

-- Append-only from agent tools. Parents may correct a record by adding a superseding
-- entry; rejected drafts are never inserted here as learner facts.
create table public.goal_progress_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  goal_id uuid not null,
  student_id uuid not null,
  recorded_by uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('parent', 'agent', 'import')),
  source_kind text not null check (source_kind in ('parent_report', 'approved_review', 'assignment_completion', 'source_evidence', 'import')),
  source_assignment_id uuid,
  source_review_id uuid,
  source_evidence_id uuid,
  observed_on date not null default current_date,
  progress_value numeric(10,2) not null check (progress_value >= 0),
  progress_unit text not null check (char_length(progress_unit) between 1 and 40),
  note text check (note is null or char_length(note) <= 1000),
  supersedes_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (goal_id, family_id) references public.learning_goals(id, family_id) on delete cascade,
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade,
  foreign key (source_assignment_id, family_id) references public.assignments(id, family_id) on delete restrict,
  foreign key (source_review_id, family_id) references public.assignment_reviews(id, family_id) on delete restrict,
  foreign key (source_evidence_id, family_id) references public.evidence_items(id, family_id) on delete restrict,
  foreign key (supersedes_id, family_id) references public.goal_progress_records(id, family_id) on delete restrict,
  check (num_nonnulls(source_assignment_id, source_review_id, source_evidence_id) <= 1),
  check (
    (source_kind = 'parent_report' and source_assignment_id is null and source_review_id is null and source_evidence_id is null)
    or (source_kind = 'assignment_completion' and source_assignment_id is not null)
    or (source_kind = 'approved_review' and source_review_id is not null)
    or (source_kind = 'source_evidence' and source_evidence_id is not null)
    or source_kind = 'import'
  )
);

create index goal_progress_goal_observed_idx
  on public.goal_progress_records(goal_id, observed_on desc, created_at desc);
create index goal_progress_family_student_idx
  on public.goal_progress_records(family_id, student_id, observed_on desc);

-- Weekly checkpoint rows preserve exactly what changed between reviews without
-- allowing the browser or model to forge derived pace conclusions.
create table public.pacing_checkpoints (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  goal_id uuid not null,
  student_id uuid not null,
  pacing_target_id uuid,
  as_of_date date not null,
  expected_value numeric(10,2) not null check (expected_value >= 0),
  actual_value numeric(10,2) not null check (actual_value >= 0),
  target_value numeric(10,2) not null check (target_value >= 0),
  remaining_value numeric(10,2) not null check (remaining_value >= 0),
  state text not null check (state in ('ahead', 'on_pace', 'at_risk', 'blocked', 'complete')),
  feasible boolean not null,
  projected_completion_date date,
  overdue_count integer not null default 0 check (overdue_count >= 0),
  planned_record_count integer not null default 0 check (planned_record_count >= 0),
  approved_evidence_count integer not null default 0 check (approved_evidence_count >= 0),
  capacity_minutes_remaining integer check (capacity_minutes_remaining is null or capacity_minutes_remaining >= 0),
  basis text not null check (basis in ('plan', 'approved_evidence', 'mixed')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  unique (goal_id, as_of_date),
  foreign key (goal_id, family_id) references public.learning_goals(id, family_id) on delete cascade,
  foreign key (student_id, family_id) references public.students(id, family_id) on delete cascade,
  foreign key (pacing_target_id, family_id) references public.curriculum_pacing_targets(id, family_id) on delete cascade
);

create index pacing_checkpoints_family_goal_date_idx
  on public.pacing_checkpoints(family_id, goal_id, as_of_date desc);

create trigger academic_terms_set_updated_at before update on public.academic_terms
for each row execute function private.set_updated_at();
create trigger instructional_day_overrides_set_updated_at before update on public.instructional_day_overrides
for each row execute function private.set_updated_at();
create trigger learning_goals_set_updated_at before update on public.learning_goals
for each row execute function private.set_updated_at();
create trigger curriculum_pacing_targets_set_updated_at before update on public.curriculum_pacing_targets
for each row execute function private.set_updated_at();

create trigger academic_terms_bump_agent_context after insert or update or delete on public.academic_terms
for each row execute function private.bump_family_agent_context();
create trigger academic_term_weekdays_bump_agent_context after insert or update or delete on public.academic_term_weekdays
for each row execute function private.bump_family_agent_context();
create trigger instructional_days_bump_agent_context after insert or update or delete on public.instructional_day_overrides
for each row execute function private.bump_family_agent_context();
create trigger learning_goals_bump_agent_context after insert or update or delete on public.learning_goals
for each row execute function private.bump_family_agent_context();
create trigger curriculum_pacing_bump_agent_context after insert or update or delete on public.curriculum_pacing_targets
for each row execute function private.bump_family_agent_context();
create trigger goal_progress_bump_agent_context after insert or update or delete on public.goal_progress_records
for each row execute function private.bump_family_agent_context();
create trigger pacing_checkpoints_bump_agent_context after insert or update or delete on public.pacing_checkpoints
for each row execute function private.bump_family_agent_context();

alter table public.academic_terms enable row level security;
alter table public.academic_term_weekdays enable row level security;
alter table public.instructional_day_overrides enable row level security;
alter table public.learning_goals enable row level security;
alter table public.curriculum_pacing_targets enable row level security;
alter table public.goal_progress_records enable row level security;
alter table public.pacing_checkpoints enable row level security;

create policy "academic terms visible to family" on public.academic_terms
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "academic terms created by editors" on public.academic_terms
for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "academic terms updated by editors" on public.academic_terms
for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "academic terms deleted by editors" on public.academic_terms
for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "academic term weekdays visible to family" on public.academic_term_weekdays
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "academic term weekdays created by editors" on public.academic_term_weekdays
for insert to authenticated with check ((select private.can_edit_family(family_id)));
create policy "academic term weekdays deleted by editors" on public.academic_term_weekdays
for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "instructional days visible to family" on public.instructional_day_overrides
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "instructional days created by editors" on public.instructional_day_overrides
for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "instructional days updated by editors" on public.instructional_day_overrides
for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "instructional days deleted by editors" on public.instructional_day_overrides
for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "learning goals visible to family" on public.learning_goals
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "learning goals created by editors" on public.learning_goals
for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "learning goals updated by editors" on public.learning_goals
for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "learning goals deleted by editors" on public.learning_goals
for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "pacing targets visible to family" on public.curriculum_pacing_targets
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "pacing targets created by editors" on public.curriculum_pacing_targets
for insert to authenticated with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "pacing targets updated by editors" on public.curriculum_pacing_targets
for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "pacing targets deleted by editors" on public.curriculum_pacing_targets
for delete to authenticated using ((select private.can_edit_family(family_id)));

create policy "goal progress visible to family" on public.goal_progress_records
for select to authenticated using ((select private.is_family_member(family_id)));
create policy "goal progress created by editors" on public.goal_progress_records
for insert to authenticated with check ((select private.can_edit_family(family_id)) and recorded_by = (select auth.uid()));
create policy "goal progress corrected by editors" on public.goal_progress_records
for update to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

create policy "pacing checkpoints visible to family" on public.pacing_checkpoints
for select to authenticated using ((select private.is_family_member(family_id)));

grant select, insert, update, delete on public.academic_terms, public.instructional_day_overrides,
  public.learning_goals, public.curriculum_pacing_targets to authenticated;
grant select, insert, delete on public.academic_term_weekdays to authenticated;
grant select, insert, update on public.goal_progress_records to authenticated;
grant select on public.pacing_checkpoints to authenticated;
grant select, insert, update, delete on public.academic_terms, public.instructional_day_overrides,
  public.academic_term_weekdays, public.learning_goals, public.curriculum_pacing_targets,
  public.goal_progress_records, public.pacing_checkpoints to service_role;

comment on table public.academic_terms is 'Parent-defined instructional date range; not a state-law compliance determination.';
comment on table public.learning_goals is 'Parent-owned per-learner subject goals and priorities.';
comment on table public.curriculum_pacing_targets is 'Deterministic expected curriculum pace and weekly effort for a term.';
comment on table public.goal_progress_records is 'Append-only agent-visible progress provenance; rejected drafts are not learner facts.';
comment on table public.pacing_checkpoints is 'Server-derived weekly pace comparison; authenticated clients have read-only access.';
