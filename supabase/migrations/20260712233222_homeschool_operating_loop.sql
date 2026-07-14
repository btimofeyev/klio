-- Klio's operating loop: curriculum -> assignment -> submission -> review -> replan.
alter table public.students
  add column daily_capacity_minutes integer not null default 180
    check (daily_capacity_minutes between 30 and 600),
  add column schedule_preferences jsonb not null default '{}'::jsonb;

create table public.curriculum_units (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  subject text not null check (char_length(subject) between 1 and 80),
  title text not null check (char_length(title) between 1 and 200),
  curriculum_url text check (curriculum_url is null or char_length(curriculum_url) <= 2048),
  sequence_label text not null default 'Lesson' check (char_length(sequence_label) between 1 and 40),
  next_sequence_number integer not null default 1 check (next_sequence_number > 0),
  default_minutes integer not null default 40 check (default_minutes between 5 and 480),
  schedule_rule jsonb not null default '{"days":[]}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  curriculum_unit_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_by_type text not null default 'parent' check (created_by_type in ('parent', 'agent', 'import')),
  title text not null check (char_length(title) between 1 and 200),
  subject text not null check (char_length(subject) between 1 and 80),
  instructions text,
  sequence_number integer check (sequence_number is null or sequence_number > 0),
  status text not null default 'planned' check (status in ('planned', 'doing', 'submitted', 'completed', 'skipped', 'needs_review')),
  scheduled_date date,
  due_at timestamptz,
  scheduled_time time,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 5 and 480),
  completed_at timestamptz,
  submitted_at timestamptz,
  skipped_at timestamptz,
  source_kind text not null default 'curriculum' check (source_kind in ('curriculum', 'practice', 'parent', 'agent')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  unique (curriculum_unit_id, sequence_number),
  foreign key (curriculum_unit_id, family_id) references public.curriculum_units(id, family_id) on delete set null
);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  assignment_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  note text,
  status text not null default 'received' check (status in ('received', 'processing', 'ready_for_review', 'reviewed', 'returned')),
  submitted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (assignment_id, family_id) references public.assignments(id, family_id) on delete cascade
);

create table public.assignment_submission_evidence (
  submission_id uuid not null,
  evidence_id uuid not null references public.evidence_items(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (submission_id, evidence_id),
  foreign key (submission_id, family_id) references public.assignment_submissions(id, family_id) on delete cascade
);

create table public.assignment_reviews (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  assignment_id uuid not null,
  submission_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  agent_turn_id uuid,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'superseded')),
  draft_score numeric(5,2) check (draft_score is null or draft_score between 0 and 100),
  score numeric(5,2) check (score is null or score between 0 and 100),
  score_label text check (score_label is null or char_length(score_label) <= 40),
  draft_feedback text,
  feedback text,
  rubric jsonb not null default '[]'::jsonb,
  mastery_signals jsonb not null default '[]'::jsonb,
  uncertainty_flags jsonb not null default '[]'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (assignment_id, family_id) references public.assignments(id, family_id) on delete cascade,
  foreign key (submission_id, family_id) references public.assignment_submissions(id, family_id) on delete cascade,
  foreign key (agent_turn_id, family_id) references public.agent_turns(id, family_id) on delete set null
);

create unique index assignment_reviews_one_current_submission_idx
  on public.assignment_reviews(submission_id) where status in ('draft', 'approved');

create table public.adjustment_proposals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  agent_turn_id uuid,
  week_start date not null,
  reason text not null check (char_length(reason) between 1 and 500),
  summary text not null check (char_length(summary) between 1 and 1000),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'applied', 'expired')),
  snapshot_version bigint not null check (snapshot_version >= 0),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (agent_turn_id, family_id) references public.agent_turns(id, family_id) on delete set null
);

create table public.adjustment_actions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  proposal_id uuid not null,
  assignment_id uuid,
  action_type text not null check (action_type in ('move', 'change_duration', 'add_practice', 'skip')),
  position integer not null default 0,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, family_id),
  foreign key (proposal_id, family_id) references public.adjustment_proposals(id, family_id) on delete cascade,
  foreign key (assignment_id, family_id) references public.assignments(id, family_id) on delete cascade
);

alter table public.weekly_plan_items
  add column assignment_id uuid,
  add constraint weekly_plan_items_assignment_family_fkey
    foreign key (assignment_id, family_id) references public.assignments(id, family_id) on delete set null;

create unique index weekly_plan_items_assignment_idx
  on public.weekly_plan_items(assignment_id) where assignment_id is not null;

-- Preserve every existing calendar row as a first-class assignment.
with created as (
  insert into public.assignments (
    family_id, student_id, title, subject, instructions, status, scheduled_date,
    scheduled_time, estimated_minutes, completed_at, source_kind, created_at, updated_at
  )
  select
    family_id, student_id, title, coalesce(nullif(subject, ''), 'Learning'), description,
    case when completed_at is not null then 'completed' else 'planned' end,
    scheduled_date, scheduled_time, estimated_minutes, completed_at,
    case when source_kind = 'agent' then 'agent' when source_kind = 'practice' then 'practice' else 'curriculum' end,
    created_at, updated_at
  from public.weekly_plan_items
  where student_id is not null and assignment_id is null
  returning id, family_id, student_id, title, scheduled_date, created_at
)
update public.weekly_plan_items item
set assignment_id = created.id
from created
where item.family_id = created.family_id
  and item.student_id = created.student_id
  and item.title = created.title
  and item.scheduled_date is not distinct from created.scheduled_date
  and item.created_at = created.created_at
  and item.assignment_id is null;

create index curriculum_units_family_student_idx on public.curriculum_units(family_id, student_id, status);
create index assignments_family_student_schedule_idx on public.assignments(family_id, student_id, scheduled_date, status);
create index assignments_review_queue_idx on public.assignments(family_id, status, submitted_at) where status in ('submitted', 'needs_review');
create index assignment_submissions_assignment_idx on public.assignment_submissions(assignment_id, submitted_at desc);
create index assignment_reviews_family_status_idx on public.assignment_reviews(family_id, status, created_at desc);
create index adjustment_proposals_family_week_idx on public.adjustment_proposals(family_id, week_start, status);
create index adjustment_actions_proposal_idx on public.adjustment_actions(proposal_id, position);

create trigger curriculum_units_set_updated_at before update on public.curriculum_units for each row execute function private.set_updated_at();
create trigger assignments_set_updated_at before update on public.assignments for each row execute function private.set_updated_at();
create trigger assignment_submissions_set_updated_at before update on public.assignment_submissions for each row execute function private.set_updated_at();
create trigger assignment_reviews_set_updated_at before update on public.assignment_reviews for each row execute function private.set_updated_at();
create trigger adjustment_proposals_set_updated_at before update on public.adjustment_proposals for each row execute function private.set_updated_at();

create trigger curriculum_units_bump_agent_context after insert or update or delete on public.curriculum_units for each row execute function private.bump_family_agent_context();
create trigger assignments_bump_agent_context after insert or update or delete on public.assignments for each row execute function private.bump_family_agent_context();
create trigger assignment_submissions_bump_agent_context after insert or update or delete on public.assignment_submissions for each row execute function private.bump_family_agent_context();
create trigger assignment_reviews_bump_agent_context after insert or update or delete on public.assignment_reviews for each row execute function private.bump_family_agent_context();

alter table public.curriculum_units enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.assignment_submission_evidence enable row level security;
alter table public.assignment_reviews enable row level security;
alter table public.adjustment_proposals enable row level security;
alter table public.adjustment_actions enable row level security;

create policy "curriculum units visible to family" on public.curriculum_units for select to authenticated using ((select private.is_family_member(family_id)));
create policy "curriculum units editable by family" on public.curriculum_units for all to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));
create policy "assignments visible to family" on public.assignments for select to authenticated using ((select private.is_family_member(family_id)));
create policy "assignments editable by family" on public.assignments for all to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "submissions visible to family" on public.assignment_submissions for select to authenticated using ((select private.is_family_member(family_id)));
create policy "submissions editable by family" on public.assignment_submissions for all to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "submission evidence visible to family" on public.assignment_submission_evidence for select to authenticated using ((select private.is_family_member(family_id)));
create policy "submission evidence editable by family" on public.assignment_submission_evidence for all to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "assignment reviews visible to family" on public.assignment_reviews for select to authenticated using ((select private.is_family_member(family_id)));
create policy "assignment reviews editable by family" on public.assignment_reviews for all to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "adjustments visible to family" on public.adjustment_proposals for select to authenticated using ((select private.is_family_member(family_id)));
create policy "adjustments editable by family" on public.adjustment_proposals for all to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));
create policy "adjustment actions visible to family" on public.adjustment_actions for select to authenticated using ((select private.is_family_member(family_id)));
create policy "adjustment actions editable by family" on public.adjustment_actions for all to authenticated using ((select private.can_edit_family(family_id))) with check ((select private.can_edit_family(family_id)));

grant select, insert, update, delete on public.curriculum_units, public.assignments, public.assignment_submissions,
  public.assignment_submission_evidence, public.assignment_reviews, public.adjustment_proposals, public.adjustment_actions to authenticated;

comment on table public.assignments is 'Durable curriculum-backed work; weekly_plan_items are only calendar placements.';
comment on table public.assignment_reviews is 'Agent-drafted, parent-approved score, feedback, rubric, and mastery observations.';
comment on table public.adjustment_proposals is 'A snapshot-bound, parent-approvable coordinated change to a learner week.';
