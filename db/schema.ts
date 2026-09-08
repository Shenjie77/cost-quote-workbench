/**
 * Local SQLite schema for the personal workbench.
 *
 * The browser and CLI exchange a versioned workspace document. Keeping that
 * document atomic gives autosave a simple consistency boundary while the
 * project index remains relational and searchable. Future migrations can
 * normalize individual business records without changing the public payload.
 */

export const LOCAL_DATABASE_SCHEMA_VERSION = 8;

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
  // Retain complete snapshots for recovery; deleted IDs cannot be auto-created.
  `CREATE TABLE IF NOT EXISTS deleted_projects (
    project_id TEXT PRIMARY KEY REFERENCES projects(id),
    deleted_at TEXT NOT NULL
  )`,
  // Exact pre-migration documents are retained locally for inspection/recovery.
  `CREATE TABLE IF NOT EXISTS workspace_migration_archive (
    project_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    archived_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    PRIMARY KEY (project_id, revision)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_snapshots_updated_at
   ON workspace_snapshots(updated_at DESC)`,
  // Shared source catalogs have their own revisions, independent of projects.
  `CREATE TABLE IF NOT EXISTS master_data_tabs (
    tab TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS master_data_revisions (
    tab TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tab, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS master_data_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
] as const;
