-- Earlier runtimes could accept a model terminal label as a clarification even
-- when the bounded ask_parent tool had not created an answerable question.
-- Such turns must not block the family conversation or surface fake work.
update public.agent_turns as turn
set
  status = 'completed',
  completed_at = coalesce(turn.completed_at, turn.last_progress_at, turn.created_at, now()),
  normalized_step = 'finished',
  last_progress_at = coalesce(turn.last_progress_at, now()),
  last_heartbeat_at = coalesce(turn.last_heartbeat_at, now())
where turn.status = 'awaiting_parent'
  and not exists (
    select 1
    from public.question_threads as question
    where question.awaiting_turn_id = turn.id
      and question.status = 'open'
      and exists (
        select 1
        from public.question_messages as message
        where message.thread_id = question.id
          and message.role = 'assistant'
          and btrim(message.content) <> ''
      )
  );

update public.agent_threads as thread
set status = 'active'
where thread.status = 'awaiting_parent'
  and not exists (
    select 1
    from public.agent_turns as turn
    join public.question_threads as question
      on question.awaiting_turn_id = turn.id
     and question.status = 'open'
    where turn.thread_id = thread.id
      and turn.status = 'awaiting_parent'
      and exists (
        select 1
        from public.question_messages as message
        where message.thread_id = question.id
          and message.role = 'assistant'
          and btrim(message.content) <> ''
      )
  );
