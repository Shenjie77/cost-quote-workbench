/**
 * Local SQLite schema for the personal workbench.
 *
 * The browser and CLI exchange a versioned workspace document. Keeping that
 * document atomic gives autosave a simple consistency boundary while the
 * project index remains relational and searchable. Future migrations can
 * normalize individual business records without changing the public payload.
 */

export const LOCAL_DATABASE_SCHEMA_VERSION = 1;

/** Each entry is exactly one statement so initialization stays portable. */
export const LOCAL_DATABASE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'SGD'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_snapshots (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    schema_version TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_sha256 TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_updated_at
   ON projects(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_snapshots_updated_at
   ON workspace_snapshots(updated_at DESC)`,
] as const;
