// Schema drift check: does the database have every table and column the code
// expects?
//
// Engine PRs add tables and columns to the Drizzle schema (src/db/schema.ts,
// src/db/tables/*.ts) and leave MIGRATION NOTES instead of a migration; the
// migration is generated centrally later. If that step is missed, the code
// queries a column the database does not have, which is exactly how the demo
// seed broke in November 2026 ("column delivery_status of relation
// document_groups does not exist"). This script turns that into a CI failure
// the moment it happens.
//
// Usage: MIGRATIONS_DATABASE_URL=postgres://... npx tsx scripts/check-schema-drift.ts
// (any role that can read information_schema works; the CI job points it at
// a database built only from migrations/, so a miss means a missing migration).
//
// Reports tables/columns in the code but not in the database. Extra objects in
// the database (dropped from the code but still present) are listed as a
// warning only, since removing them needs a deliberate migration.

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

const here = dirname(fileURLToPath(import.meta.url));
const dbDir = join(here, "..", "src", "db");

async function loadSchemaTables(): Promise<Map<string, Set<string>>> {
  const files = [join(dbDir, "schema.ts"), ...readdirSync(join(dbDir, "tables")).filter((f) => f.endsWith(".ts")).map((f) => join(dbDir, "tables", f))];
  const tables = new Map<string, Set<string>>();
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (!is(value, PgTable)) continue;
      const cfg = getTableConfig(value);
      if (cfg.schema && cfg.schema !== "public") continue;
      tables.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
    }
  }
  return tables;
}

async function main() {
  const url = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set MIGRATIONS_DATABASE_URL (or DATABASE_URL) to the database to check.");

  const expected = await loadSchemaTables();
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const rows = await sql<{ table_name: string; column_name: string }[]>`
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`;
  await sql.end();

  const actual = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
    actual.get(r.table_name)!.add(r.column_name);
  }

  const missing: string[] = [];
  for (const [table, cols] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
    const have = actual.get(table);
    if (!have) {
      missing.push(`table ${table} (whole table missing)`);
      continue;
    }
    for (const col of [...cols].sort()) if (!have.has(col)) missing.push(`column ${table}.${col}`);
  }

  const extra: string[] = [];
  for (const [table, cols] of actual) {
    if (table.startsWith("__drizzle")) continue;
    const want = expected.get(table);
    if (!want) {
      extra.push(`table ${table}`);
      continue;
    }
    for (const col of cols) if (!want.has(col)) extra.push(`column ${table}.${col}`);
  }

  console.log(`[schema-drift] ${expected.size} tables in the code, ${actual.size} in the database.`);
  if (extra.length) console.log(`[schema-drift] warning: in the database but not in the code (${extra.length}):\n  ${extra.join("\n  ")}`);
  if (missing.length) {
    console.error(
      `[schema-drift] FAIL: the code expects ${missing.length} table(s)/column(s) the migrations never create:\n  ${missing.join("\n  ")}\n` +
        "Generate a migration for them (npm run db:generate), add the hand-written RLS/GRANT section from each table file's MIGRATION NOTES, and apply it to staging."
    );
    process.exit(1);
  }
  console.log("[schema-drift] OK: every table and column in the code exists in the database.");
}

main().catch((err) => {
  console.error("[schema-drift] failed:", err);
  process.exit(1);
});
