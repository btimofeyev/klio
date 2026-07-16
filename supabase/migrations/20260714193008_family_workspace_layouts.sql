-- Family-scoped spatial desk positions shared across the parent's devices.

create table public.family_workspace_layouts (
  family_id uuid not null references public.families(id) on delete cascade,
  surface text not null check (surface in ('day', 'week')),
  scope_key text not null check (char_length(scope_key) between 1 and 64),
  layout_version smallint not null check (layout_version between 1 and 100),
  positions jsonb not null default '{}'::jsonb check (jsonb_typeof(positions) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, surface, scope_key)
);

create trigger family_workspace_layouts_set_updated_at
before update on public.family_workspace_layouts
for each row execute function private.set_updated_at();

alter table public.family_workspace_layouts enable row level security;

create policy "workspace layouts visible to family"
on public.family_workspace_layouts for select to authenticated
using ((select private.is_family_member(family_id)));

create policy "workspace layouts insertable by editors"
on public.family_workspace_layouts for insert to authenticated
with check ((select private.can_edit_family(family_id)) and updated_by = (select auth.uid()));

create policy "workspace layouts editable by editors"
on public.family_workspace_layouts for update to authenticated
using ((select private.can_edit_family(family_id)))
with check ((select private.can_edit_family(family_id)) and updated_by = (select auth.uid()));

grant select, insert, update on public.family_workspace_layouts to authenticated;
grant all on public.family_workspace_layouts to service_role;

comment on table public.family_workspace_layouts is
  'Versioned, family-scoped positions for the Today and Week spatial workspaces; camera position remains device-local.';
