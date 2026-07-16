with practice_subjects as (
  select distinct
    e.family_id,
    nullif(trim(e.raw_text::jsonb ->> 'subject'), '') as subject
  from public.evidence_items e
  where e.kind = 'practice_result'
    and e.raw_text is not null
    and e.raw_text ~ '^\s*\{'
)
insert into public.categories (family_id, name, slug, description, created_by_type)
select
  family_id,
  subject,
  trim(both '-' from regexp_replace(lower(subject), '[^a-z0-9]+', '-', 'g')),
  subject || ' learning records and source evidence.',
  'agent'
from practice_subjects
where subject is not null
  and trim(both '-' from regexp_replace(lower(subject), '[^a-z0-9]+', '-', 'g')) <> ''
on conflict (family_id, slug) do nothing;

insert into public.evidence_categories (
  family_id,
  evidence_id,
  category_id,
  assigned_by,
  confidence,
  document_type,
  tags
)
select
  e.family_id,
  e.id,
  c.id,
  'agent',
  1,
  'Practice result',
  case
    when nullif(trim(e.raw_text::jsonb ->> 'skill_key'), '') is null then '{}'
    else array[e.raw_text::jsonb ->> 'skill_key']
  end
from public.evidence_items e
join public.categories c
  on c.family_id = e.family_id
 and c.slug = trim(both '-' from regexp_replace(lower(e.raw_text::jsonb ->> 'subject'), '[^a-z0-9]+', '-', 'g'))
where e.kind = 'practice_result'
  and e.raw_text is not null
  and e.raw_text ~ '^\s*\{'
  and nullif(trim(e.raw_text::jsonb ->> 'subject'), '') is not null
on conflict (evidence_id, category_id) do nothing;
