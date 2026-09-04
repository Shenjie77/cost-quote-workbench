/**
 * Synchronous SQLite repository shared by the local HTTP API and cost CLI.
 * All public methods return plain JSON records and never leak SQLite objects.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  LOCAL_DATABASE_SCHEMA_VERSION,
  LOCAL_DATABASE_STATEMENTS,
} from '../db/schema.ts';
import {
  getCostStatementValues,
  getHQTravelSummary,
  roundMoney,
  totalRowMandays,
} from '../features/cost/domain.ts';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';
import { initialProjectStatusDefinitions } from '../features/projects/types.ts';
import {
  initialQuoteAssumptions,
  initialQuoteTemplates,
} from '../features/quote/types.ts';
import {
  calculatePricing,
  initialPricingSettings,
} from '../features/quote/domain.ts';

export const LOCAL_API_VERSION = 'cost-workbench/local-v1';
export const WORKSPACE_SCHEMA_VERSION = '1.0.0';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const costSchema = JSON.parse(
  readFileSync(path.join(ROOT_DIR, 'schemas/cost-export.schema.json'), 'utf8'),
);
const workspaceSchema = JSON.parse(
  readFileSync(
    path.join(ROOT_DIR, 'schemas/workspace-state.schema.json'),
    'utf8',
  ),
);
const schemaValidator = new Ajv2020({ allErrors: true, strict: true });
schemaValidator.addSchema(costSchema);
const validateWorkspaceSchema = schemaValidator.compile(workspaceSchema);

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

/**
 * Converts the former two-master RE Type + Grade model into the single
 * governed RE Type rate model. The migration is deterministic and idempotent,
 * so opening an older local database is safe and requires no user action.
 */
export const migrateWorkspaceDocument = (workspace) => {
  let document = workspace;
  let changed = false;
  const legacy =
    Array.isArray(workspace?.resourceGrades) ||
    workspace?.resourceTypes?.some(
      (item) => 'gradePool' in item || 'rateUnit' in item,
    ) ||
    workspace?.costRows?.some((row) => 'gradeId' in row);
  if (legacy) {
    const gradeCodeById = new Map(
      (workspace.resourceGrades || []).map((grade) => [grade.id, grade.code]),
    );
    const oldResources = new Map(
      (workspace.resourceTypes || []).map((resource) => [
        resource.id,
        resource,
      ]),
    );
    const resourceIdByCode = new Map(
      initialResourceTypes.map((resource) => [resource.code, resource.id]),
    );
    const costRows = (workspace.costRows || []).map((row) => {
      const oldResource = oldResources.get(row.reTypeId);
      const gradeCode = gradeCodeById.get(row.gradeId);
      const fallbackCode =
        oldResource?.category === 'subcontract'
          ? 'SUBCON'
          : `${oldResource?.gradePool || 'LOCAL'}-L1`;
      const { gradeId: _removedGradeId, ...nextRow } = row;
      return {
        ...nextRow,
        reTypeId:
          resourceIdByCode.get(gradeCode || fallbackCode) || 'rt-local-l1',
      };
    });
    const { resourceGrades: _removedGrades, ...legacyFreeDocument } = workspace;
    document = {
      ...legacyFreeDocument,
      costRows,
      resourceTypes: initialResourceTypes.map((resource) => ({ ...resource })),
    };
    changed = true;
  }

  // Fields introduced after the first local-workspace release are backfilled
  // without changing the public schema version, preserving CLI compatibility.
  if (!document.projectStatus) {
    const step = Number(document.selectedStep || 0);
    document = {
      ...document,
      projectStatus:
        step >= 8
          ? 'quote_review'
          : step >= 7
            ? 'pricing'
            : step >= 6
              ? 'cost_review'
              : step >= 4
                ? 'costing'
                : step >= 2
                  ? 'delivery_review'
                  : step >= 1
                    ? 'solution_review'
                    : 'input_preparation',
    };
    changed = true;
  }
  // Status labels moved from a hard-coded UI enum into editable project master
  // data. Older snapshots receive the original labels without changing their
  // selected projectStatus code.
  if (!Object.hasOwn(document, 'projectStatusDefinitions')) {
    const statusDefinitions = initialProjectStatusDefinitions.map((status) => ({
      ...status,
    }));
    if (
      document.projectStatus &&
      !statusDefinitions.some(
        (status) => status.code === document.projectStatus,
      )
    ) {
      statusDefinitions.push({
        code: document.projectStatus,
        name: document.projectStatus,
        nameZh: '',
        active: true,
      });
    }
    document = { ...document, projectStatusDefinitions: statusDefinitions };
    changed = true;
  }
  if (!Object.hasOwn(document, 'reviewGates')) {
    document = { ...document, reviewGates: [] };
    changed = true;
  }
  // A stable code survives workflow reordering and row insertion. The former
  // numeric selectedStep is retained only for v1 clients and migration.
  if (!Object.hasOwn(document, 'currentWorkflowStepCode')) {
    const steps = Array.isArray(document.processSteps)
      ? document.processSteps
      : [];
    const legacyIndex = Math.max(0, Number(document.selectedStep || 0));
    const current =
      steps[legacyIndex] ||
      steps.find((step) =>
        ['blocked', 'awaiting_review', 'in_progress'].includes(step.state),
      ) ||
      steps[0];
    document = {
      ...document,
      currentWorkflowStepCode: current?.code || '',
    };
    changed = true;
  }
  if (!document.pricing) {
    document = { ...document, pricing: { ...initialPricingSettings } };
    changed = true;
  }
  if (!Object.hasOwn(document, 'quoteTemplates')) {
    document = {
      ...document,
      quoteTemplates: structuredClone(initialQuoteTemplates),
    };
    changed = true;
  }
  if (!document.selectedQuoteTemplateId) {
    document = {
      ...document,
      selectedQuoteTemplateId:
        document.quoteTemplates?.[0]?.id || initialQuoteTemplates[0].id,
    };
    changed = true;
  }
  if (!Object.hasOwn(document, 'quoteAssumptions')) {
    document = {
      ...document,
      quoteAssumptions: structuredClone(initialQuoteAssumptions),
    };
    changed = true;
  }
  if (!Object.hasOwn(document, 'quoteHistory')) {
    document = { ...document, quoteHistory: [] };
    changed = true;
  }
  if (
    !Array.isArray(document.costVersions) ||
    document.costVersions.length === 0
  ) {
    document = {
      ...document,
      costVersions: [
        {
          code: document.activeVersion || 'V1',
          state: 'Draft',
          createdAt: nowIso(),
          sourceVersion: null,
          costRows: structuredClone(document.costRows || []),
          rateSettings: structuredClone(document.rateSettings),
          travelSettings: structuredClone(document.travelSettings),
          travelRows: structuredClone(document.travelRows || []),
          travelUplift: Number(document.travelUplift || 0),
          manualCosts: structuredClone(document.manualCosts),
        },
      ],
    };
    changed = true;
  }
  // Normalize the prototype lifecycle into the three states exposed by the
  // editable version selector. This also keeps existing SQLite snapshots
  // valid after the schema enum is tightened.
  const legacyVersionState = {
    'Pending freeze': 'Draft',
    Frozen: 'Confirmed',
    Superseded: 'Suspended',
  };
  if (
    document.costVersions?.some((version) =>
      Object.hasOwn(legacyVersionState, version.state),
    )
  ) {
    document = {
      ...document,
      costVersions: document.costVersions.map((version) => ({
        ...version,
        state: legacyVersionState[version.state] || version.state,
      })),
    };
    changed = true;
  }
  return changed ? document : workspace;
};

/** Calculates the compact, non-formatted metrics returned by Project List. */
const summarizeWorkspace = (workspace) => {
  if (!workspace) return {};
  const workflowSteps = (workspace.processSteps || []).map((step) => ({
    ...step,
  }));
  const statusDefinitions = (workspace.projectStatusDefinitions || []).map(
    (status) => ({ ...status }),
  );
  const travelCost = getHQTravelSummary(
    workspace.costRows || [],
    workspace.resourceTypes || [],
    workspace.travelSettings || {
      monthlyAllowance: 0,
      airfarePerTrip: 0,
      trips: 0,
    },
  ).totalCost;
  const statement = getCostStatementValues(
    workspace.costRows || [],
    workspace.resourceTypes || [],
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
      Number(row.mdPerSite || 0) <= 0 ||
      !(row.years || []).some(
        (year) => Number(year.sites || 0) > 0 || Number(year.cost || 0) > 0,
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
  };
};

/** Rejects malformed payloads before they can become the local source of truth. */
export const assertWorkspaceDocument = (workspace, projectId) => {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    throw new TypeError('workspace must be a JSON object.');
  }
  if (workspace.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new TypeError(
      `workspace.schemaVersion must be ${WORKSPACE_SCHEMA_VERSION}.`,
    );
  }
  if (!workspace.project || workspace.project.id !== projectId) {
    throw new TypeError('workspace.project.id must match the URL project id.');
  }
  if (!String(workspace.project.name || '').trim()) {
    throw new TypeError('workspace.project.name is required.');
  }
  if (!String(workspace.project.client || '').trim()) {
    throw new TypeError('workspace.project.client is required.');
  }
  if (workspace.project.currency !== 'SGD') {
    throw new TypeError('workspace.project.currency must be SGD.');
  }
  if (!validateWorkspaceSchema(workspace)) {
    const first = validateWorkspaceSchema.errors?.[0];
    const location = first?.instancePath || '/';
    throw new TypeError(
      `Workspace schema validation failed at ${location}: ${first?.message || 'invalid value'}.`,
    );
  }
  if (
    workspace.currentWorkflowStepCode &&
    !workspace.processSteps.some(
      (step) => step.code === workspace.currentWorkflowStepCode,
    )
  ) {
    throw new TypeError(
      'workspace.currentWorkflowStepCode must reference processSteps[].code.',
    );
  }
  const statusCodes = workspace.projectStatusDefinitions.map(
    (status) => status.code,
  );
  if (!statusCodes.includes(workspace.projectStatus)) {
    throw new TypeError(
      'workspace.projectStatus must reference projectStatusDefinitions[].code.',
    );
  }
  if (new Set(statusCodes).size !== statusCodes.length) {
    throw new TypeError(
      'workspace.projectStatusDefinitions[].code values must be unique.',
    );
  }
  const workflowCodes = new Set(
    workspace.processSteps.map((step) => step.code),
  );
  for (const review of workspace.reviewGates) {
    if (review.projectId !== projectId) {
      throw new TypeError(
        'workspace.reviewGates[].projectId must match the project id.',
      );
    }
    if (
      review.workflowStepCode &&
      !workflowCodes.has(review.workflowStepCode)
    ) {
      throw new TypeError(
        'workspace.reviewGates[].workflowStepCode must reference processSteps[].code.',
      );
    }
  }
  const uniqueFields = [
    ['reviewGates', workspace.reviewGates.map((review) => review.id)],
    ['quoteTemplates', workspace.quoteTemplates.map((template) => template.id)],
    ['quoteAssumptions', workspace.quoteAssumptions.map((item) => item.id)],
    ['quoteHistory', workspace.quoteHistory.map((record) => record.id)],
  ];
  for (const [name, values] of uniqueFields) {
    if (new Set(values).size !== values.length) {
      throw new TypeError(`workspace.${name}[].id values must be unique.`);
    }
  }
  if (
    !workspace.quoteTemplates.some(
      (template) => template.id === workspace.selectedQuoteTemplateId,
    )
  ) {
    throw new TypeError(
      'workspace.selectedQuoteTemplateId must reference quoteTemplates[].id.',
    );
  }
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
    const payloadJson = JSON.stringify(migrated);
    updateMigratedSnapshot.run(
      row.revision + 1,
      payloadJson,
      checksum(payloadJson),
      nowIso(),
      row.project_id,
    );
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

    list() {
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
          ...summarizeWorkspace(workspace),
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
      const document = migrateWorkspaceDocument(workspace);
      assertWorkspaceDocument(document, projectId);
      const payloadJson = JSON.stringify(document);
      const payloadSha256 = checksum(payloadJson);
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
