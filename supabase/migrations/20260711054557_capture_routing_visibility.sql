alter table public.evidence_items
  add column capture_route text not null default 'learning'
  check (capture_route in ('learning', 'reminder', 'mixed', 'uncertain'));

create index evidence_items_family_learning_created_idx
  on public.evidence_items(family_id, created_at desc)
  where capture_route <> 'reminder';
