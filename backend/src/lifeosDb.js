import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import pg from "pg";
import { DEFAULT_STATE, normalizeStateShape } from "./stateModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const usePostgres = Boolean(process.env.DATABASE_URL?.trim());

export const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  important INTEGER,
  urgent INTEGER,
  when_date TEXT,
  needs_clarification INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  source_day TEXT,
  created_at TEXT,
  follow_up_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS standup_history (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_followup (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  json TEXT
);

CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  company TEXT,
  role TEXT,
  status TEXT,
  applied_date TEXT,
  last_updated TEXT,
  notes TEXT,
  sheet_row INTEGER,
  synced_at TEXT NOT NULL
);
`;

/** Directory for SQLite (and optional legacy state.json). Override with DATA_DIR. Ignored when DATABASE_URL is set. */
export function getDataDir() {
  const raw = process.env.DATA_DIR?.trim();
  return raw ? path.resolve(raw) : path.join(projectRoot, "data");
}

/** @deprecated Postgres path ignores this; SQLite only. */
export function getDbPath() {
  const raw = process.env.SQLITE_PATH?.trim();
  return raw ? path.resolve(raw) : path.join(getDataDir(), "lifeos.db");
}

/** Legacy JSON path (migrated once into DB if tables are empty). */
export function getLegacyStatePath() {
  return path.join(__dirname, "../state.json");
}

export function isPostgresMode() {
  return usePostgres;
}

let pgPool = null;

/** @returns {Promise<pg.Pool>} */
export async function getPool() {
  if (!usePostgres) {
    throw new Error("DATABASE_URL not set — use SQLite getDb()");
  }
  if (!pgPool) {
    pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pgPool.on("error", (err) => console.error("[lifeosDb] pg pool idle client error:", err.message));
  }
  return pgPool;
}

async function initPgSchema(pool) {
  await pool.query(PG_SCHEMA);
}

// --- SQLite (local dev / no DATABASE_URL) ---

let sqliteInstance = null;

function initSqliteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS days (
      date TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      important INTEGER,
      urgent INTEGER,
      when_date TEXT,
      needs_clarification INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      source_day TEXT,
      created_at TEXT,
      follow_up_sent INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS standup_history (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      at TEXT NOT NULL,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_followup (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      json TEXT
    );

    CREATE TABLE IF NOT EXISTS job_applications (
      id TEXT PRIMARY KEY,
      company TEXT,
      role TEXT,
      status TEXT,
      applied_date TEXT,
      last_updated TEXT,
      notes TEXT,
      sheet_row INTEGER,
      synced_at TEXT NOT NULL
    );
  `);
}

function migrateSqliteColumns(db) {
  const tableColumns = (table) =>
    new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  const ensureCol = (table, col, ddlFragment) => {
    if (
      !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    ) {
      return;
    }
    const cols = tableColumns(table);
    if (cols.has(col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddlFragment}`);
  };

  for (const col of [
    ["todos", "important", "INTEGER"],
    ["todos", "urgent", "INTEGER"],
    ["todos", "when_date", "TEXT"],
    ["todos", "needs_clarification", "INTEGER NOT NULL DEFAULT 0"],
    ["todos", "status", "TEXT NOT NULL DEFAULT 'active'"],
    ["todos", "source_day", "TEXT"],
    ["todos", "created_at", "TEXT"],
    ["todos", "follow_up_sent", "INTEGER NOT NULL DEFAULT 0"],
    ["job_applications", "sheet_row", "INTEGER"],
    ["job_applications", "synced_at", "TEXT NOT NULL DEFAULT ''"],
    ["job_applications", "notes", "TEXT"],
    ["job_applications", "last_updated", "TEXT"],
    ["job_applications", "applied_date", "TEXT"],
    ["job_applications", "status", "TEXT"],
    ["job_applications", "role", "TEXT"],
    ["job_applications", "company", "TEXT"],
  ]) {
    ensureCol(col[0], col[1], col[2]);
  }
}

function migrateFromLegacyJsonIfNeededSqlite(db) {
  const dayCount = db.prepare("SELECT COUNT(*) AS c FROM days").get().c;
  const todoCount = db.prepare("SELECT COUNT(*) AS c FROM todos").get().c;
  const jobRows = db.prepare("SELECT COUNT(*) AS c FROM job_applications").get().c;
  if (dayCount > 0 || todoCount > 0 || jobRows > 0) return false;

  const legacyPath = getLegacyStatePath();
  if (!fs.existsSync(legacyPath)) return false;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch {
    console.warn("[lifeosDb] Could not parse legacy state.json — skipping migration.");
    return false;
  }

  const state = normalizeStateShape(raw);
  const tx = db.transaction(() => {
    for (const [dateKey, day] of Object.entries(state.days || {})) {
      db.prepare("INSERT INTO days (date, json) VALUES (?, ?)").run(dateKey, JSON.stringify(day));
    }
    for (const t of state.todos || []) {
      insertTodoRowSqlite(db, t);
    }
    for (const h of state.standupHistory || []) {
      db.prepare("INSERT INTO standup_history (id, text, at, source) VALUES (?, ?, ?, ?)").run(
        h.id,
        h.text,
        h.at,
        h.source || "unknown"
      );
    }
    if (state.pendingFollowUp) {
      db.prepare("INSERT OR REPLACE INTO pending_followup (singleton, json) VALUES (1, ?)").run(
        JSON.stringify(state.pendingFollowUp)
      );
    }
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
      "gemini_paused",
      state.geminiPaused ? "true" : "false"
    );
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
      "version",
      String(state.version || 2)
    );
  });
  tx();
  console.info("[lifeosDb] Migrated legacy backend/state.json into SQLite.");
  return true;
}

async function migrateFromLegacyJsonIfNeededPg(pool) {
  const c = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM days) AS d,
       (SELECT COUNT(*)::int FROM todos) AS t,
       (SELECT COUNT(*)::int FROM job_applications) AS j`
  );
  const row = c.rows[0];
  if (row.d > 0 || row.t > 0 || row.j > 0) return false;

  const legacyPath = getLegacyStatePath();
  if (!fs.existsSync(legacyPath)) return false;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch {
    console.warn("[lifeosDb] Could not parse legacy state.json — skipping Postgres migration.");
    return false;
  }

  const state = normalizeStateShape(raw);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [dateKey, day] of Object.entries(state.days || {})) {
      await client.query("INSERT INTO days (date, json) VALUES ($1, $2)", [
        dateKey,
        JSON.stringify(day),
      ]);
    }
    for (const t of state.todos || []) {
      await insertTodoRowPg(client, t);
    }
    for (const h of state.standupHistory || []) {
      await client.query(
        "INSERT INTO standup_history (id, text, at, source) VALUES ($1, $2, $3, $4)",
        [h.id, h.text, h.at, h.source || "unknown"]
      );
    }
    if (state.pendingFollowUp) {
      await client.query(
        "INSERT INTO pending_followup (singleton, json) VALUES (1, $1) ON CONFLICT (singleton) DO UPDATE SET json = EXCLUDED.json",
        [JSON.stringify(state.pendingFollowUp)]
      );
    }
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('gemini_paused', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [state.geminiPaused ? "true" : "false"]
    );
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(state.version || 2)]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  console.info("[lifeosDb] Migrated legacy backend/state.json into Postgres.");
  return true;
}

function insertTodoRowSqlite(db, t) {
  db.prepare(
    `INSERT INTO todos (id, title, important, urgent, when_date, needs_clarification, status, source_day, created_at, follow_up_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    t.id,
    t.title,
    t.important === null || t.important === undefined ? null : t.important ? 1 : 0,
    t.urgent === null || t.urgent === undefined ? null : t.urgent ? 1 : 0,
    t.when ?? null,
    t.needsClarification ? 1 : 0,
    t.status || "active",
    t.sourceDay ?? null,
    t.createdAt ?? null,
    t.followUpSent ? 1 : 0
  );
}

async function insertTodoRowPg(client, t) {
  await client.query(
    `INSERT INTO todos (id, title, important, urgent, when_date, needs_clarification, status, source_day, created_at, follow_up_sent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      t.id,
      t.title,
      t.important === null || t.important === undefined ? null : t.important ? 1 : 0,
      t.urgent === null || t.urgent === undefined ? null : t.urgent ? 1 : 0,
      t.when ?? null,
      t.needsClarification ? 1 : 0,
      t.status || "active",
      t.sourceDay ?? null,
      t.createdAt ?? null,
      t.followUpSent ? 1 : 0,
    ]
  );
}

/**
 * SQLite handle only. Throws if DATABASE_URL is set — use {@link getPool} for Postgres.
 * @deprecated Prefer async APIs and {@link initLifeosDatabase}.
 */
export function getDb() {
  if (usePostgres) {
    throw new Error("DATABASE_URL is set — Postgres mode; do not call getDb(). Use pool-based APIs.");
  }
  return getSqliteInternal();
}

function getSqliteInternal() {
  if (sqliteInstance) return sqliteInstance;
  const dir = getDataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    const hint =
      e && e.code === "EACCES"
        ? " Fix: use a writable DATA_DIR/SQLITE_PATH, or unset them for local dev (<repo>/data)."
        : "";
    throw new Error(`Cannot create data directory ${dir}.${hint}`, { cause: e });
  }
  const dbPath = getDbPath();
  sqliteInstance = new Database(dbPath);
  sqliteInstance.pragma("journal_mode = WAL");
  initSqliteSchema(sqliteInstance);
  migrateSqliteColumns(sqliteInstance);
  migrateFromLegacyJsonIfNeededSqlite(sqliteInstance);
  ensureSeededSqlite(sqliteInstance);
  return sqliteInstance;
}

/** Call once before serving traffic. Idempotent for SQLite opens DB; Postgres runs schema + seed. */
export async function initLifeosDatabase() {
  if (usePostgres) {
    const pool = await getPool();
    await initPgSchema(pool);
    await migrateFromLegacyJsonIfNeededPg(pool);
    await ensureSeededPg(pool);
    console.info("[lifeosDb] Postgres mode (DATABASE_URL).");
    return;
  }
  getSqliteInternal();
  console.info("[lifeosDb] SQLite mode (no DATABASE_URL).");
}

/** 4-digit year present — otherwise Date.parse is unreliable (e.g. "Dec 06" → year 2001 in V8). */
const SHEET_DATE_YEAR_RE = /\b(19|20)\d{2}\b/;

/** 1-based sheet row ≥ this → ambiguous applied_date(no year in cell) = JOB_APPLIED_YEAR_2026 (default 2026). */
function jobApplied2026FromRow() {
  const n = Number(process.env.JOB_APPLIED_2026_FROM_ROW?.trim());
  return Number.isFinite(n) ? n : 3276;
}

/** 1-based sheet row ≥ this and below 2026 cutoff → JOB_APPLIED_YEAR_2025 (default 2025). Below → 2024 cohort. */
function jobApplied2025FromRow() {
  const n = Number(process.env.JOB_APPLIED_2025_FROM_ROW?.trim());
  return Number.isFinite(n) ? n : 2800;
}

function jobAppliedPinnedYear2026() {
  const n = Number(process.env.JOB_APPLIED_YEAR_2026?.trim());
  return Number.isFinite(n) ? n : 2026;
}

function jobAppliedPinnedYear2025() {
  const n = Number(process.env.JOB_APPLIED_YEAR_2025?.trim());
  return Number.isFinite(n) ? n : 2025;
}

function jobAppliedPinnedYear2024() {
  const n = Number(process.env.JOB_APPLIED_YEAR_2024?.trim());
  return Number.isFinite(n) ? n : 2024;
}

/**
 * Cohort-pinned year for sheet free-text dates (no heuristic).
 * - Explicit 4-digit year in the cell → Date.parse only.
 * - Row ≥ JOB_APPLIED_2026_FROM_ROW (default 3276) → text + YEAR_2026.
 * - Row in [JOB_APPLIED_2025_FROM_ROW (2800), 3276) → text + YEAR_2025.
 * - Row < 2800 → text + YEAR_2024.
 */
function parseSheetDateForSort(raw, sheetRow) {
  const s = String(raw ?? "").trim();
  if (!s) return NaN;

  if (SHEET_DATE_YEAR_RE.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? NaN : t;
  }

  const rowNum = Number(sheetRow);
  if (!Number.isFinite(rowNum)) return NaN;

  const r2026 = jobApplied2026FromRow();
  const r2025 = jobApplied2025FromRow();

  let pinnedYear;
  if (rowNum >= r2026) pinnedYear = jobAppliedPinnedYear2026();
  else if (rowNum >= r2025) pinnedYear = jobAppliedPinnedYear2025();
  else pinnedYear = jobAppliedPinnedYear2024();

  const t = Date.parse(`${s} ${pinnedYear}`);
  return Number.isNaN(t) ? NaN : t;
}

/** Sort by applied_date only; ties → higher sheet_row first. last_updated is synced but not used here. */
function sortJobApplicationDbRows(rows) {
  const bestTime = (r) => {
    const v = r.applied_date;
    if (v == null || v === "") return 0;
    const t = parseSheetDateForSort(v, r.sheet_row);
    return Number.isNaN(t) ? 0 : t;
  };
  return [...rows].sort((a, b) => {
    const tb = bestTime(b);
    const ta = bestTime(a);
    if (tb !== ta) return tb - ta;
    return (Number(b.sheet_row) || 0) - (Number(a.sheet_row) || 0);
  });
}

function mapJobApplicationDbRow(r) {
  return {
    id: r.id,
    company: r.company,
    role: r.role,
    status: r.status,
    appliedDate: r.applied_date,
    lastUpdated: r.last_updated,
    notes: r.notes,
    sheetRow: r.sheet_row,
    syncedAt: r.synced_at,
  };
}

export function todoRowToJs(r) {
  return {
    id: r.id,
    title: r.title,
    important: r.important === null || r.important === undefined ? null : Number(r.important) === 1,
    urgent: r.urgent === null || r.urgent === undefined ? null : Number(r.urgent) === 1,
    when: r.when_date,
    needsClarification: Number(r.needs_clarification) === 1,
    status: r.status,
    sourceDay: r.source_day,
    createdAt: r.created_at,
    followUpSent: Number(r.follow_up_sent) === 1,
  };
}

function loadFullStateFromDbSqlite(db) {
  const days = {};
  for (const r of db.prepare("SELECT date, json FROM days").all()) {
    try {
      days[r.date] = JSON.parse(r.json);
    } catch {
      days[r.date] = {};
    }
  }

  const todos = db
    .prepare(
      `SELECT id, title, important, urgent, when_date, needs_clarification, status, source_day, created_at, follow_up_sent
       FROM todos WHERE status = 'active' ORDER BY created_at`
    )
    .all()
    .map(todoRowToJs);

  const pendingRow = db.prepare("SELECT json FROM pending_followup WHERE singleton = 1").get();
  let pendingFollowUp = null;
  if (pendingRow?.json) {
    try {
      pendingFollowUp = JSON.parse(pendingRow.json);
    } catch {
      pendingFollowUp = null;
    }
  }

  const standupHistory = db
    .prepare("SELECT id, text, at, source FROM standup_history ORDER BY at")
    .all()
    .map((h) => ({ id: h.id, text: h.text, at: h.at, source: h.source }));

  const geminiPaused =
    db.prepare("SELECT value FROM app_settings WHERE key = 'gemini_paused'").get()?.value === "true";

  const versionRow = db.prepare("SELECT value FROM app_settings WHERE key = 'version'").get();
  const version = versionRow ? Number(versionRow.value) || 2 : 2;

  const jobRows = db
    .prepare(
      `SELECT id, company, role, status, applied_date, last_updated, notes, sheet_row, synced_at
       FROM job_applications`
    )
    .all();
  const jobApplications = sortJobApplicationDbRows(jobRows).map(mapJobApplicationDbRow);

  return normalizeStateShape({
    version,
    days,
    todos,
    pendingFollowUp,
    standupHistory,
    geminiPaused,
    jobApplications,
  });
}

async function loadFullStateFromDbPg(pool) {
  const [
    daysR,
    todosR,
    pendingR,
    histR,
    gemR,
    verR,
    jobsR,
  ] = await Promise.all([
    pool.query("SELECT date, json FROM days"),
    pool.query(
      `SELECT id, title, important, urgent, when_date, needs_clarification, status, source_day, created_at, follow_up_sent
       FROM todos WHERE status = 'active' ORDER BY created_at NULLS LAST`
    ),
    pool.query("SELECT json FROM pending_followup WHERE singleton = 1"),
    pool.query("SELECT id, text, at, source FROM standup_history ORDER BY at"),
    pool.query("SELECT value FROM app_settings WHERE key = 'gemini_paused'"),
    pool.query("SELECT value FROM app_settings WHERE key = 'version'"),
    pool.query(
      `SELECT id, company, role, status, applied_date, last_updated, notes, sheet_row, synced_at
       FROM job_applications`
    ),
  ]);

  const days = {};
  for (const r of daysR.rows) {
    try {
      days[r.date] = JSON.parse(r.json);
    } catch {
      days[r.date] = {};
    }
  }

  const todos = todosR.rows.map(todoRowToJs);
  let pendingFollowUp = null;
  const pr = pendingR.rows[0];
  if (pr?.json) {
    try {
      pendingFollowUp = JSON.parse(pr.json);
    } catch {
      pendingFollowUp = null;
    }
  }

  const standupHistory = histR.rows.map((h) => ({
    id: h.id,
    text: h.text,
    at: h.at,
    source: h.source,
  }));

  const geminiPaused = gemR.rows[0]?.value === "true";
  const verRow = verR.rows[0];
  const version = verRow ? Number(verRow.value) || 2 : 2;

  const jobApplications = sortJobApplicationDbRows(jobsR.rows).map(mapJobApplicationDbRow);

  return normalizeStateShape({
    version,
    days,
    todos,
    pendingFollowUp,
    standupHistory,
    geminiPaused,
    jobApplications,
  });
}

export async function loadFullStateFromDb() {
  if (usePostgres) {
    const pool = await getPool();
    return loadFullStateFromDbPg(pool);
  }
  return loadFullStateFromDbSqlite(getSqliteInternal());
}

function replaceFullStateSqlite(db, state) {
  const normalized = normalizeStateShape(state);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM todos").run();
    for (const t of normalized.todos) {
      insertTodoRowSqlite(db, t);
    }
    db.prepare("DELETE FROM days").run();
    for (const [dateKey, day] of Object.entries(normalized.days)) {
      db.prepare("INSERT INTO days (date, json) VALUES (?, ?)").run(dateKey, JSON.stringify(day));
    }
    db.prepare("DELETE FROM standup_history").run();
    for (const h of normalized.standupHistory) {
      db.prepare("INSERT INTO standup_history (id, text, at, source) VALUES (?, ?, ?, ?)").run(
        h.id,
        h.text,
        h.at,
        h.source || "unknown"
      );
    }
    db.prepare("DELETE FROM pending_followup").run();
    if (normalized.pendingFollowUp) {
      db.prepare("INSERT OR REPLACE INTO pending_followup (singleton, json) VALUES (1, ?)").run(
        JSON.stringify(normalized.pendingFollowUp)
      );
    }
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
      "gemini_paused",
      normalized.geminiPaused ? "true" : "false"
    );
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
      "version",
      String(normalized.version || 2)
    );
  });
  tx();
}

async function replaceFullStatePg(pool, state) {
  const normalized = normalizeStateShape(state);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM todos");
    for (const t of normalized.todos) {
      await insertTodoRowPg(client, t);
    }
    await client.query("DELETE FROM days");
    for (const [dateKey, day] of Object.entries(normalized.days)) {
      await client.query("INSERT INTO days (date, json) VALUES ($1, $2)", [
        dateKey,
        JSON.stringify(day),
      ]);
    }
    await client.query("DELETE FROM standup_history");
    for (const h of normalized.standupHistory) {
      await client.query(
        "INSERT INTO standup_history (id, text, at, source) VALUES ($1, $2, $3, $4)",
        [h.id, h.text, h.at, h.source || "unknown"]
      );
    }
    await client.query("DELETE FROM pending_followup");
    if (normalized.pendingFollowUp) {
      await client.query(
        "INSERT INTO pending_followup (singleton, json) VALUES (1, $1) ON CONFLICT (singleton) DO UPDATE SET json = EXCLUDED.json",
        [JSON.stringify(normalized.pendingFollowUp)]
      );
    }
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('gemini_paused', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [normalized.geminiPaused ? "true" : "false"]
    );
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(normalized.version || 2)]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function replaceFullStateInDb(state) {
  if (usePostgres) {
    const pool = await getPool();
    return replaceFullStatePg(pool, state);
  }
  replaceFullStateSqlite(getSqliteInternal(), state);
}

function ensureSeededSqlite(db) {
  const any =
    db.prepare("SELECT COUNT(*) AS c FROM days").get().c +
    db.prepare("SELECT COUNT(*) AS c FROM todos").get().c +
    db.prepare("SELECT COUNT(*) AS c FROM standup_history").get().c;
  if (any > 0) return;
  replaceFullStateSqlite(db, { ...DEFAULT_STATE });
}

async function ensureSeededPg(pool) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM days)
     + (SELECT COUNT(*)::int FROM todos)
     + (SELECT COUNT(*)::int FROM standup_history) AS c`
  );
  if (Number(rows[0]?.c || 0) > 0) return;
  await replaceFullStatePg(pool, { ...DEFAULT_STATE });
}

export async function upsertSetting(key, value) {
  if (usePostgres) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)]
    );
    return;
  }
  getSqliteInternal()
    .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")
    .run(key, String(value));
}

export async function insertStandupHistoryRow(row) {
  if (usePostgres) {
    const pool = await getPool();
    await pool.query("INSERT INTO standup_history (id, text, at, source) VALUES ($1, $2, $3, $4)", [
      row.id,
      row.text,
      row.at,
      row.source,
    ]);

    const c = await pool.query("SELECT COUNT(*)::int AS c FROM standup_history");
    const count = Number(c.rows[0].c);
    return count;
  }
  const db = getSqliteInternal();
  db.prepare("INSERT INTO standup_history (id, text, at, source) VALUES (?, ?, ?, ?)").run(
    row.id,
    row.text,
    row.at,
    row.source
  );
  return Number(db.prepare("SELECT COUNT(*) AS c FROM standup_history").get().c);
}

export async function trimStandupHistory(maxKeep) {
  if (usePostgres) {
    const pool = await getPool();
    const c = await pool.query("SELECT COUNT(*)::int AS c FROM standup_history");
    const count = Number(c.rows[0].c);
    if (count <= maxKeep) return;
    const n = count - maxKeep;
    await pool.query(
      `WITH old AS (
         SELECT id FROM standup_history ORDER BY at ASC LIMIT $1
       )
       DELETE FROM standup_history WHERE id IN (SELECT id FROM old)`,
      [n]
    );
    return;
  }
  const db = getSqliteInternal();
  const count = db.prepare("SELECT COUNT(*) AS c FROM standup_history").get().c;
  if (count <= maxKeep) return;
  const n = count - maxKeep;
  const oldRows = db.prepare("SELECT id FROM standup_history ORDER BY at ASC LIMIT ?").all(n);
  const del = db.prepare("DELETE FROM standup_history WHERE id = ?");
  for (const r of oldRows) del.run(r.id);
}

/** Merge-return day JSON for Postgres/SQLite. */
export async function mergeDayPayload(dateKey, mergedJsonStr) {
  if (usePostgres) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO days (date, json) VALUES ($1, $2)
       ON CONFLICT (date) DO UPDATE SET json = EXCLUDED.json`,
      [dateKey, mergedJsonStr]
    );
    return;
  }
  const db = getSqliteInternal();
  db.prepare("INSERT OR REPLACE INTO days (date, json) VALUES (?, ?)").run(dateKey, mergedJsonStr);
}

export async function getDayJson(dateKey) {
  if (usePostgres) {
    const pool = await getPool();
    const { rows } = await pool.query("SELECT json FROM days WHERE date = $1", [dateKey]);
    return rows[0]?.json ?? null;
  }
  const db = getSqliteInternal();
  const row = db.prepare("SELECT json FROM days WHERE date = ?").get(dateKey);
  return row?.json ?? null;
}

/**
 * @param {{ replaceAll?: boolean }} [options] If replaceAll, table is cleared first so the sheet remains the only source of truth (avoids duplicate rows after id-generation changes).
 */
export async function upsertJobApplications(jobs, options = {}) {
  const { replaceAll = false } = options;

  if (usePostgres) {
    const pool = await getPool();
    const client = await pool.connect();
    const runTimeoutSec = () => {
      const raw = process.env.PG_JOB_UPSERT_TIMEOUT_S?.trim();
      const n = raw ? Number(raw) : 120;
      const sec = Number.isFinite(n) ? Math.min(900, Math.max(30, Math.floor(n))) : 120;
      return sec;
    };
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = '${runTimeoutSec()}s'`);
      if (replaceAll) {
        await client.query("TRUNCATE job_applications");
      }
      const batchSize = Math.min(
        200,
        Math.max(25, Number(process.env.PG_JOB_UPSERT_BATCH) || 75)
      );
      for (let offset = 0; offset < jobs.length; offset += batchSize) {
        const chunk = jobs.slice(offset, offset + batchSize);
        const parts = [];
        const params = [];
        let n = 1;
        for (const j of chunk) {
          parts.push(
            `($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`
          );
          params.push(
            j.id,
            j.company ?? "",
            j.role ?? "",
            j.status,
            j.applied_date,
            j.last_updated,
            j.notes,
            j.sheet_row,
            j.synced_at
          );
        }
        const batched = `
          INSERT INTO job_applications (
            id, company, role, status, applied_date, last_updated, notes, sheet_row, synced_at
          ) VALUES ${parts.join(",")}
          ON CONFLICT (id) DO UPDATE SET
            company = EXCLUDED.company,
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            applied_date = EXCLUDED.applied_date,
            last_updated = EXCLUDED.last_updated,
            notes = EXCLUDED.notes,
            sheet_row = EXCLUDED.sheet_row,
            synced_at = EXCLUDED.synced_at
        `;
        await client.query(batched, params);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return;
  }

  const db = getSqliteInternal();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO job_applications
     (id, company, role, status, applied_date, last_updated, notes, sheet_row, synced_at)
     VALUES (@id, @company, @role, @status, @applied_date, @last_updated, @notes, @sheet_row, @synced_at)`
  );
  const tx = db.transaction((batch) => {
    if (replaceAll) {
      db.prepare("DELETE FROM job_applications").run();
    }
    for (const jj of batch) {
      stmt.run(jj);
    }
  });
  tx(jobs);
}
