-- A parent submission may contain several supporting files for one assignment.
-- Files remain independently auditable evidence, while this identifier lets the
-- product and agent treat the submission as one unit of work.
alter table public.evidence_items
  add column capture_submission_id uuid;

create index evidence_items_family_capture_submission_idx
  on public.evidence_items (family_id, capture_submission_id, created_at desc)
  where capture_submission_id is not null;

comment on column public.evidence_items.capture_submission_id is
  'Host-generated identifier shared by all evidence uploaded in one parent submission.';
