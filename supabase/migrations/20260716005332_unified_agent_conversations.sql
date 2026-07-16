create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  title text not null default 'Conversation with Klio' check (char_length(title) between 1 and 160),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id)
);

create table public.agent_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  family_id uuid not null references public.families(id) on delete cascade,
  agent_turn_id uuid,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (conversation_id, family_id) references public.agent_conversations(id, family_id) on delete cascade,
  foreign key (agent_turn_id, family_id) references public.agent_turns(id, family_id) on delete set null (agent_turn_id)
);

create unique index agent_conversation_messages_idempotency_idx
  on public.agent_conversation_messages(family_id, idempotency_key)
  where idempotency_key is not null;
create index agent_conversations_family_updated_idx
  on public.agent_conversations(family_id, updated_at desc);
create index agent_conversation_messages_conversation_created_idx
  on public.agent_conversation_messages(conversation_id, created_at);

create trigger agent_conversations_set_updated_at before update on public.agent_conversations
for each row execute function private.set_updated_at();

alter table public.agent_threads
  add column conversation_id uuid,
  add constraint agent_threads_conversation_family_fkey
    foreign key (conversation_id, family_id) references public.agent_conversations(id, family_id) on delete cascade;

drop index public.agent_threads_one_current_family_idx;
create unique index agent_threads_one_current_workspace_idx
  on public.agent_threads(family_id, agent_kind)
  where conversation_id is null and status in ('active', 'awaiting_parent', 'replacing');
create unique index agent_threads_one_current_conversation_idx
  on public.agent_threads(family_id, conversation_id, agent_kind)
  where conversation_id is not null and status in ('active', 'awaiting_parent', 'replacing');

alter table public.agent_turns
  add column conversation_id uuid,
  add column interaction_mode text not null default 'act' check (interaction_mode in ('answer', 'act')),
  add column streamed_message text check (streamed_message is null or char_length(streamed_message) <= 12000),
  add constraint agent_turns_conversation_family_fkey
    foreign key (conversation_id, family_id) references public.agent_conversations(id, family_id) on delete cascade;

create index agent_turns_conversation_created_idx
  on public.agent_turns(conversation_id, created_at desc)
  where conversation_id is not null;

create or replace function private.touch_agent_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agent_conversations
  set updated_at = greatest(updated_at, new.created_at)
  where id = new.conversation_id and family_id = new.family_id;
  return new;
end;
$$;

create trigger agent_conversation_messages_touch_conversation
after insert on public.agent_conversation_messages
for each row execute function private.touch_agent_conversation();

alter table public.agent_conversations enable row level security;
alter table public.agent_conversation_messages enable row level security;

create policy "agent conversations are visible to family members"
on public.agent_conversations for select to authenticated
using ((select private.is_family_member(family_id)));
create policy "agent conversation messages are visible to family members"
on public.agent_conversation_messages for select to authenticated
using ((select private.is_family_member(family_id)));

grant select on public.agent_conversations, public.agent_conversation_messages to authenticated;
grant select, insert, update, delete on public.agent_conversations, public.agent_conversation_messages to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_turns'
  ) then
    alter publication supabase_realtime add table public.agent_turns;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_events'
  ) then
    alter publication supabase_realtime add table public.agent_events;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_conversation_messages'
  ) then
    alter publication supabase_realtime add table public.agent_conversation_messages;
  end if;
end
$$;

comment on table public.agent_conversations is 'Durable parent-visible Klio conversations. Agent work runs as linked turns instead of replacing the conversation.';
comment on column public.agent_turns.interaction_mode is 'Host-authorized lane: answer is read-only; act may receive narrowly scoped mutation tools.';
