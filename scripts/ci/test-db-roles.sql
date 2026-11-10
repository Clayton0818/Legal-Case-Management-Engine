-- Prepares a throwaway Postgres to look like the staging Supabase project
-- before migrations run (used by the "Full pipeline" CI job and runnable
-- locally). Supabase ships these roles and default privileges; plain
-- Postgres does not, and several migrations depend on them:
--   - app_runtime: the role the app connects as (never a superuser and
--     never a table owner, so row-level security applies to it).
--   - anon / authenticated: Supabase's REST roles, which migrations 0004,
--     0005 and 0009 explicitly REVOKE from.
--   - Supabase's public schema grants new tables to these roles by default
--     (noted in migrations/0005), so every restriction in the migrations is
--     an explicit REVOKE. Mirroring that default here means the REVOKEs are
--     tested exactly as they behave on staging.
-- Test-only credentials: this database is created and destroyed by the job.
CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_test_only';
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_runtime, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime, anon, authenticated;
