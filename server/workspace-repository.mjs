/**
 * Synchronous SQLite repository shared by the local HTTP API and cost CLI.
 * All public methods return plain JSON records and never leak SQLite objects.
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  commercialBasisKey,
  emptySsr,
  assertSsrTransition,
  ssrAttention,
} from '../features/ssr/domain.ts';
import { normalizeDigestDate } from '../features/agent/digest-domain.ts';
import {
  assertCurrentCpqResult,
  contentKey,
  costBaselineKey,
} from '../features/cpq/domain.ts';

import {
  LOCAL_DATABASE_SCHEMA_VERSION,
  LOCAL_DATABASE_STATEMENTS,
} from '../db/schema.ts';
import {
  getCostStatementValues,
  getHQTravelSummary,
  roundMoney,
  recalculateCostRows,
  totalRowMandays,
} from '../features/cost/domain.ts';
import {
  calculatePricing,
  initialPricingSettings,
} from '../features/quote/domain.ts';
import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceValidationError,
  migrateWorkspaceDocument,
  assertWorkspaceDocument,
} from './workspace-document.mjs';
export {
  LOCAL_API_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceValidationError,
  migrateWorkspaceDocument,
  assertWorkspaceDocument,
} from './workspace-document.mjs';

export class RepositoryConflictError extends Error {
  constructor(message, currentRevision) {
    super(message);
    this.name = 'RepositoryConflictError';
    this.currentRevision = currentRevision;
  }
}

const nowIso = () => new Date().toISOString();
const checksum = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Calculates the compact, non-formatted metrics returned by Project List. */
const summarizeWorkspace = (workspace, asOf = normalizeDigestDate()) => {
  if (!workspace) return {};
  const workflowSteps = (workspace.processSteps || []).map((step) => ({
    ...step,
  }));
  const statusDefinitions = (workspace.projectStatusDefinitions || []).map(
    (status) => ({ ...status }),
  );
  const resources =
    workspace.costVersions?.find(
      (version) => version.code === workspace.activeVersion,
    )?.resourceTypes ||
    workspace.resourceTypes ||
    [];
  const rows = recalculateCostRows(
    workspace.costRows || [],
    resources,
    workspace.rateSettings,
  );
  const travelCost = getHQTravelSummary(
    rows,
    resources,
    workspace.travelSettings || {
      monthlyAllowance: 0,
      airfarePerTrip: 0,
      trips: 0,
    },
  ).totalCost;
  const statement = getCostStatementValues(
    rows,
    resources,
    travelCost,
    workspace.manualCosts || {},
  );
  const totalMandays = (workspace.costRows || []).reduce(
    (sum, row) => sum + totalRowMandays(row),
    0,
  );
  const pricing = calculatePricing(
    statement.totalWithRisk,
    workspace.pricing || initialPricingSettings,
  );
  const activeVersion = workspace.activeVersion || 'V1';
  const versionState =
    workspace.costVersions?.find((version) => version.code === activeVersion)
      ?.state || 'Draft';
  const incompleteCostRows = (workspace.costRows || []).filter(
    (row) =>
      !String(row.scope || '').trim() ||
      !String(row.bu || '').trim() ||
      !String(row.reTypeId || '').trim() ||
      (row.inputMode !== 'mandays' && Number(row.mdPerSite || 0) <= 0) ||
      !(row.years || []).some(
        (year) =>
          Number(year.sites || 0) > 0 ||
          Number(year.mandays || 0) > 0 ||
          Number(year.cost || 0) > 0,
      ),
  ).length;
  return {
    projectStatus: workspace.projectStatus || 'input_preparation',
    statusDefinitions,
    reviewGates: structuredClone(workspace.reviewGates || []),
    currentWorkflowStepCode:
      workspace.currentWorkflowStepCode || workflowSteps[0]?.code || '',
    workflowSteps,
    activeVersion,
    versionState,
    serviceCost: roundMoney(statement.service - statement.subcontract),
    subcontractCost: statement.subcontract,
    totalCost: statement.totalWithRisk,
    totalMandays,
    totalQuote: pricing.quoteBeforeTax,
    grossMarginPercent: pricing.grossMarginPercent,
    incompleteCostRows,
    ssrAttention: workspace.ssr
      ? ssrAttention(
          workspace.ssr,
          workspace.costVersions.find(
            (v) => v.code === workspace.activeVersion,
          ),
          asOf,
        )
      : [],
  };
};

/** Opens the database and applies idempotent schema initialization. */
export const openWorkspaceRepository = (databasePath) => {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  for (const statement of LOCAL_DATABASE_STATEMENTS) {
    db.prepare(statement).run();
  }
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at)
     VALUES (?, ?)`,
  ).run(LOCAL_DATABASE_SCHEMA_VERSION, nowIso());
  db.exec('PRAGMA optimize');

  // Upgrade existing JSON snapshots before any browser or CLI reads them.
  db.exec('BEGIN IMMEDIATE');
  try {
    const legacySnapshots = db
      .prepare(
        `SELECT project_id, revision, payload_json FROM workspace_snapshots`,
      )
      .all();
    const updateMigratedSnapshot = db.prepare(
      `UPDATE workspace_snapshots
     SET revision = ?, payload_json = ?, payload_sha256 = ?, updated_at = ?
     WHERE project_id = ?`,
    );
    for (const row of legacySnapshots) {
      const current = JSON.parse(row.payload_json);
      const migrated = migrateWorkspaceDocument(current);
      if (migrated === current) continue;
      assertWorkspaceDocument(migrated, row.project_id);
      const payloadJson = JSON.stringify(migrated);
      db.prepare(`INSERT OR IGNORE INTO workspace_migration_archive
      (project_id, revision, payload_json, archived_at, reason) VALUES (?, ?, ?, ?, ?)`).run(
        row.project_id,
        row.revision,
        row.payload_json,
        nowIso(),
        'Workspace contract and version-rate migration',
      );
      updateMigratedSnapshot.run(
        row.revision + 1,
        payloadJson,
        checksum(payloadJson),
        nowIso(),
        row.project_id,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  const selectWorkspace = db.prepare(
    `SELECT project_id, schema_version, revision, payload_json,
            payload_sha256, updated_at
     FROM workspace_snapshots
     WHERE project_id = ?`,
  );
  const listProjects = db.prepare(
    `SELECT p.id, p.name, p.client, p.currency, p.created_at, p.updated_at,
            w.revision, w.schema_version, w.payload_sha256, w.payload_json
     FROM projects p
     LEFT JOIN workspace_snapshots w ON w.project_id = p.id
     ORDER BY p.updated_at DESC, p.id ASC`,
  );

  const mapWorkspace = (row) =>
    row
      ? {
          projectId: row.project_id,
          schemaVersion: row.schema_version,
          revision: row.revision,
          workspace: JSON.parse(row.payload_json),
          sha256: row.payload_sha256,
          updatedAt: row.updated_at,
        }
      : null;

  return {
    databasePath,
    schemaVersion: LOCAL_DATABASE_SCHEMA_VERSION,

    get(projectId) {
      return mapWorkspace(selectWorkspace.get(projectId));
    },

    list(asOf) {
      return listProjects.all().map((row) => {
        const workspace = row.payload_json
          ? migrateWorkspaceDocument(JSON.parse(row.payload_json))
          : null;
        return {
          projectId: row.id,
          name: row.name,
          client: row.client,
          currency: row.currency,
          revision: row.revision ?? null,
          schemaVersion: row.schema_version ?? null,
          sha256: row.payload_sha256 ?? null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ...summarizeWorkspace(workspace, asOf),
        };
      });
    },

    /**
     * Saves with optimistic concurrency. `expectedRevision: null` creates a
     * record only when one does not exist; an integer updates that revision.
     */
    save(projectId, workspace, expectedRevision) {
      // Accept a v1-compatible document from older CLI clients, then persist
      // the fully expanded project-status, pricing, and version-snapshot form.
      if (
        !workspace ||
        typeof workspace !== 'object' ||
        Array.isArray(workspace)
      )
        throw new WorkspaceValidationError('workspace must be a JSON object.');
      let document = migrateWorkspaceDocument(workspace);
      assertWorkspaceDocument(document, projectId);
      // Top-level editors are authoritative for the active version. Derive
      // labour amounts on every write, including CLI writes, before hashing.
      const active = document.costVersions.find(
        (version) => version.code === document.activeVersion,
      );
      const costRows = recalculateCostRows(
        document.costRows,
        active.resourceTypes,
        document.rateSettings,
      );
      document = {
        ...document,
        costRows,
        costVersions: document.costVersions.map((version) =>
          version.code === document.activeVersion
            ? {
                ...version,
                costRows,
                rateSettings: document.rateSettings,
                travelSettings: document.travelSettings,
                travelRows: document.travelRows,
                travelUplift: document.travelUplift,
                manualCosts: document.manualCosts,
              }
            : version,
        ),
      };
      assertWorkspaceDocument(document, projectId);
      const timestamp = nowIso();

      db.exec('BEGIN IMMEDIATE');
      try {
        const current = selectWorkspace.get(projectId);
        const currentRevision = current?.revision ?? null;
        if (currentRevision !== expectedRevision) {
          throw new RepositoryConflictError(
            `Expected revision ${String(expectedRevision)}, current revision is ${String(currentRevision)}.`,
            currentRevision,
          );
        }
        const previous = current ? JSON.parse(current.payload_json) : null;
        // Older clients must not erase extension data they do not understand.
        if (!Object.hasOwn(workspace, 'cpq') && previous?.cpq)
          document = { ...document, cpq: previous.cpq };
        if (
          !Object.hasOwn(workspace, 'maintenanceBoq') &&
          previous?.maintenanceBoq
        )
          document = { ...document, maintenanceBoq: previous.maintenanceBoq };
        for (const old of previous?.maintenanceBoq?.archives || []) {
          const kept = document.maintenanceBoq?.archives.find(
            (a) => a.id === old.id,
          );
          if (contentKey(kept) !== contentKey(old))
            throw new WorkspaceValidationError(
              'Archived maintenance configurations cannot be changed',
            );
        }
        for (const added of document.maintenanceBoq?.archives || []) {
          if (previous?.maintenanceBoq?.archives.some((a) => a.id === added.id))
            continue;
          if (
            contentKey(added.lines.map((l) => l.boq.id).sort()) !==
            contentKey(document.maintenanceBoq.boq.map((r) => r.id).sort())
          )
            throw new WorkspaceValidationError(
              'New maintenance archive must include all current BOQ rows',
            );
          if (added.client !== document.project.client)
            throw new WorkspaceValidationError(
              'Maintenance archive client must match project',
            );
          for (const line of added.lines) {
            if (
              contentKey(line.reference) !==
              contentKey(
                document.maintenancePriceRecords.find(
                  (r) => r.id === line.reference.id,
                ),
              )
            )
              throw new WorkspaceValidationError(
                'New maintenance archive must capture current references',
              );
            if (
              contentKey(line.boq) !==
              contentKey(
                document.maintenanceBoq.boq.find((r) => r.id === line.boq.id),
              )
            )
              throw new WorkspaceValidationError(
                'New archive must capture current BOQ',
              );
          }
          if (added.coverageMonths !== document.maintenanceBoq.coverageMonths)
            throw new WorkspaceValidationError(
              'Maintenance duration differs from current BOQ',
            );
        }
        if (!Object.hasOwn(workspace, 'ssr') && previous?.ssr)
          document = { ...document, ssr: previous.ssr };
        if (document.ssr)
          document = {
            ...document,
            ssr: {
              ...document.ssr,
              commercialBasis: commercialBasisKey(document),
            },
          };
        if (document.ssr)
          assertSsrTransition(
            previous?.ssr || emptySsr(),
            document.ssr,
            document.costVersions.find(
              (v) => v.code === document.activeVersion,
            ),
          );
        for (const old of previous?.cpq?.archives || []) {
          const retained = document.cpq?.archives.find(
            (item) => item.id === old.id,
          );
          if (!retained || contentKey(retained) !== contentKey(old))
            throw new WorkspaceValidationError(
              'Archived CPQ configurations cannot be edited or deleted.',
              '/cpq/archives',
            );
        }
        for (const added of document.cpq?.archives || []) {
          if (previous?.cpq?.archives.some((item) => item.id === added.id))
            continue;
          const baseline = document.costVersions.find(
            (version) => version.code === added.costVersion,
          );
          if (!baseline || added.costKey !== costBaselineKey(baseline))
            throw new WorkspaceValidationError(
              'New CPQ archive must reference the current cost inputs.',
              '/cpq/archives',
            );
          if (contentKey(added.costBaseline) !== contentKey(baseline))
            throw new WorkspaceValidationError(
              'New CPQ archive cost metadata must match the current version.',
              '/cpq/archives',
            );
          for (const line of added.result.lines) {
            const catalogItem = document.cpq.catalog.find(
              (item) => item.code === line.item.code,
            );
            if (
              !catalogItem ||
              contentKey(catalogItem) !== contentKey(line.item)
            )
              throw new WorkspaceValidationError(
                'New CPQ archive must use confirmed current catalog entries.',
                '/cpq/archives',
              );
          }
        }
        if (document.cpq) {
          const cpqBase = document.costVersions.find(
            (v) => v.code === document.cpq.draft.costVersion,
          );
          if (cpqBase) assertCurrentCpqResult(document.cpq, cpqBase);
        }
        assertWorkspaceDocument(document, projectId);
        const payloadJson = JSON.stringify(document);
        const payloadSha256 = checksum(payloadJson);
        const nextRevision = (currentRevision ?? 0) + 1;
        db.prepare(
          `INSERT INTO projects (id, name, client, currency, created_at, updated_at)
           VALUES (?, ?, ?, 'SGD', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             client = excluded.client,
             currency = excluded.currency,
             updated_at = excluded.updated_at`,
        ).run(
          projectId,
          document.project.name,
          document.project.client,
          timestamp,
          timestamp,
        );
        db.prepare(
          `INSERT INTO workspace_snapshots
             (project_id, schema_version, revision, payload_json,
              payload_sha256, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             schema_version = excluded.schema_version,
             revision = excluded.revision,
             payload_json = excluded.payload_json,
             payload_sha256 = excluded.payload_sha256,
             updated_at = excluded.updated_at`,
        ).run(
          projectId,
          WORKSPACE_SCHEMA_VERSION,
          nextRevision,
          payloadJson,
          payloadSha256,
          timestamp,
        );
        db.exec('COMMIT');
        return mapWorkspace(selectWorkspace.get(projectId));
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    close() {
      db.close();
    },
  };
};
