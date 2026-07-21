alter table public.curriculum_units
  drop constraint if exists curriculum_units_scope_source_kind_check;

alter table public.curriculum_units
  add constraint curriculum_units_scope_source_kind_check
  check (scope_source_kind in ('generic', 'model_prior', 'web_search', 'parent_evidence', 'curated_catalog'));

alter table public.curriculum_scope_suggestions
  drop constraint if exists curriculum_scope_suggestions_identity_status_check,
  drop constraint if exists curriculum_scope_suggestions_source_kind_check;

alter table public.curriculum_scope_suggestions
  add constraint curriculum_scope_suggestions_identity_status_check
    check (identity_status in ('generic', 'recognized', 'verified')),
  add constraint curriculum_scope_suggestions_source_kind_check
    check (source_kind in ('model_prior', 'web_search', 'parent_evidence', 'curated_catalog')),
  add column if not exists source_urls jsonb not null default '[]'::jsonb;

alter table public.curriculum_scope_suggestions
  drop constraint if exists curriculum_scope_suggestions_source_urls_check;

alter table public.curriculum_scope_suggestions
  add constraint curriculum_scope_suggestions_source_urls_check
  check (
    jsonb_typeof(source_urls) = 'array'
    and jsonb_array_length(source_urls) <= 20
    and pg_column_size(source_urls) <= 32768
  );

comment on column public.curriculum_scope_suggestions.source_urls is
  'Parent-visible web sources used to ground a curriculum outline proposal.';
