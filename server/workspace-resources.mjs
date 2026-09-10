/** Narrow, revision-safe business resources. Full project JSON stays in-process. */
import {
  emptyCpq,
  mappingKey,
  calculationKey,
} from '../features/cpq/domain.ts';
import {
  assertMasterCapture,
  captureGlobalMasterData,
  capturedMasterFields,
  captureResourceRates,
  captureProfitShareRates,
} from '../features/master-data/capture.ts';
import { emptySsr } from '../features/ssr/domain.ts';
import {
  updateProjectWorkflow,
  isProjectWorkflowComplete,
  projectWorkflowSteps,
} from '../features/projects/workflow-domain.ts';
import { emptyMaintenance } from '../features/maintenance/domain.ts';
import {
  deleteSuspendedCostVersion,
  nextCostVersionCode,
} from '../features/cost/version-deletion.ts';
import {
  costLockReason,
  getCostVersionLocks,
} from '../features/cost/cost-lock.ts';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  recalculateCostRows,
  getHQTravelSummary,
  getCostStatementValues,
} from '../features/cost/domain.ts';
import {
  RepositoryNotFoundError,
  RepositoryConflictError,
  WorkspaceValidationError,
} from './workspace-repository.mjs';

export const MASTER_TABS = {
  resources: ['resourceTypes', 'id'],
  subcontract: ['subcontractItems', 'id'],
  supplemental: ['supplementalCostItems', 'id'],
  maintenance: ['maintenancePriceRecords', 'id'],
  assumptions: ['assumptionLibrary', 'id'],
  'quote-templates': ['quoteTemplates', 'id'],
  workflow: ['processSteps', 'code'],
  status: ['projectStatusDefinitions', 'code'],
};
const COST_SETTING_FIELDS = [
  'state',
  'rateSettings',
  'travelSettings',
  'travelUplift',
  'manualCosts',
];
const SSR_SETTING_FIELDS = [
  'enabled',
  'proposalNumber',
  'companyUrl',
  'cpqUrl',
  'scopeBrief',
  'technicalBasis',
  'mode',
  'requiredDomains',
];
const PROJECT_METADATA_FIELDS = [
  'proposalNumber',
  'companyUrl',
  'cpqUrl',
  'scopeBrief',
  'technicalBasis',
  'mode',
];
const CPQ_SETTING_FIELDS = [
  'brief',
  'costVersion',
  'targetCost',
  'targetBasis',
  'tolerance',
  'rounding',
  'allocationBasis',
];
/** Select own fields in requested order without cloning nested values. */
const pickOwnFields = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
/** Preserve the validation error type consumed by HTTP and CLI adapters. */
const throwValidationError = (message) => {
  throw new WorkspaceValidationError(message);
};
/** Reject the first unsupported field in the caller-provided key order. */
const assertAllowedFields = (object, keys) => {
  for (const key of Object.keys(object))
    if (!keys.includes(key))
      throwValidationError(
        `Unsupported field: ${key}. Allowed: ${keys.join(', ')}`,
      );
};
/** Resolve a live project and distinguish deleted projects in not-found errors. */
const requireProjectRecord = (repository, id) => {
  const record = repository.get(id);
  if (!record)
    throw new RepositoryNotFoundError(
      'Project not found or deleted.',
      repository.isDeleted(id),
    );
  return record;
};
/** Reject stale optimistic-concurrency revisions with the caller's existing message. */
function assertProjectRevision(
  record,
  expectedRevision,
  message = 'Project changed. Read this resource again.',
) {
  if (record.revision !== expectedRevision)
    throw new RepositoryConflictError(message, record.revision);
}

/** Read a CPQ mapping key while exposing invalid draft data as a readable issue. */
const readMappingStatus = (cpq) => {
  try {
    return { key: mappingKey(cpq), issue: null };
  } catch (error) {
    return { key: null, issue: error.message };
  }
};

/** Exclude canonical keys (which embed entire snapshots), never price inputs. */
export const compactValue = (value) => {
  if (Array.isArray(value)) return value.map(compactValue);
  if (!value || typeof value !== 'object') return value;
  const hidden = [
    'costBaseline',
    'costKey',
    'inputKey',
    'key',
    'commercialBasis',
    'commercialKey',
    'bidKey',
  ];
  return Object.fromEntries(
    Object.entries(
      value.costBaseline?.code
        ? { ...value, costVersion: value.costBaseline.code }
        : value,
    )
      .filter(([key]) => !hidden.includes(key))
      .map(([key, entry]) => [key, compactValue(entry)]),
  );
};
/** Build compact revision metadata and command-specific archive/submission details. */
export const mutationReceipt = (record, command, subjectId, version) => {
  const workspace = record.workspace;
  const data = {
    projectId: record.projectId,
    revision: record.revision,
    workflowVersion: workspace.workflowVersion || workspace.activeVersion,
    updatedAt: record.updatedAt,
    costLockReason: costLockReason(workspace, version),
  };
  if (command === 'cpq.solve')
    data.result = compactValue(workspace.cpq.draft.result);
  if (command === 'cpq.confirm')
    data.confirmation = compactValue(workspace.cpq.draft.confirmation);
  if (command === 'cpq.archive')
    data.archiveId = workspace.cpq.archives.at(-1).id;
  if (command === 'maintenance.archive')
    data.archiveId = workspace.maintenanceBoq.archives.at(-1).id;
  if (command.startsWith('ssr.')) {
    data.submissionId =
      command === 'ssr.submit'
        ? workspace.ssr.submissions.at(-1)?.id
        : subjectId;
    const submission = workspace.ssr.submissions.find(
      (s) => s.id === data.submissionId,
    );
    if (submission) {
      data.version = submission.costBaseline.code;
      data.costLockReason = costLockReason(workspace, data.version);
    }
  }
  return data;
};

/** Locate project metadata, workflow views, or editable project settings. */
function locateProjectResource(workspace, section) {
  if (section === 'metadata') {
    const value = workspace.ssr || emptySsr();
    return {
      object: pickOwnFields(value, PROJECT_METADATA_FIELDS),
      fields: PROJECT_METADATA_FIELDS,
    };
  }
  if (section === 'workflow-tracking') {
    const step = workspace.processSteps.find(
      (s) => s.code === workspace.currentWorkflowStepCode,
    );
    return {
      object: {
        ...(workspace.workflowHold
          ? { workflowHold: structuredClone(workspace.workflowHold) }
          : {}),
        workflowMode: workspace.workflowMode,
        currentWorkflowStepCode: workspace.currentWorkflowStepCode,
        name: step?.name || '',
        nameZh: step?.nameZh || '',
        owner: step?.owner || '',
        followUpDate: step?.followUpDate || '',
        note: step?.note || '',
        updatedAt: step?.updatedAt || '',
        workflowVersion: workspace.workflowVersion || workspace.activeVersion,
        completed: isProjectWorkflowComplete(workspace),
        stages: projectWorkflowSteps(workspace).map((s) =>
          pickOwnFields(s, ['code', 'name', 'nameZh', 'owner']),
        ),
      },
      fields: ['currentWorkflowStepCode', 'owner', 'followUpDate', 'note'],
    };
  }
  if (section === 'workflow-history')
    return {
      items: [...(workspace.workflowUpdates || [])].reverse(),
      key: 'id',
      readonly: true,
    };
  if (section && section !== 'settings') {
    const fields = {
      workflow: ['processSteps', 'code'],
      status: ['projectStatusDefinitions', 'code'],
      reviews: ['reviewGates', 'id'],
      subcontract: ['subcontractItems', 'id'],
      supplemental: ['supplementalCostItems', 'id'],
    };
    const target = fields[section];
    if (!target)
      throwValidationError(
        'Project sections: settings, workflow-tracking, workflow-history, workflow, status, reviews, subcontract, supplemental',
      );
    return {
      parent: workspace,
      field: target[0],
      key: target[1],
      readonly:
        ['subcontract', 'supplemental'].includes(section) ||
        workspace.workflowMode === 'project',
    };
  }
  return {
    object: {
      ...workspace.project,
      projectStatus: workspace.projectStatus,
      currentWorkflowStepCode: workspace.currentWorkflowStepCode,
      activeVersion: workspace.activeVersion,
      workflowVersion: workspace.workflowVersion || workspace.activeVersion,
    },
    fields:
      workspace.workflowMode === 'project'
        ? ['name', 'client']
        : ['name', 'client', 'projectStatus', 'currentWorkflowStepCode'],
  };
}

/** Locate version-specific cost data and derived summaries. */
function locateCostResource(workspace, options) {
  const section = options.section;
  if (section === 'deleted-versions')
    return {
      items: Object.values(workspace.deletedCostVersions || {}).map(
        (entry) => ({
          ...pickOwnFields(entry.version, [
            'code',
            'state',
            'createdAt',
            'sourceVersion',
          ]),
          removedAt: entry.removedAt,
        }),
      ),
      key: 'code',
      readonly: true,
    };
  if (section === 'archive') {
    const version = options.version;
    const entry = workspace.deletedCostVersions?.[version];
    if (!entry)
      throw new RepositoryNotFoundError(
        'Deleted cost version archive not found.',
      );
    return { object: entry, fields: [], version, readonly: true };
  }
  if (section === 'versions') {
    const locks = getCostVersionLocks(workspace);
    return {
      items: workspace.costVersions.map((costVersion) => ({
        ...pickOwnFields(costVersion, [
          'code',
          'state',
          'createdAt',
          'sourceVersion',
        ]),
        costLockReason: locks[costVersion.code]?.reason || null,
      })),
      key: 'code',
      readonly: true,
    };
  }
  const version = options.version || workspace.activeVersion;
  const costVersion = workspace.costVersions.find(
    (costVersion) => costVersion.code === version,
  );
  if (!costVersion)
    throw new RepositoryNotFoundError(`Cost version not found: ${version}`);
  if (section === 'workflow')
    return {
      object: workspace.versionWorkflows?.[version] || {},
      fields: [],
      version,
      readonly: true,
    };
  if (!section || section === 'rows')
    return { parent: costVersion, field: 'costRows', key: 'id', version };
  if (section === 'subcontract')
    return {
      object: structuredClone(
        costVersion.subcontractCost || {
          mode: 'project',
          lines: [],
          siteTypes: [],
        },
      ),
      fields: ['mode', 'lines', 'siteTypes'],
      version,
    };
  if (section === 'settings')
    return {
      object: pickOwnFields(costVersion, COST_SETTING_FIELDS),
      fields: COST_SETTING_FIELDS,
      version,
    };
  if (section === 'resources')
    return {
      parent: costVersion,
      field: 'resourceTypes',
      key: 'id',
      version,
      readonly: true,
    };
  if (section === 'travel')
    return { parent: costVersion, field: 'travelRows', key: 'id', version };
  if (section === 'summary') {
    const rows = recalculateCostRows(
      costVersion.costRows,
      costVersion.resourceTypes,
      costVersion.rateSettings,
    );
    const travel = getHQTravelSummary(
      rows,
      costVersion.resourceTypes,
      costVersion.travelSettings,
    ).totalCost;
    return {
      object: getCostStatementValues(
        rows,
        costVersion.resourceTypes,
        travel,
        costVersion.manualCosts,
        costVersion.subcontractCost,
      ),
      version,
      readonly: true,
    };
  }
  throwValidationError(
    'Cost sections: rows, subcontract, settings, resources, travel, summary, versions',
  );
}

/** Locate CPQ draft data, lazily initializing the project CPQ state. */
function locateCpqResource(workspace, section) {
  workspace.cpq ||= emptyCpq();
  if (section === 'catalog')
    return {
      parent: workspace.cpq,
      field: 'catalog',
      key: 'code',
      readonly: true,
    };
  if (section === 'selections')
    return { parent: workspace.cpq.draft, field: 'selections', key: 'code' };
  if (!section || section === 'draft')
    return { object: workspace.cpq.draft, fields: CPQ_SETTING_FIELDS };
  if (section === 'archives')
    return {
      items: workspace.cpq.archives.map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        costVersion: a.costVersion,
        proposalNumber: a.proposalNumber,
        totalCost: a.result.totalCost,
        difference: a.result.difference,
      })),
      key: 'id',
      readonly: true,
    };
  throwValidationError('CPQ sections: catalog, draft, selections, archives');
}

/** Locate quote settings and collections while keeping shared catalogs read-only. */
function locateQuoteResource(workspace, section) {
  if (section === 'templates')
    return {
      parent: workspace,
      field: 'quoteTemplates',
      key: 'id',
      readonly: true,
    };
  if (section === 'library')
    return {
      parent: workspace,
      field: 'assumptionLibrary',
      key: 'id',
      readonly: true,
    };
  if (!section || section === 'settings')
    return {
      object: {
        pricing: workspace.pricing,
        selectedQuoteTemplateId: workspace.selectedQuoteTemplateId,
      },
      fields: ['pricing', 'selectedQuoteTemplateId'],
    };
  if (section === 'assumptions')
    return { parent: workspace, field: 'quoteAssumptions', key: 'id' };
  if (section === 'history')
    return {
      parent: workspace,
      field: 'quoteHistory',
      key: 'id',
      readonly: true,
    };
  throwValidationError(
    'Quote sections: settings, assumptions, templates, library, history',
  );
}

/** Locate SSR settings or review records, preserving lazy initialization. */
function locateSsrResource(workspace, section) {
  workspace.ssr ||= emptySsr();
  if (!section || section === 'settings')
    return {
      object: pickOwnFields(workspace.ssr, SSR_SETTING_FIELDS),
      fields: SSR_SETTING_FIELDS,
    };
  if (section === 'bid-responses')
    return { parent: workspace.ssr, field: 'bidResponses', key: 'id' };
  if (section === 'submissions')
    return {
      parent: workspace.ssr,
      field: 'submissions',
      key: 'id',
      readonly: true,
    };
  throwValidationError('SSR sections: settings, bid-responses, submissions');
}

/** Locate maintenance data without initializing BOQ state for reference reads. */
function locateBoqResource(workspace, section) {
  if (section === 'references')
    return {
      parent: workspace,
      field: 'maintenancePriceRecords',
      key: 'id',
      readonly: true,
    };
  workspace.maintenanceBoq ||= emptyMaintenance();
  if (section === 'settings')
    return {
      object: { coverageMonths: workspace.maintenanceBoq.coverageMonths },
      fields: ['coverageMonths'],
    };
  if (!section || section === 'rows')
    return { parent: workspace.maintenanceBoq, field: 'boq', key: 'id' };
  if (section === 'archives')
    return {
      items: workspace.maintenanceBoq.archives.map((a) =>
        pickOwnFields(a, [
          'id',
          'createdAt',
          'client',
          'coverageMonths',
          'cost',
          'quote',
        ]),
      ),
      key: 'id',
      readonly: true,
    };
  throwValidationError('BOQ sections: rows, settings, references, archives');
}

/** Dispatch a resource lookup without changing module-specific validation order. */
function locateResource(workspace, module, options) {
  const { section } = options;
  switch (module) {
    case 'project':
      return locateProjectResource(workspace, section);
    case 'masterdata':
      throwValidationError(
        'Master Data is global. Use masterdata get/update --tab TAB without a project ID.',
      );
      break;
    case 'cost':
      return locateCostResource(workspace, options);
    case 'cpq':
      return locateCpqResource(workspace, section);
    case 'quote':
      return locateQuoteResource(workspace, section);
    case 'ssr':
      return locateSsrResource(workspace, section);
    case 'boq':
      return locateBoqResource(workspace, section);
    default:
      throwValidationError(`Unknown resource: ${module}`);
  }
}

/** Read one object or filtered collection without returning the full workspace. */
export function readResource(repository, id, module, options = {}) {
  const record = requireProjectRecord(repository, id);
  if (module === 'project' && options.section === 'workflow-plan')
    return {
      ...mutationReceipt(record, ''),
      resource: module,
      section: options.section,
      value: repository.workflowPlan(id),
    };
  const target = locateResource(record.workspace, module, options);
  const data = {
    ...mutationReceipt(record, '', undefined, target.version),
    resource: module,
    section:
      options.tab ||
      options.section ||
      (module === 'cost' || module === 'boq'
        ? 'rows'
        : module === 'cpq'
          ? 'draft'
          : 'settings'),
    ...(target.version ? { version: target.version } : {}),
  };
  if (target.object) {
    if (
      ['id', 'query', 'offset', 'limit'].some(
        (key) => options[key] !== undefined,
      )
    )
      throwValidationError(
        'Filters and pagination require a collection section.',
      );
    data.value = compactValue(target.object);
    if (module === 'cpq') {
      const cpq = record.workspace.cpq;
      const mapping = readMappingStatus(cpq);
      const baseline = record.workspace.costVersions.find(
        (versionSnapshot) => versionSnapshot.code === cpq.draft.costVersion,
      );
      data.value.confirmationValid =
        !!cpq.draft.confirmation && cpq.draft.confirmation.key === mapping.key;
      data.value.resultCurrent =
        mapping.key !== null &&
        !!cpq.draft.result &&
        !!baseline &&
        cpq.draft.result.inputKey === calculationKey(cpq, baseline);
      if (mapping.issue) data.value.mappingIssue = mapping.issue;
    }
    return data;
  }
  return {
    ...data,
    ...readCollectionPage(
      target.items || target.parent[target.field],
      target.key,
      options,
    ),
  };
}

/** Filter collection strings using NFKC matching, then validate and slice the page. */
function readCollectionPage(collection, key, options) {
  let items = collection;
  if (options.id) items = items.filter((item) => item[key] === options.id);
  if (options.query) {
    const query = String(options.query).normalize('NFKC').toLowerCase();
    items = items.filter((item) =>
      Object.values(item).some(
        (value) =>
          typeof value === 'string' &&
          value.normalize('NFKC').toLowerCase().includes(query),
      ),
    );
  }
  const offset = Number(options.offset ?? 0),
    limit = Number(options.limit ?? 50);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throwValidationError('offset must be >= 0; limit must be 1–200.');
  return {
    total: items.length,
    offset,
    limit,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    items: compactValue(items.slice(offset, offset + limit)),
  };
}

/** Validate collection edits before removing, cloning and shallow-merging records. */
function patchCollection(items, key, changes) {
  if (changes.set !== undefined)
    throwValidationError('Collection updates use upsert/remove, not set.');
  const updates = changes.upsert || [],
    remove = changes.remove || [];
  const seen = new Set();
  for (const item of updates) {
    if (typeof item[key] !== 'string' || !item[key].trim())
      throwValidationError(`Each upsert requires ${key}.`);
    if (seen.has(item[key]) || remove.includes(item[key]))
      throwValidationError('Duplicate or contradictory record IDs.');
    seen.add(item[key]);
  }
  if (new Set(remove).size !== remove.length)
    throwValidationError('Duplicate remove IDs.');
  for (const id of remove)
    if (!items.some((i) => i[key] === id))
      throwValidationError(`Cannot remove unknown ${key}: ${id}`);
  const remaining = items.filter((item) => !remove.includes(item[key]));
  for (const item of updates) {
    const index = remaining.findIndex((old) => old[key] === item[key]);
    if (index === -1) remaining.push(structuredClone(item));
    else remaining[index] = { ...remaining[index], ...structuredClone(item) };
  }
  return remaining;
}

/** Reorder only personnel, keeping saved legacy subcontract rows in their slots. */
function orderPersonnelRows(rows, order, resources) {
  if (
    !Array.isArray(order) ||
    order.length > 100000 ||
    order.some((id) => typeof id !== 'string' || !id.trim()) ||
    new Set(order).size !== order.length
  )
    throwValidationError(
      'order must list unique personnel row IDs, at most 100,000.',
    );
  const subcontractIds = new Set(
    resources
      .filter((resource) => resource.category === 'subcontract')
      .map((resource) => resource.id),
  );
  const personnel = rows.filter((row) => !subcontractIds.has(row.reTypeId));
  const byId = new Map(personnel.map((row) => [row.id, row]));
  if (
    order.length !== personnel.length ||
    byId.size !== personnel.length ||
    order.some((id) => !byId.has(id))
  )
    throwValidationError(
      'order must contain every current personnel row ID exactly once after upsert/remove; exclude legacy subcontract rows.',
    );
  let index = 0;
  return rows.map((row) =>
    subcontractIds.has(row.reTypeId) ? row : byId.get(order[index++]),
  );
}

/** Validate an object patch, preserve shallow merges, and write it to its owner. */
function patchObjectResource(workspace, module, options, target, changes) {
  if (
    changes.upsert !== undefined ||
    changes.remove !== undefined ||
    !changes.set
  )
    throwValidationError('Object updates require set.');
  assertAllowedFields(changes.set, target.fields);
  for (const [key, value] of Object.entries(changes.set)) {
    // Nested settings are shallow patches; arrays (e.g. annualUplifts) replace.
    const old = target.object[key];
    target.object[key] =
      old &&
      typeof old === 'object' &&
      !Array.isArray(old) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
        ? { ...old, ...value }
        : value;
    if (module === 'cost')
      applyLegacyCostSettings(workspace, target, key, value);
  }
  commitObjectResource(workspace, module, options.section, target);
}

/** Preserve legacy allowance and manual-service patch semantics after each field merge. */
function applyLegacyCostSettings(workspace, target, key, value) {
  if (
    key === 'rateSettings' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, 'allowancePools')
  ) {
    if (Object.hasOwn(value, 'allowanceResourceTypeIds')) {
      // An explicit legacy client selection must not be masked by saved Pool settings.
      delete target.object.rateSettings.allowancePools;
    } else if (Object.hasOwn(value, 'localArpAllowanceEnabled')) {
      if (typeof value.localArpAllowanceEnabled !== 'boolean')
        throwValidationError(
          'localArpAllowanceEnabled must be boolean. Use allowancePools to select personnel categories.',
        );
      target.object.rateSettings.allowancePools = value.localArpAllowanceEnabled
        ? ['LOCAL', 'ARP']
        : [];
      const version = workspace.costVersions.find(
        (versionSnapshot) => versionSnapshot.code === target.version,
      );
      target.object.rateSettings.allowanceResourceTypeIds =
        value.localArpAllowanceEnabled
          ? version.resourceTypes
              .filter(
                (resource) =>
                  resource.category === 'internal' &&
                  ['LOCAL', 'ARP'].includes(resource.pool),
              )
              .map((resource) => resource.id)
          : [];
    }
  }
  if (
    key === 'manualCosts' &&
    value &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'otherService') &&
    !Object.hasOwn(value, 'otherServiceRate')
  )
    delete target.object.manualCosts.otherServiceRate;
}

/** Route an already patched object back to the same workspace/version container. */
function commitObjectResource(workspace, module, section, target) {
  if (module === 'project' && section === 'metadata') {
    workspace.ssr = { ...(workspace.ssr || emptySsr()), ...target.object };
  } else if (module === 'project') {
    Object.assign(
      workspace.project,
      pickOwnFields(target.object, ['name', 'client']),
    );
    Object.assign(
      workspace,
      pickOwnFields(target.object, [
        'projectStatus',
        'currentWorkflowStepCode',
      ]),
    );
  } else if (module === 'cost' && section === 'subcontract')
    workspace.costVersions.find(
      (versionSnapshot) => versionSnapshot.code === target.version,
    ).subcontractCost = target.object;
  else if (module === 'cost')
    Object.assign(
      workspace.costVersions.find(
        (versionSnapshot) => versionSnapshot.code === target.version,
      ),
      target.object,
    );
  else if (module === 'quote') Object.assign(workspace, target.object);
  else if (module === 'cpq') workspace.cpq.draft = target.object;
  else if (module === 'ssr') Object.assign(workspace.ssr, target.object);
  else if (module === 'boq')
    Object.assign(workspace.maintenanceBoq, target.object);
}

/** Update either workflow engine through its existing persistence entry point. */
function updateWorkflowTracking(
  repository,
  id,
  workspace,
  changes,
  expectedRevision,
) {
  assertAllowedFields(changes, ['set']);
  if (!changes.set)
    throwValidationError('Workflow tracking updates require set.');
  if (workspace.workflowEngineVersion === 1) {
    assertAllowedFields(changes.set, [
      'currentWorkflowStepCode',
      'owner',
      'followUpDate',
      'note',
    ]);
    const {
      currentWorkflowStepCode = workspace.currentWorkflowStepCode,
      ...fields
    } = changes.set;
    return repository.applyWorkflowAction(
      id,
      {
        nodeCode: currentWorkflowStepCode,
        action:
          currentWorkflowStepCode === workspace.currentWorkflowStepCode
            ? 'update'
            : 'start',
        ...fields,
      },
      expectedRevision,
    );
  }

  // Legacy workflow validation still becomes the public validation error type.
  let updated;
  try {
    updated = updateProjectWorkflow(workspace, changes.set);
  } catch (error) {
    throwValidationError(error.message);
  }
  return repository.save(id, updated, expectedRevision);
}

/** Apply a revision-checked resource patch, recalculate dependent state, and save. */
export function updateResource(
  repository,
  id,
  module,
  options,
  changes,
  expectedRevision,
) {
  const record = requireProjectRecord(repository, id);
  assertProjectRevision(record, expectedRevision);
  const workspace = record.workspace;
  if (module === 'project' && options.section === 'workflow-tracking') {
    const saved = updateWorkflowTracking(
      repository,
      id,
      workspace,
      changes,
      expectedRevision,
    );
    return {
      ...mutationReceipt(saved, ''),
      resource: module,
      section: options.section,
      changedFields: Object.keys(changes.set),
      changedIds: [],
      removedIds: [],
    };
  }
  if (
    module === 'ssr' &&
    workspace.workflowMode === 'project' &&
    options.section &&
    options.section !== 'settings'
  )
    throwValidationError(
      'Historical SSR reviews are read-only. Update project --section workflow-tracking.',
    );
  // Capture validation baselines before locating or mutating lazy resource state.
  const oldMapping =
    module === 'cpq'
      ? readMappingStatus(workspace.cpq || emptyCpq()).key
      : null;
  const locked = costLockReason(
    workspace,
    options.version || workspace.activeVersion,
  );
  const finalizingOnly =
    module === 'cost' &&
    options.section === 'settings' &&
    Object.keys(changes).length === 1 &&
    Object.keys(changes.set || {}).length === 1 &&
    changes.set.state === 'Confirmed';
  if (locked && module === 'cost' && !finalizingOnly)
    throwValidationError(locked);
  const target = locateResource(workspace, module, options);
  if (target.readonly)
    throwValidationError(
      'This section is read-only; use the explicit workflow command.',
    );
  assertAllowedFields(changes, ['set', 'upsert', 'remove', 'order']);
  // Personnel-only normalization precedes source-evidence and empty-patch checks.
  const personnelRows =
    module === 'cost' && (!options.section || options.section === 'rows');
  if (changes.order !== undefined && !personnelRows)
    throwValidationError('order is available only for cost rows.');
  if (personnelRows && Array.isArray(changes.upsert)) {
    changes = {
      ...changes,
      upsert: changes.upsert.map((row) =>
        typeof row.groupName === 'string'
          ? { ...row, groupName: row.groupName.trim() }
          : row,
      ),
    };
  }
  if (
    module === 'cost' &&
    (!options.section || options.section === 'rows') &&
    (changes.upsert || []).some((item) => Object.hasOwn(item, 'source'))
  )
    throwValidationError(
      'Import source evidence is read-only. Use cost import to attach original TD/PM input.',
    );
  if (
    !Object.keys(changes).length ||
    !(
      Object.keys(changes.set || {}).length ||
      changes.upsert?.length ||
      changes.remove?.length ||
      changes.order !== undefined
    )
  )
    throwValidationError('At least one change is required.');
  if (target.object) {
    patchObjectResource(workspace, module, options, target, changes);
  } else {
    target.parent[target.field] = patchCollection(
      target.parent[target.field],
      target.key,
      changes,
    );
    if (changes.order !== undefined)
      target.parent[target.field] = orderPersonnelRows(
        target.parent[target.field],
        changes.order,
        target.parent.resourceTypes,
      );
  }
  if (
    module === 'project' ||
    (module === 'masterdata' && options.tab === 'workflow')
  ) {
    const index = workspace.processSteps.findIndex(
      (s) => s.code === workspace.currentWorkflowStepCode,
    );
    if (index < 0)
      throwValidationError(
        'Current workflow node cannot be removed. Select another node first.',
      );
    workspace.selectedStep = index;
  }
  // Recalculate costs and invalidate CPQ outputs before the single repository save.
  if (module === 'cost') syncVersion(workspace, target.version);
  if (module === 'cpq') {
    const mapping = readMappingStatus(workspace.cpq).key;
    if (mapping === null || mapping !== oldMapping)
      delete workspace.cpq.draft.confirmation;
    delete workspace.cpq.draft.result;
  }
  const saved = repository.save(id, workspace, expectedRevision);
  return {
    ...mutationReceipt(saved, '', undefined, target.version),
    resource: module,
    section: options.tab || options.section || 'default',
    ...(target.version ? { version: target.version } : {}),
    changedIds: (changes.upsert || []).map((i) => i[target.key]),
    removedIds: changes.remove || [],
    changedFields: [
      ...Object.keys(changes.set || {}),
      ...(changes.order === undefined ? [] : ['order']),
    ],
    ...(changes.order === undefined
      ? {}
      : { reorderedCount: changes.order.length }),
  };
}

/** Recalculate a version and mirror active-version inputs into legacy workspace fields. */
export function syncVersion(workspace, code) {
  const versionSnapshot = workspace.costVersions.find(
    (versionSnapshot) => versionSnapshot.code === code,
  );
  versionSnapshot.costRows = recalculateCostRows(
    versionSnapshot.costRows,
    versionSnapshot.resourceTypes,
    versionSnapshot.rateSettings,
  );
  if (code === workspace.activeVersion)
    Object.assign(
      workspace,
      pickOwnFields(versionSnapshot, [
        'costRows',
        'rateSettings',
        'travelSettings',
        'travelRows',
        'travelUplift',
        'manualCosts',
        'subcontractCost',
      ]),
    );
  if (
    code === workspace.activeVersion &&
    !Object.hasOwn(versionSnapshot, 'subcontractCost')
  )
    delete workspace.subcontractCost;
}

/** Explicitly capture current global personnel rates into an unlocked Draft version. */
export function applyMasterRates(repository, id, version, revision) {
  const record = requireProjectRecord(repository, id);
  const locked = costLockReason(record.workspace, version);
  if (locked) throwValidationError(locked);
  const versionSnapshot = record.workspace.costVersions.find(
    (versionSnapshot) => versionSnapshot.code === version,
  );
  if (!versionSnapshot)
    throw new RepositoryNotFoundError('Cost version not found.');
  if (versionSnapshot.state !== 'Draft')
    throwValidationError(
      'Only an editable Draft can explicitly apply global personnel rates.',
    );
  const master = readValidatedMasterCatalog(repository, 'resources');
  try {
    Object.assign(
      versionSnapshot,
      captureResourceRates(versionSnapshot, master),
    );
  } catch (error) {
    throwValidationError(error.message);
  }
  syncVersion(record.workspace, version);
  return {
    ...mutationReceipt(
      repository.save(id, record.workspace, revision),
      '',
      undefined,
      version,
    ),
    version,
  };
}

/** Cost assumptions start empty until the user supplies actual delivery inputs. */
const blankCostInputs = (resourceTypes) => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    resourceTypes,
    costRows: [],
    rateSettings: {
      quoteAsOf: today,
      tdStart: '',
      tdEnd: '',
      baseYear: Number(today.slice(0, 4)),
      defaultUplift: 0,
      annualUplifts: [0, 0, 0, 0, 0],
      localArpAllowanceEnabled: false,
      allowancePools: [],
      allowanceResourceTypeIds: [],
    },
    travelSettings: {
      enabled: false,
      monthlyAllowance: 0,
      airfarePerTrip: 0,
      trips: 0,
    },
    travelRows: [],
    travelUplift: 0,
    manualCosts: {
      localPurchasedEquipment: 0,
      inlandLogistics: 0,
      countryWarehousing: 0,
      nonInHouseLabour: 0,
      settlement: 0,
      carFee: 0,
      otherService: 0,
      otherServiceRate: 0.01,
      riskContingency: 0,
    },
  };
};

/** Create-only, including for deleted IDs: recovery is always explicit. */
export function createProject(repository, project) {
  let workspace;
  try {
    workspace = captureGlobalMasterData(
      createBlankWorkspace(
        projectRecord(project.id, project.name, project.client),
        'input_preparation',
      ),
      repository.globalMasterData.all(),
    );
  } catch (error) {
    throwValidationError(error.message);
  }
  if (project.reviewOwner)
    workspace.processSteps = workspace.processSteps.map((step) => ({
      ...step,
      owner: project.reviewOwner,
    }));
  Object.assign(workspace, blankCostInputs(workspace.resourceTypes));
  workspace.workflowTemplateRevision = workspace.masterDataRevisions.workflow;
  workspace.costVersions = [createCostVersion('V1', 'Draft', null, workspace)];
  workspace.costVersions[0].masterDataRevision =
    workspace.masterDataRevisions.resources;
  const saved = repository.save(project.id, workspace, null);
  return { ...mutationReceipt(saved, ''), resource: 'project', version: 'V1' };
}

/** Starts a new active Draft and a separate DTRB round; old cost baselines remain intact. */
export function createCostDraft(repository, id, options, revision) {
  if (!['blank', 'clone'].includes(options.mode))
    throwValidationError('--mode must be blank or clone.');
  if ((options.mode === 'clone') !== Boolean(options.sourceVersion))
    throwValidationError(
      'clone requires --source-version; blank does not accept it.',
    );
  const record = requireProjectRecord(repository, id);
  assertProjectRevision(record, revision);
  const workspace = record.workspace;
  const source =
    options.mode === 'clone'
      ? workspace.costVersions.find(
          (versionSnapshot) => versionSnapshot.code === options.sourceVersion,
        )
      : null;
  if (options.mode === 'clone' && !source)
    throw new RepositoryNotFoundError('Source cost version not found.');
  const next = nextCostVersionCode(workspace);
  const master = source
    ? null
    : readValidatedMasterCatalog(repository, 'resources');
  const version = createCostVersion(
    next,
    'Draft',
    source?.code || null,
    source || blankCostInputs(master.items),
  );
  if (master) version.masterDataRevision = master.revision;
  else if (source.masterDataRevision)
    version.masterDataRevision = source.masterDataRevision;
  workspace.costVersions.push(version);
  workspace.activeVersion = version.code;
  syncVersion(workspace, version.code);
  return {
    ...mutationReceipt(
      repository.save(id, workspace, revision),
      '',
      undefined,
      version.code,
    ),
    resource: 'cost',
    section: 'versions',
    version: version.code,
  };
}

/** Remove a suspended version from the working list while retaining its immutable history. */
export function deleteCostVersion(repository, id, version, revision) {
  const record = requireProjectRecord(repository, id);
  assertProjectRevision(record, revision);
  if (
    !record.workspace.costVersions.some(
      (versionSnapshot) => versionSnapshot.code === version,
    )
  )
    throw new RepositoryNotFoundError(
      'Cost version not found or already deleted.',
    );
  let next;
  try {
    next = deleteSuspendedCostVersion(record.workspace, version);
  } catch (error) {
    throwValidationError(error.message);
  }
  const saved = repository.save(id, next, revision);
  return {
    ...mutationReceipt(saved, '', undefined, saved.workspace.activeVersion),
    resource: 'cost',
    section: 'versions',
    version,
    deleted: true,
    removedIds: [version],
  };
}

/** Explicitly apply a shared catalogue; normal master-data writes never visit projects. */
function readValidatedMasterCatalog(repository, tab) {
  try {
    return assertMasterCapture(
      repository.globalMasterData.get(tab, { limit: 10000 }),
    );
  } catch (error) {
    throwValidationError(error.message);
  }
}

/** Adopt a shared catalog while preserving referenced history and pricing exceptions. */
export function applyProjectMasterData(repository, id, tab, revision) {
  if (
    ![
      'subcontract',
      'supplemental',
      'maintenance',
      'assumptions',
      'quote-templates',
      'profit-share',
      'cpq-catalog',
    ].includes(tab)
  )
    throwValidationError(
      'Apply catalog tabs: subcontract, supplemental, maintenance, assumptions, quote-templates, profit-share, cpq-catalog. Personnel rates require cost apply-rates --version; workflow templates only seed new projects.',
    );
  const record = requireProjectRecord(repository, id);
  assertProjectRevision(
    record,
    revision,
    'Project changed. Read its revision again.',
  );
  const active = record.workspace.costVersions.find(
    (versionSnapshot) =>
      versionSnapshot.code === record.workspace.activeVersion,
  );
  const locked = costLockReason(
    record.workspace,
    record.workspace.activeVersion,
  );
  if (tab !== 'profit-share' && locked) throwValidationError(locked);
  if (tab !== 'profit-share' && active?.state !== 'Draft')
    throwValidationError(
      'Create or select an editable Draft before applying global catalogs.',
    );
  const master = readValidatedMasterCatalog(repository, tab);
  const workspace = record.workspace;
  if (tab === 'profit-share') {
    workspace.pricing = captureProfitShareRates(workspace.pricing, master);
  } else if (tab === 'cpq-catalog') {
    workspace.cpq ||= emptyCpq();
    if (
      workspace.cpq.draft.costVersion &&
      workspace.cpq.draft.costVersion !== workspace.activeVersion
    )
      throwValidationError(
        `CPQ draft uses ${workspace.cpq.draft.costVersion}. Select the active Draft ${workspace.activeVersion} in CPQ before applying the global catalog.`,
      );
    workspace.cpq.catalog = structuredClone(master.items);
    delete workspace.cpq.draft.confirmation;
    delete workspace.cpq.draft.result;
  } else if (tab === 'assumptions') {
    // Old templates remain usable until the user explicitly adopts new ones.
    const referenced = new Set(
      workspace.quoteTemplates.flatMap(
        (template) => template.defaultAssumptionIds,
      ),
    );
    const incoming = new Set(master.items.map((item) => item.id));
    workspace.assumptionLibrary = [
      ...structuredClone(master.items),
      ...workspace.assumptionLibrary.filter(
        (item) => referenced.has(item.id) && !incoming.has(item.id),
      ),
    ];
  } else if (tab === 'quote-templates') {
    const required = new Set(
      master.items.flatMap((template) => template.defaultAssumptionIds),
    );
    const oldSelected = workspace.quoteTemplates.find(
      (template) => template.id === workspace.selectedQuoteTemplateId,
    );
    const templates = structuredClone(master.items);
    if (
      oldSelected &&
      !templates.some((template) => template.id === oldSelected.id)
    )
      templates.push(oldSelected);
    const library = new Map(
      workspace.assumptionLibrary.map((item) => [item.id, item]),
    );
    if (required.size) {
      const assumptions = readValidatedMasterCatalog(repository, 'assumptions');
      for (const item of assumptions.items)
        if (required.has(item.id)) library.set(item.id, structuredClone(item));
      workspace.masterDataRevisions = {
        ...workspace.masterDataRevisions,
        assumptions: assumptions.revision,
      };
    }
    workspace.quoteTemplates = templates;
    workspace.assumptionLibrary = [...library.values()];
  } else {
    workspace[capturedMasterFields[tab]] = structuredClone(master.items);
  }
  workspace.masterDataRevisions = {
    ...workspace.masterDataRevisions,
    [tab]: master.revision,
  };
  const saved = repository.save(id, workspace, revision);
  return {
    ...mutationReceipt(saved, ''),
    resource: 'project',
    section: tab,
    masterDataRevision: master.revision,
  };
}
