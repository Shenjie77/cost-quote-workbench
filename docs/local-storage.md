# Local SQLite storage and backup

## Runtime boundary

`npm run dev` launches two loopback-only processes:

- the workbench UI at `http://localhost:3000`;
- the local data API at `http://127.0.0.1:3210`.

The API stores data in `data/workbench.sqlite`. Its WAL sidecar files may exist
while the application is running. No company quotation platform, cloud
database, or external model receives this data.

## Stored records

`projects` is the searchable project index. `workspace_snapshots` contains one
atomic JSON workspace per project with:

- schema version and monotonically increasing revision;
- SHA-256 of the exact JSON payload;
- project workflow definitions, the current node, owner, follow-up date and note;
- append-only workflow registration history;
- derived compatibility project status and pricing parameters;
- active cost version plus independent version snapshots with manual `Draft`,
  `Suspended`, or `Confirmed` states;
- platform-managed workflowVersion and versionWorkflows for current and historical
  version review rounds, independent of which cost version is being viewed;
- cost rows, rate/travel assumptions, and manual costs;
- captured RE Type/rate, subcontract, supplemental-cost, and maintenance
  reference data;
- read-only legacy SSR review evidence and review gates with follow-up history;
- captured quote templates/library, selected assumptions, pricing, and quote history;
- update timestamp.

Global Master Data is separate from workspace snapshots. Its ten tabs have
independent revisions and preserve migration conflict sources. Updating a tab
does not read or save a project. New projects and blank cost versions capture
current defaults/rates; cloned versions retain their source snapshots. All
existing Drafts and historical records remain unchanged unless a supported
explicit project/version adoption is requested. See [data boundaries](global-master-data.md).

The schema is defined in `db/schema.ts`. Initialization uses idempotent,
single-statement migrations and enables foreign keys, WAL, busy timeout, and
`PRAGMA optimize`.

Project document archives are separate from workspace snapshots. Additive
`project_file_settings`, `project_file_roots`, and `project_files` tables store
the default folder, per-project folder locations, and file metadata; binaries live
under those folders. These tables are initialized without rewriting existing
cost snapshots or incrementing workspace revisions. See [project files](project-files.md).
Two additional archive tables retain readable node-folder mappings and pending
migration cleanup. Project Folder changes copy and verify the full archive before
switching its location; the project and global settings revisions stay unchanged.

## Save and conflict behavior

The browser first loads the saved project. If none exists, it writes the
bundled starting data once. Later edits autosave after 900 ms. Every save sends
the last loaded revision. SQLite accepts the save only when that revision is
still current, then increments it. A second stale tab receives
`REVISION_CONFLICT` and must reload; it cannot silently overwrite newer data.

Writes from one browser session are queued. Switching a project first flushes
the latest edits; offline, rejected or conflicted saves cancel the switch.
Download a JSON backup before reloading a conflicted editor. Closing/reloading
with unsaved changes triggers the browser's unsaved-work warning. If initial
loading fails, Save retries loading; editing becomes available after hydration.

Database schema 2 adds `workspace_migration_archive`. Compatibility migrations
run in one transaction, retain the exact original JSON with project ID/revision,
and increment the live revision once. Legacy versions lacking resource-rate
snapshots capture the available catalogue and correct stale labour amounts.
The Cost page labels affected versions for review. Historical rate values that
were never stored cannot be reconstructed. The archive is local recovery data,
not a per-edit audit ledger; preserve it with the database backup.

Database schema 4 migrates the former project lock into `costVersionLocks` once,
using the recorded version evidence and retaining the original document in the
migration archive. Current-format cost amounts and approval/configuration archives
are unchanged. Subsequent reads do not scan other projects for this migration.

Database schema 5 adds version-owned workflow rounds. Existing highest Drafts
return to DTRB; their previous progress is preserved in `legacyWorkflowArchive`
when it belongs to that same version. Cost snapshots and actual company review
evidence remain unchanged. New DRB actions require explicit cost confirmation.

Database schema 6 adds `master_data_tabs` for current global tab payloads,
`master_data_revisions` for prior tab revisions, and `master_data_metadata` for
the one-time initialization marker. Initialization gathers existing project
references once without rewriting project payloads or revisions. Same-key
conflicts retain their variants and source project/revision; unresolved data
must be explicitly resolved before it can be adopted into a new project/version.
Normal master-data operations do not scan old workspaces.

Database schema 7 introduces the single Project Workflow register. Migration retains existing costs and old SSR/review evidence, adds missing standard workflow stages, derives the compatibility projectStatus, and maps legacy completed projects to QUOTE_COMPLETED. The original document remains in the migration archive. New progress writes append workflowUpdates; historical SSR submissions and review gates are read-only. Follow-up reminders read the current workflow date and stop entirely after quotation completion. See [project workflow](project-workflow.md).

Agent project writes use the same project revision rule. Global tab writes use
that tab's revision instead, with `masterdata get/update --tab TAB` and no project
ID. The following whole-workspace commands are for deliberate backups/restores,
not normal master-data maintenance:

```bash
npm run --silent cost-cli -- workspace get \
  --project-id PRJ-2026-018 --pretty

npm run --silent cost-cli -- workspace save \
  --input /absolute/path/workspace-request.json \
  --expected-revision 7 --pretty
```

Use `--expected-revision none` only for a project known not to exist.

## Backup and recovery

`npm run --silent backup:local` creates an integrity-checked SQLite backup in
`data/backups/` using SQLite's backup API, including committed WAL contents.
It prints one JSON result with the backup path and does not stop a running app.
This script never runs compatibility migrations.

The database backup includes file indexes, but does not copy archived document
contents. Back up each project's actual archive folder as well, including any
custom roots outside `data/`. Project JSON backups do not contain attachments.
Restore archived folders at their original paths alongside the database.

In the UI, select the three-dot action beside the workspace identity to
download the active project as a restore-ready `WorkspaceSaveRequest` JSON
file. It can be validated or restored with `workspace save` after checking the
target revision.

Close the workbench before copying the database so the WAL is fully checkpointed.
Copy `data/workbench.sqlite` to a company-approved encrypted location. Do not
commit it to Git or place it in a personal cloud drive. Recovery is replacing
the stopped application's database file with a known-good copy. Keep the
source copy until the restored application has passed `system doctor` and
`workspace list`.

User-confirmed cost versions have immutable inputs enforced by the repository,
rather than cryptographic signatures. Confirmed is cost finalization, not DRB
approval, and must precede entry/submission/completion of that version's DRB.
New Drafts can be created or cloned without changing the locked original; creation
selects the new version and starts its independent DTRB round. The platform
maintains workflowVersion and versionWorkflows separately from the version being
viewed through activeVersion. Review evidence remains bound to its submitted
version and snapshot. General row changes do not have a separate event ledger; revision,
payload hash, cost-version snapshots, review follow-ups, and quote history form
the current traceability model.
