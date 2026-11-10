# Full-pipeline checks

`scripts/ci/pipeline.yml` ("Full pipeline") runs these on every PR, against a
throwaway Postgres built only from `migrations/`. Nothing touches staging and no
secrets are used.

**To switch it on:** copy `scripts/ci/pipeline.yml` to `.github/workflows/pipeline.yml`
(on GitHub: Add file → Create new file, name it `.github/workflows/pipeline.yml`,
paste, commit). The automation that wrote this is not allowed to edit
`.github/workflows` itself.

| Step | What it proves | Script |
|---|---|---|
| Roles | The database looks like Supabase (app_runtime, anon, authenticated, default grants) | `test-db-roles.sql` |
| Migrations | Every migration applies cleanly from scratch | `npm run db:migrate` |
| Schema drift | Every table and column in the code exists after migrating | `../check-schema-drift.ts` |
| Tests | The whole suite, including the database-backed tests the unit job skips | `npm test` with `REQUIRE_DATABASE_TESTS=1` |
| Demo seed | Every engine works through its real services; any failed step fails | `check-demo-seed.ts` |
| Walkthrough | A browser opens every page and API link in the demo walkthrough; screenshots are uploaded | `walkthrough.mjs` |

Steps that are "blocked" in the seed are waiting on an attorney/CPA/vendor approval
and are expected. API links that answer 401/403 ("sign-in required") are listed but
do not fail the job until real login (board card c34) exists.

## Run it locally

```bash
# a scratch Postgres 16 on port 5433 (any empty database works)
psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -f scripts/ci/test-db-roles.sql
export MIGRATIONS_DATABASE_URL=postgresql://postgres@localhost:5433/postgres
export DATABASE_URL=postgresql://app_runtime:app_runtime_test_only@localhost:5433/postgres
export DEMO_RESET_ENABLED=1 DEV_TENANT_ID=current-demo DEV_DEMO_USER=partner DOCUMENT_STORAGE=memory
npm run db:migrate
npx tsx scripts/check-schema-drift.ts
REQUIRE_DATABASE_TESTS=1 npm test
npx tsx scripts/ci/check-demo-seed.ts
npm run build && npx next start -p 3100 &
npm install --no-save playwright@1.49.1 && npx playwright install chromium
BASE_URL=http://localhost:3100 node scripts/ci/walkthrough.mjs
```

Never point these at staging or production: the role script creates roles, and the
seed creates a demo firm.
