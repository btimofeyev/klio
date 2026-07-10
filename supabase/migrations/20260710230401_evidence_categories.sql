create table public.categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  created_by_type text not null default 'agent' check (created_by_type in ('agent', 'parent')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, slug)
);

create index categories_family_id_idx on public.categories(family_id);

create table public.evidence_categories (
  family_id uuid not null references public.families(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  assigned_by text not null default 'agent' check (assigned_by in ('agent', 'parent')),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  document_type text check (document_type is null or char_length(document_type) between 1 and 80),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (evidence_id, category_id)
);

create index evidence_categories_family_id_idx on public.evidence_categories(family_id);
create index evidence_categories_category_id_idx on public.evidence_categories(category_id);

create trigger set_categories_updated_at
before update on public.categories
for each row execute function private.set_updated_at();

alter table public.categories enable row level security;
alter table public.evidence_categories enable row level security;

create policy "family members can view categories"
on public.categories for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "family editors can create categories"
on public.categories for insert to authenticated
with check ((select private.can_edit_family(family_id)));

create policy "family editors can update categories"
on public.categories for update to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)));

create policy "family editors can delete categories"
on public.categories for delete to authenticated
using ((select private.can_edit_family(family_id)));

create policy "family members can view evidence categories"
on public.evidence_categories for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "family editors can create evidence categories"
on public.evidence_categories for insert to authenticated
with check (
  (select private.can_edit_family(family_id))
  and exists (
    select 1 from public.evidence_items e
    where e.id = evidence_id and e.family_id = family_id
  )
  and exists (
    select 1 from public.categories c
    where c.id = category_id and c.family_id = family_id
  )
);

create policy "family editors can update evidence categories"
on public.evidence_categories for update to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)));

create policy "family editors can delete evidence categories"
on public.evidence_categories for delete to authenticated
using ((select private.can_edit_family(family_id)));

grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.evidence_categories to authenticated;
