-- Supabase's current local default does not auto-expose newly created tables.
-- The browser roles stay explicitly least-privileged; the server-only secret role
-- needs database privileges in addition to its RLS bypass for agent/audit work.
grant usage on schema public, private to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema private to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema private grant execute on functions to service_role;
