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
  // Additive archive tables deliberately do not trigger workspace migrations.
  `CREATE TABLE IF NOT EXISTS project_file_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    root_path TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1)
  )`,
  `CREATE TABLE IF NOT EXISTS project_file_roots (
    project_id TEXT PRIMARY KEY REFERENCES projects(id),
    root_path TEXT NOT NULL,
    project_folder TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (root_path, project_folder)
  )`,
  `CREATE TABLE IF NOT EXISTS project_files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project_file_roots(project_id),
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 52428800),
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('general','workflow','cost','quote','cpq','maintenance','source','backup')),
    node_code TEXT,
    node_name TEXT,
    version_code TEXT,
    relative_path TEXT NOT NULL,
    request_id TEXT,
    request_fingerprint TEXT NOT NULL,
    UNIQUE (project_id, request_id),
    UNIQUE (project_id, relative_path)
  )`,
  `CREATE TABLE IF NOT EXISTS project_file_node_folders (
    project_id TEXT NOT NULL REFERENCES project_file_roots(project_id),
    node_code TEXT NOT NULL,
    folder_name TEXT NOT NULL,
    PRIMARY KEY (project_id, node_code)
  )`,
  `CREATE TABLE IF NOT EXISTS project_file_moves (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project_file_roots(project_id),
    source_path TEXT NOT NULL,
    target_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_files_scope ON project_files (project_id, version_code, node_code, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS master_data_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
] as const;
