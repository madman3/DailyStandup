-- Optional: run once in Supabase SQL editor. Backend also runs equivalent DDL on startup via initLifeosDatabase().
-- Keep in sync with backend/src/lifeosDb.js PG_SCHEMA.

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
