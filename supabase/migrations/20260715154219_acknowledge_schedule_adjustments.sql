alter table public.adjustment_proposals
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid references auth.users(id) on delete set null;

create index adjustment_proposals_family_unacknowledged_idx
  on public.adjustment_proposals(family_id, created_at desc)
  where status = 'applied' and acknowledged_at is null;

comment on column public.adjustment_proposals.acknowledged_at is
  'When a parent last cleared this applied adjustment from the active teaching workspace.';
comment on column public.adjustment_proposals.acknowledged_by is
  'The authenticated parent who cleared this applied adjustment from the active teaching workspace.';
