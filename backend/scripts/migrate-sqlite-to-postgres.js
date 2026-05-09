/**
 * One-off: copy all rows from local SQLite (lifeos.db) into Postgres (DATABASE_URL).
 *
 * Preview (counts only + test Postgres; no writes):
 *   npm run migrate:sqlite-to-pg --workspace=backend
 *
 * Actually migrate (truncates target Postgres tables, then copies SQLite):
 *   npm run migrate:sqlite-to-pg --workspace=backend -- --apply
 *
 * Custom SQLite file:
 *   SQLITE_SOURCE=/path/to/lifeos.db npm run migrate:sqlite-to-pg --workspace=backend -- --apply
 *
 * Requires root .env or env: DATABASE_URL, and a readable SQLite file
 * (defaults to <repo>/data/lifeos.db, or SQLITE_PATH / DATA_DIR used by the app).
 */
import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const sqliteArg = args.find((a) => a.startsWith("--sqlite="));
const sqliteOverride = sqliteArg?.slice("--sqlite=".length)?.trim();

function resolveSqlitePath() {
  if (sqliteOverride) return path.resolve(sqliteOverride);
  const src = process.env.SQLITE_SOURCE?.trim();
  if (src) return path.resolve(src);
  const sp = process.env.SQLITE_PATH?.trim();
  if (sp) return path.resolve(sp);
  const dataDir = process.env.DATA_DIR?.trim();
  if (dataDir) return path.join(path.resolve(dataDir), "lifeos.db");
  return path.join(repoRoot, "data", "lifeos.db");
}

function tableExistsSqlite(db, name) {
  const r = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return Boolean(r);
}

async function main() {
  dotenv.config({ path: path.resolve(repoRoot, ".env") });
  const { PG_SCHEMA } = await import("../src/lifeosDb.js");

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.error("Set DATABASE_URL (Supabase / Postgres connection string).");
    process.exit(1);
  }

  const sqlitePath = resolveSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    console.error(`SQLite file not found: ${sqlitePath}`);
    process.exit(1);
  }

  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = new pg.Pool({ connectionString: dbUrl, max: 5 });

  const tables = [
    "app_settings",
    "days",
    "todos",
    "standup_history",
    "pending_followup",
    "job_applications",
  ];

  console.info(`Source SQLite: ${sqlitePath}`);

  if (!apply) {
    try {
      await pool.query("SELECT 1");
      console.info("Postgres (DATABASE_URL): connection OK.");
    } catch (e) {
      console.error("Postgres connection failed:", e.message);
      sqlite.close();
      await pool.end();
      process.exit(1);
    }
    for (const t of tables) {
      if (!tableExistsSqlite(sqlite, t)) {
        console.info(`  ${t}: (missing table in SQLite)`);
        continue;
      }
      const { c } = sqlite.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
      console.info(`  ${t}: ${c} row(s)`);
    }
    sqlite.close();
    await pool.end();
    console.info("\nNo writes performed. Re-run with --apply to TRUNCATE Postgres and copy SQLite → Postgres.");
    return;
  }

  const client = await pool.connect();
  try {
    console.warn(
      "Applying migration: Postgres tables will be TRUNCATED and replaced from SQLite. Ensure Supabase is backed up if needed."
    );

    await client.query("BEGIN");
    await client.query(PG_SCHEMA);
    await client.query(
      "TRUNCATE app_settings, days, todos, standup_history, pending_followup, job_applications"
    );

    if (tableExistsSqlite(sqlite, "app_settings")) {
      const rows = sqlite.prepare("SELECT key, value FROM app_settings").all();
      for (const r of rows) {
        await client.query("INSERT INTO app_settings (key, value) VALUES ($1, $2)", [r.key, r.value]);
      }
      console.info(`app_settings: ${rows.length}`);
    }

    if (tableExistsSqlite(sqlite, "days")) {
      const rows = sqlite.prepare("SELECT date, json FROM days").all();
      for (const r of rows) {
        await client.query("INSERT INTO days (date, json) VALUES ($1, $2)", [r.date, r.json]);
      }
      console.info(`days: ${rows.length}`);
    }

    if (tableExistsSqlite(sqlite, "todos")) {
      const rows = sqlite.prepare(`SELECT * FROM todos`).all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO todos (id, title, important, urgent, when_date, needs_clarification, status, source_day, created_at, follow_up_sent,
                              ord_priority, ord_schedule, ord_quick, ord_backlog, ord_unsorted)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            r.id,
            r.title,
            r.important,
            r.urgent,
            r.when_date,
            r.needs_clarification,
            r.status,
            r.source_day,
            r.created_at,
            r.follow_up_sent,
            r.ord_priority ?? null,
            r.ord_schedule ?? null,
            r.ord_quick ?? null,
            r.ord_backlog ?? null,
            r.ord_unsorted ?? null,
          ]
        );
      }
      console.info(`todos: ${rows.length}`);
    }

    if (tableExistsSqlite(sqlite, "standup_history")) {
      const rows = sqlite.prepare("SELECT id, text, at, source FROM standup_history").all();
      for (const r of rows) {
        await client.query(
          "INSERT INTO standup_history (id, text, at, source) VALUES ($1, $2, $3, $4)",
          [r.id, r.text, r.at, r.source]
        );
      }
      console.info(`standup_history: ${rows.length}`);
    }

    if (tableExistsSqlite(sqlite, "pending_followup")) {
      const rows = sqlite.prepare("SELECT singleton, json FROM pending_followup").all();
      for (const r of rows) {
        await client.query("INSERT INTO pending_followup (singleton, json) VALUES ($1, $2)", [
          r.singleton,
          r.json,
        ]);
      }
      console.info(`pending_followup: ${rows.length}`);
    }

    if (tableExistsSqlite(sqlite, "job_applications")) {
      const rows = sqlite
        .prepare(
          `SELECT id, company, role, status, applied_date, last_updated, notes, sheet_row, synced_at
           FROM job_applications`
        )
        .all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO job_applications (id, company, role, status, applied_date, last_updated, notes, sheet_row, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            r.id,
            r.company,
            r.role,
            r.status,
            r.applied_date,
            r.last_updated,
            r.notes,
            r.sheet_row,
            r.synced_at ?? "",
          ]
        );
      }
      console.info(`job_applications: ${rows.length}`);
    }

    await client.query("COMMIT");
    console.info("Done. Verify with GET /api/state on the Fly app (or psql).");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Migration failed:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

main();
