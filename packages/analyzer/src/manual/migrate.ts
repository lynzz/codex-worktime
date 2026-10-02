import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import { getDb } from "@codex-worktime/timesheet-server";
import { z } from "zod";

// Stop before NOT NULL until the existing rows have been explicitly claimed.
export async function migrateManualAccounts(
  phase: string,
  { adoptExistingCreatedAt = false }: { adoptExistingCreatedAt?: boolean } = {},
): Promise<{ phase: string; applied: number }> {
  const tag = phase === "nullable" ? "0003_accounts-nullable"
    : phase === "owned" ? "0004_accounts-owned"
    : phase === "reports" ? "0006_report-collectors" : null;
  if (!tag) throw new Error("迁移 phase 应为 nullable、owned 或 reports");
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../timesheet-server/drizzle");
  const journal = z.object({
    entries: z.array(z.object({ tag: z.string() })),
  }).parse(JSON.parse(await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8")));
  const cutoff = journal.entries.findIndex((entry) => entry.tag === tag);
  if (cutoff < 0) throw new Error("找不到所选迁移文件");
  const migrations = readMigrationFiles({ migrationsFolder }).slice(0, cutoff + 1);
  const db = getDb();
  await db.batch([
    db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`),
    db.execute(sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )`),
  ]);
  const recorded = await db.execute(sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`);
  const latest = Number(recorded.rows[0]?.created_at ?? 0);
  const pending = migrations.filter((migration) => migration.folderMillis > latest);
  if (pending.length === 0) return { phase, applied: 0 };
  const statements = [db.execute(sql`LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE`)];
  for (const migration of pending) {
    const index = migrations.indexOf(migration);
    if (adoptExistingCreatedAt && journal.entries[index]?.tag === "0002_entries-created-at") {
      // Explicitly adopt only the exact existing migration result, never a partial schema.
      statements.push(db.execute(sql`LOCK TABLE entries IN SHARE MODE`));
      statements.push(db.execute(sql`SELECT 1 / CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'entries' AND column_name = 'created_at'
          AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
          AND column_default = 'now()'
      ) THEN 1 ELSE 0 END AS existing_created_at_matches`));
    } else {
      for (const statement of migration.sql) statements.push(db.execute(sql.raw(statement)));
    }
    statements.push(db.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`));
  }
  // Neon HTTP cannot use an interactive transaction; batch makes the phase atomic.
  await db.batch([statements[0]!, ...statements.slice(1)]);
  return { phase, applied: pending.length };
}
