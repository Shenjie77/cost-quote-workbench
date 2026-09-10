/**
 * Workspace compatibility and integrity boundary. Pure document migrations and
 * validation live here; this module never opens or writes a database.
 */
import { migrateVersionWorkflows } from '../features/cost/version-workflow.ts';
import { normalizeProjectWorkflow } from '../features/projects/workflow-domain.ts';
import { migrateWorkflowEngine } from '../features/projects/workflow-engine.ts';
import { getCostVersionLocks } from '../features/cost/cost-lock.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  recalculateCostRows,
  validatePersonnelAllowanceSelection,
} from '../features/cost/domain.ts';
import { validateSubcontractCost } from '../features/cost/subcontract-domain.ts';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';
import { assertMaintenanceImport } from '../features/master-data/maintenance-import.ts';
import { initialProjectStatusDefinitions } from '../features/projects/types.ts';
import {
  createAssumptionLibrary,
  initialQuoteAssumptions,
  initialQuoteTemplates,
} from '../features/quote/types.ts';
import { initialPricingSettings } from '../features/quote/domain.ts';
import { validateProfitShareRates } from '../features/quote/profit-share.ts';
import { assertMaintenanceWorkspace } from '../features/maintenance/domain.ts';
import { assertSsr } from '../features/ssr/domain.ts';
import { assertCpq } from '../features/cpq/domain.ts';

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

/** Validation is an input failure, not a server/CLI implementation failure. */
export class WorkspaceValidationError extends TypeError {
  constructor(message, location = '/workspace') {
    super(message);
    this.name = 'WorkspaceValidationError';
    this.violations = [{ path: location, rule: 'workspaceIntegrity', message }];
  }
}

const nowIso = () => new Date().toISOString();

/**
 * Converts the former two-master RE Type + Grade model into the single
 * governed RE Type rate model. The migration is deterministic and idempotent,
 * so opening an older local database is safe and requires no user action.
 */
export const migrateWorkspaceDocument = (
  workspace,
  { workflow = true } = {},
) => {
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
  // Add only absent catalog fields; deliberate empty libraries remain empty.
  if (!Object.hasOwn(document, 'assumptionLibrary')) {
    document = {
      ...document,
      assumptionLibrary: createAssumptionLibrary(
        Array.isArray(document.quoteAssumptions)
          ? document.quoteAssumptions
          : [],
      ),
    };
    changed = true;
  }
  if (Array.isArray(document.quoteTemplates)) {
    document = {
      ...document,
      quoteTemplates: document.quoteTemplates.map((template) => {
        if (
          Object.hasOwn(template, 'termsAndConditions') &&
          Object.hasOwn(template, 'defaultAssumptionIds')
        )
          return template;
        changed = true;
        return {
          termsAndConditions: '',
          defaultAssumptionIds: [],
          ...template,
        };
      }),
    };
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
          ...(document.subcontractCost
            ? { subcontractCost: structuredClone(document.subcontractCost) }
            : {}),
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
  // Capture the currently available catalogue once for legacy versions. Past
  // rate values that were never stored cannot be reconstructed retrospectively.
  if (document.costVersions?.some((version) => !version.resourceTypes)) {
    const costVersions = document.costVersions.map((version) => {
      if (version.resourceTypes) return version;
      const resourceTypes = structuredClone(document.resourceTypes);
      const rows =
        version.code === document.activeVersion
          ? document.costRows
          : version.costRows;
      const rates =
        version.code === document.activeVersion
          ? document.rateSettings
          : version.rateSettings;
      const costRows = recalculateCostRows(rows, resourceTypes, rates);
      const adjusted = JSON.stringify(costRows) !== JSON.stringify(rows);
      return {
        ...version,
        resourceTypes,
        costRows,
        rateSettings: rates,
        ...(adjusted
          ? {
              calculationNote:
                'Legacy labour amounts corrected using the available rate catalogue. Review this baseline; pre-migration data is retained locally. / 历史人力成本已按现有汇率校正，请复核基线；迁移前数据已保留。',
            }
          : {}),
      };
    });
    document = {
      ...document,
      costVersions,
      costRows:
        costVersions.find((version) => version.code === document.activeVersion)
          ?.costRows || document.costRows,
    };
    changed = true;
  }
  if (document.costVersionLocks === undefined || document.costLock) {
    document = { ...document, costVersionLocks: getCostVersionLocks(document) };
    delete document.costLock;
    changed = true;
  }
  if (
    workflow &&
    (!document.workflowVersion ||
      !document.versionWorkflows ||
      !document.legacyWorkflowArchive ||
      document.reviewGates.some((g) => !g.costVersion))
  ) {
    document = migrateVersionWorkflows(document);
    changed = true;
  }
  if (workflow && document.workflowMode !== 'project') {
    if (workspace.projectStatus === 'completed')
      document = { ...document, projectStatus: 'completed' };
    document = normalizeProjectWorkflow(document);
    changed = true;
  }
  if (workflow && document.workflowEngineVersion !== 1) {
    document = migrateWorkflowEngine(document);
    changed = true;
  }
  return changed ? document : workspace;
};

/** Rejects malformed payloads before they can become the local source of truth. */
export const assertWorkspaceDocument = (workspace, projectId) => {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    throw new WorkspaceValidationError('workspace must be a JSON object.');
  }
  if (workspace.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceValidationError(
      `workspace.schemaVersion must be ${WORKSPACE_SCHEMA_VERSION}.`,
    );
  }
  if (!workspace.project || workspace.project.id !== projectId) {
    throw new WorkspaceValidationError(
      'workspace.project.id must match the URL project id.',
    );
  }
  if (!String(workspace.project.name || '').trim()) {
    throw new WorkspaceValidationError('workspace.project.name is required.');
  }
  if (!String(workspace.project.client || '').trim()) {
    throw new WorkspaceValidationError('workspace.project.client is required.');
  }
  if (workspace.project.currency !== 'SGD') {
    throw new WorkspaceValidationError(
      'workspace.project.currency must be SGD.',
    );
  }
  if (!validateWorkspaceSchema(workspace)) {
    const first = validateWorkspaceSchema.errors?.[0];
    const location = first?.instancePath || '/';
    throw new WorkspaceValidationError(
      `Workspace schema validation failed at ${location}: ${first?.message || 'invalid value'}.`,
    );
  }
  if (
    workspace.workflowHold &&
    (!Number.isFinite(Date.parse(workspace.workflowHold.startedAt)) ||
      new Date(workspace.workflowHold.startedAt).toISOString() !==
        workspace.workflowHold.startedAt)
  )
    throw new WorkspaceValidationError(
      'Project hold time must be a real ISO timestamp.',
      '/workflowHold/startedAt',
    );
  if (workspace.maintenanceBoq)
    assertMaintenanceWorkspace(workspace.maintenanceBoq);
  if (workspace.pricing?.profitShareRates !== undefined) {
    const errors = validateProfitShareRates(workspace.pricing.profitShareRates);
    if (errors.length)
      throw new WorkspaceValidationError(
        errors.join(' '),
        '/pricing/profitShareRates',
      );
  }
  if (workspace.ssr) assertSsr(workspace.ssr);
  if (workspace.cpq) {
    try {
      assertCpq(workspace.cpq);
    } catch (error) {
      throw new WorkspaceValidationError(error.message, '/cpq');
    }
  }
  if (
    workspace.currentWorkflowStepCode &&
    !workspace.processSteps.some(
      (step) => step.code === workspace.currentWorkflowStepCode,
    )
  ) {
    throw new WorkspaceValidationError(
      'workspace.currentWorkflowStepCode must reference processSteps[].code.',
    );
  }
  const statusCodes = workspace.projectStatusDefinitions.map(
    (status) => status.code,
  );
  if (!statusCodes.includes(workspace.projectStatus)) {
    throw new WorkspaceValidationError(
      'workspace.projectStatus must reference projectStatusDefinitions[].code.',
    );
  }
  if (new Set(statusCodes).size !== statusCodes.length) {
    throw new WorkspaceValidationError(
      'workspace.projectStatusDefinitions[].code values must be unique.',
    );
  }
  const workflowCodes = new Set(
    workspace.processSteps.map((step) => step.code),
  );
  for (const review of workspace.reviewGates) {
    if (review.projectId !== projectId) {
      throw new WorkspaceValidationError(
        'workspace.reviewGates[].projectId must match the project id.',
      );
    }
    if (
      review.workflowStepCode &&
      !workflowCodes.has(review.workflowStepCode) &&
      !workspace.versionWorkflows?.[review.costVersion]?.processSteps.some(
        (s) => s.code === review.workflowStepCode,
      ) &&
      !workspace.legacyWorkflowArchive?.[review.costVersion]?.processSteps.some(
        (s) => s.code === review.workflowStepCode,
      )
    ) {
      throw new WorkspaceValidationError(
        'workspace.reviewGates[].workflowStepCode must reference processSteps[].code.',
      );
    }
  }

  const requireUnique = (rows, key, location) => {
    if (new Set(rows.map((row) => row[key])).size !== rows.length)
      throw new WorkspaceValidationError(
        `${location} ${key} values must be unique.`,
        location,
      );
  };
  requireUnique(workspace.resourceTypes, 'id', '/resourceTypes');
  requireUnique(workspace.resourceTypes, 'code', '/resourceTypes');
  requireUnique(workspace.processSteps, 'code', '/processSteps');
  requireUnique(workspace.costVersions, 'code', '/costVersions');
  for (const collection of [
    'subcontractItems',
    'supplementalCostItems',
    'maintenancePriceRecords',
    'travelRows',
  ])
    requireUnique(workspace[collection], 'id', `/${collection}`);
  const versionCodes = new Set(
    workspace.costVersions.map((version) => version.code),
  );
  const archivedVersions = Object.entries(workspace.deletedCostVersions || {});
  const allVersionCodes = new Set([
    ...versionCodes,
    ...archivedVersions.map(([code]) => code),
  ]);
  for (const [code, entry] of archivedVersions) {
    if (
      versionCodes.has(code) ||
      entry.version.code !== code ||
      entry.version.state !== 'Suspended'
    )
      throw new WorkspaceValidationError(
        'Deleted costs must retain a distinct Suspended version snapshot.',
        `/deletedCostVersions/${code}`,
      );
    if (
      entry.workflow.currentWorkflowStepCode &&
      !entry.workflow.processSteps.some(
        (s) => s.code === entry.workflow.currentWorkflowStepCode,
      )
    )
      throw new WorkspaceValidationError(
        'Deleted cost workflow must retain a valid node.',
        `/deletedCostVersions/${code}/workflow`,
      );
  }
  if (!versionCodes.has(workspace.activeVersion))
    throw new WorkspaceValidationError(
      'Active version must exist in costVersions.',
      '/activeVersion',
    );
  if (workspace.processSteps.length && !workspace.currentWorkflowStepCode)
    throw new WorkspaceValidationError(
      'Select a current workflow node.',
      '/currentWorkflowStepCode',
    );
  if (
    workspace.processSteps.length &&
    workspace.processSteps[workspace.selectedStep]?.code !==
      workspace.currentWorkflowStepCode
  )
    throw new WorkspaceValidationError(
      'selectedStep must match the current workflow code.',
      '/selectedStep',
    );
  const validateRows = (rows, resources, location) => {
    requireUnique(rows, 'id', location);
    const ids = new Set(resources.map((resource) => resource.id));
    rows.forEach((row, index) => {
      if (row.inputMode === 'mandays') {
        if (
          row.mdPerSite !== 0 ||
          row.years.some(
            (year) =>
              year.sites !== 0 ||
              !Number.isFinite(year.mandays) ||
              year.mandays < 0,
          )
        )
          throw new WorkspaceValidationError(
            'Direct MD rows must have mandays and zero site fields.',
            `${location}/${index}`,
          );
      } else if (row.years.some((year) => Number(year.mandays || 0) !== 0))
        throw new WorkspaceValidationError(
          'Site rows cannot also carry direct mandays.',
          `${location}/${index}`,
        );
      if (row.reTypeId && !ids.has(row.reTypeId))
        throw new WorkspaceValidationError(
          'RE Type must exist in the version rate snapshot.',
          `${location}/${index}/reTypeId`,
        );
      if (
        row.years.some(
          (year, index) =>
            year.bucket !== ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'][index],
        )
      )
        throw new WorkspaceValidationError(
          'Annual buckets must be ordered Y1 through Y5.',
          `${location}/${index}/years`,
        );
    });
  };
  const active = workspace.costVersions.find(
    (version) => version.code === workspace.activeVersion,
  );
  const assertAllowanceSelection = (settings, resources, location) => {
    const issue = validatePersonnelAllowanceSelection(settings, resources)[0];
    if (issue)
      throw new WorkspaceValidationError(
        issue.message,
        `${location}${issue.path}`,
      );
  };
  assertAllowanceSelection(
    workspace.rateSettings,
    active.resourceTypes || workspace.resourceTypes,
    '',
  );
  validateRows(
    workspace.costRows,
    active.resourceTypes || workspace.resourceTypes,
    '/costRows',
  );
  const assertSubcontract = (value, confirmed, location) => {
    const issue = validateSubcontractCost(value, confirmed)[0];
    if (issue)
      throw new WorkspaceValidationError(
        issue.message,
        `${location}${issue.path}`,
      );
  };
  assertSubcontract(
    workspace.subcontractCost,
    active.state === 'Confirmed',
    '',
  );
  [
    ...workspace.costVersions,
    ...archivedVersions.map(([, entry]) => entry.version),
  ].forEach((version, index) => {
    const resources = version.resourceTypes || workspace.resourceTypes;
    requireUnique(resources, 'id', `/costVersions/${index}/resourceTypes`);
    requireUnique(resources, 'code', `/costVersions/${index}/resourceTypes`);
    assertAllowanceSelection(
      version.rateSettings,
      resources,
      `/costVersions/${index}`,
    );
    validateRows(
      version.costRows,
      resources,
      `/costVersions/${index}/costRows`,
    );
    assertSubcontract(
      version.subcontractCost,
      version.state === 'Confirmed',
      `/costVersions/${index}`,
    );
    if (
      version.sourceVersion &&
      (!allVersionCodes.has(version.sourceVersion) ||
        version.sourceVersion === version.code)
    )
      throw new WorkspaceValidationError(
        'Source version must reference another existing version.',
        `/costVersions/${index}/sourceVersion`,
      );
  });

  for (const code of Object.keys(workspace.costVersionLocks || {})) {
    if (!versionCodes.has(code))
      throw new WorkspaceValidationError(
        'A cost lock must reference an existing version.',
        `/costVersionLocks/${code}`,
      );
  }
  if (workspace.workflowVersion && !versionCodes.has(workspace.workflowVersion))
    throw new WorkspaceValidationError(
      'Workflow version must reference an existing cost version.',
      '/workflowVersion',
    );
  for (const [field, rounds] of Object.entries({
    versionWorkflows: workspace.versionWorkflows,
    legacyWorkflowArchive: workspace.legacyWorkflowArchive,
  })) {
    for (const [code, round] of Object.entries(rounds || {})) {
      if (
        !allVersionCodes.has(code) ||
        (round.currentWorkflowStepCode &&
          !round.processSteps.some(
            (s) => s.code === round.currentWorkflowStepCode,
          ))
      )
        throw new WorkspaceValidationError(
          'Workflow round must reference its cost version and a valid node.',
          `/${field}/${code}`,
        );
      requireUnique(
        round.processSteps,
        'code',
        `/${field}/${code}/processSteps`,
      );
    }
  }
  for (const gate of workspace.reviewGates) {
    if (gate.costVersion && !allVersionCodes.has(gate.costVersion))
      throw new WorkspaceValidationError(
        'Review must reference an existing cost version.',
        '/reviewGates',
      );
  }
  const uniqueFields = [
    ['reviewGates', workspace.reviewGates.map((review) => review.id)],
    ['quoteTemplates', workspace.quoteTemplates.map((template) => template.id)],
    ['assumptionLibrary', workspace.assumptionLibrary.map((item) => item.id)],
    ['quoteAssumptions', workspace.quoteAssumptions.map((item) => item.id)],
    ['quoteHistory', workspace.quoteHistory.map((record) => record.id)],
  ];
  try {
    assertMaintenanceImport({
      schemaVersion: '1.0.0',
      records: workspace.maintenancePriceRecords,
    });
  } catch (error) {
    throw new WorkspaceValidationError(
      error.message,
      '/maintenancePriceRecords',
    );
  }
  for (const [name, values] of uniqueFields) {
    if (new Set(values).size !== values.length) {
      throw new WorkspaceValidationError(
        `workspace.${name}[].id values must be unique.`,
      );
    }
  }
  const libraryIds = new Set(
    workspace.assumptionLibrary.map((item) => item.id),
  );
  workspace.quoteTemplates.forEach((template, index) => {
    for (const id of template.defaultAssumptionIds) {
      if (!libraryIds.has(id))
        throw new WorkspaceValidationError(
          'Template default assumption must reference assumptionLibrary[].id.',
          `/quoteTemplates/${index}/defaultAssumptionIds`,
        );
    }
  });
  // Quote source IDs and historical snapshots are provenance, not live foreign keys.
  if (
    !workspace.quoteTemplates.some(
      (template) => template.id === workspace.selectedQuoteTemplateId,
    )
  ) {
    throw new WorkspaceValidationError(
      'workspace.selectedQuoteTemplateId must reference quoteTemplates[].id.',
    );
  }
};
