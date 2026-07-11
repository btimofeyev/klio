create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  source_evidence_id uuid references public.evidence_items(id) on delete set null,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'completed', 'dismissed')),
  created_by_type text not null check (created_by_type in ('agent', 'parent')),
  created_by uuid references auth.users(id) on delete set null,
  confidence numeric(4,3) check (confidence between 0 and 1),
  rationale text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_threads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.question_threads(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 10000),
  confidence text check (confidence in ('high', 'medium', 'low')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.question_message_sources (
  message_id uuid not null references public.question_messages(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  source_type text not null check (source_type in ('evidence', 'artifact', 'observation')),
  source_id uuid not null,
  title text not null,
  primary key (message_id, source_type, source_id)
);

create index reminders_family_status_due_idx on public.reminders(family_id, status, due_at nulls last);
create unique index reminders_pending_source_title_idx
  on public.reminders(family_id, source_evidence_id, lower(title))
  where status = 'pending' and source_evidence_id is not null;
create index question_threads_family_updated_idx on public.question_threads(family_id, updated_at desc);
create index question_messages_thread_created_idx on public.question_messages(thread_id, created_at);
create index question_message_sources_family_idx on public.question_message_sources(family_id, source_type, source_id);

create trigger reminders_set_updated_at before update on public.reminders
for each row execute function private.set_updated_at();
create trigger question_threads_set_updated_at before update on public.question_threads
for each row execute function private.set_updated_at();

alter table public.reminders enable row level security;
alter table public.question_threads enable row level security;
alter table public.question_messages enable row level security;
alter table public.question_message_sources enable row level security;

create policy "reminders are visible to family members"
on public.reminders for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "family editors can create reminders"
on public.reminders for insert to authenticated
with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()) and created_by_type = 'parent');
create policy "family editors can update reminders"
on public.reminders for update to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)));
create policy "family editors can delete reminders"
on public.reminders for delete to authenticated
using ((select private.can_edit_family(family_id)));

create policy "question threads are visible to family members"
on public.question_threads for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "family editors can create question threads"
on public.question_threads for insert to authenticated
with check ((select private.can_edit_family(family_id)) and created_by = (select auth.uid()));

create policy "question messages are visible to family members"
on public.question_messages for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "family editors can create their question messages"
on public.question_messages for insert to authenticated
with check (
  (select private.can_edit_family(family_id))
  and role = 'user'
  and created_by = (select auth.uid())
  and exists (select 1 from public.question_threads t where t.id = thread_id and t.family_id = family_id)
);

create policy "question sources are visible to family members"
on public.question_message_sources for select to authenticated
using ((select private.is_family_member(family_id)));

grant select, insert, update, delete on public.reminders to authenticated;
grant select, insert on public.question_threads, public.question_messages to authenticated;
grant select on public.question_message_sources to authenticated;
