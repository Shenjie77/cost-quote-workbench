/** Narrow, revision-safe business resources. Full project JSON stays in-process. */
import {
  emptyCpq,
  mappingKey,
  calculationKey,
} from '../features/cpq/domain.ts';
import { emptySsr } from '../features/ssr/domain.ts';
import { emptyMaintenance } from '../features/maintenance/domain.ts';
import { costLockReason } from '../features/cost/cost-lock.ts';
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
const costSettings = [
  'state',
  'rateSettings',
  'travelSettings',
  'travelUplift',
  'manualCosts',
];
const ssrSettings = [
  'enabled',
  'proposalNumber',
  'companyUrl',
  'scopeBrief',
  'technicalBasis',
  'mode',
  'requiredDomains',
];
const cpqSettings = [
  'brief',
  'costVersion',
  'targetCost',
  'targetBasis',
  'tolerance',
  'rounding',
  'allocationBasis',
];
const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((k) => Object.hasOwn(value, k)).map((k) => [k, value[k]]),
  );
const fail = (message) => {
  throw new WorkspaceValidationError(message);
};
const allowed = (object, keys) => {
  for (const key of Object.keys(object))
    if (!keys.includes(key))
      fail(`Unsupported field: ${key}. Allowed: ${keys.join(', ')}`);
};
const requireRecord = (repository, id) => {
  const record = repository.get(id);
  if (!record)
    throw new RepositoryNotFoundError(
      'Project not found or deleted.',
      repository.isDeleted(id),
    );
  return record;
};
const safeMapping = (cpq) => {
  try {
    return { key: mappingKey(cpq), issue: null };
  } catch (e) {
    return { key: null, issue: e.message };
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
    Object.entries(value)
      .filter(([k]) => !hidden.includes(k))
      .map(([k, v]) => [k, compactValue(v)]),
  );
};
export const mutationReceipt = (record, command, subjectId) => {
  const w = record.workspace;
  const data = {
    projectId: record.projectId,
    revision: record.revision,
    updatedAt: record.updatedAt,
    costLockReason: costLockReason(w),
  };
  if (command === 'cpq.solve') data.result = compactValue(w.cpq.draft.result);
  if (command === 'cpq.confirm')
    data.confirmation = compactValue(w.cpq.draft.confirmation);
  if (command === 'cpq.archive') data.archiveId = w.cpq.archives.at(-1).id;
  if (command === 'maintenance.archive')
    data.archiveId = w.maintenanceBoq.archives.at(-1).id;
  if (command.startsWith('ssr.'))
    data.submissionId =
      command === 'ssr.submit' ? w.ssr.submissions.at(-1)?.id : subjectId;
  return data;
};

function locate(w, module, options) {
  const section = options.section;
  if (module === 'project')
    return {
      object: {
        ...w.project,
        projectStatus: w.projectStatus,
        currentWorkflowStepCode: w.currentWorkflowStepCode,
        activeVersion: w.activeVersion,
      },
      fields: ['name', 'client', 'projectStatus', 'currentWorkflowStepCode'],
    };
  if (module === 'masterdata') {
    const tab = Object.hasOwn(MASTER_TABS, options.tab)
      ? MASTER_TABS[options.tab]
      : null;
    if (!tab)
      fail(`--tab must be one of: ${Object.keys(MASTER_TABS).join(', ')}`);
    return { parent: w, field: tab[0], key: tab[1] };
  }
  if (module === 'cost') {
    if (section === 'versions')
      return {
        items: w.costVersions.map((v) =>
          pick(v, ['code', 'state', 'createdAt', 'sourceVersion']),
        ),
        key: 'code',
        readonly: true,
      };
    const version = options.version || w.activeVersion;
    const v = w.costVersions.find((v) => v.code === version);
    if (!v)
      throw new RepositoryNotFoundError(`Cost version not found: ${version}`);
    if (!section || section === 'rows')
      return { parent: v, field: 'costRows', key: 'id', version };
    if (section === 'settings')
      return { object: pick(v, costSettings), fields: costSettings, version };
    if (section === 'resources')
      return {
        parent: v,
        field: 'resourceTypes',
        key: 'id',
        version,
        readonly: true,
      };
    if (section === 'travel')
      return { parent: v, field: 'travelRows', key: 'id', version };
    if (section === 'summary') {
      const rows = recalculateCostRows(
        v.costRows,
        v.resourceTypes,
        v.rateSettings,
      );
      const travel = getHQTravelSummary(
        rows,
        v.resourceTypes,
        v.travelSettings,
      ).totalCost;
      return {
        object: getCostStatementValues(
          rows,
          v.resourceTypes,
          travel,
          v.manualCosts,
        ),
        version,
        readonly: true,
      };
    }
    fail('Cost sections: rows, settings, resources, travel, summary, versions');
  }
  if (module === 'cpq') {
    w.cpq ||= emptyCpq();
    if (section === 'catalog')
      return { parent: w.cpq, field: 'catalog', key: 'code' };
    if (section === 'selections')
      return { parent: w.cpq.draft, field: 'selections', key: 'code' };
    if (!section || section === 'draft')
      return { object: w.cpq.draft, fields: cpqSettings };
    if (section === 'archives')
      return {
        items: w.cpq.archives.map((a) => ({
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
    fail('CPQ sections: catalog, draft, selections, archives');
  }
  if (module === 'quote') {
    if (!section || section === 'settings')
      return {
        object: {
          pricing: w.pricing,
          selectedQuoteTemplateId: w.selectedQuoteTemplateId,
        },
        fields: ['pricing', 'selectedQuoteTemplateId'],
      };
    if (section === 'assumptions')
      return { parent: w, field: 'quoteAssumptions', key: 'id' };
    if (section === 'history')
      return { parent: w, field: 'quoteHistory', key: 'id', readonly: true };
    fail('Quote sections: settings, assumptions, history');
  }
  if (module === 'ssr') {
    w.ssr ||= emptySsr();
    if (!section || section === 'settings')
      return { object: pick(w.ssr, ssrSettings), fields: ssrSettings };
    if (section === 'bid-responses')
      return { parent: w.ssr, field: 'bidResponses', key: 'id' };
    if (section === 'submissions')
      return { parent: w.ssr, field: 'submissions', key: 'id', readonly: true };
    fail('SSR sections: settings, bid-responses, submissions');
  }
  if (module === 'boq') {
    w.maintenanceBoq ||= emptyMaintenance();
    if (section === 'settings')
      return {
        object: { coverageMonths: w.maintenanceBoq.coverageMonths },
        fields: ['coverageMonths'],
      };
    if (!section || section === 'rows')
      return { parent: w.maintenanceBoq, field: 'boq', key: 'id' };
    if (section === 'archives')
      return {
        items: w.maintenanceBoq.archives.map((a) =>
          pick(a, [
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
    fail('BOQ sections: rows, settings, archives');
  }
  fail(`Unknown resource: ${module}`);
}

export function readResource(repository, id, module, options = {}) {
  const record = requireRecord(repository, id);
  const target = locate(record.workspace, module, options);
  const data = {
    ...mutationReceipt(record, ''),
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
      ['id', 'query', 'offset', 'limit'].some((k) => options[k] !== undefined)
    )
      fail('Filters and pagination require a collection section.');
    data.value = compactValue(target.object);
    if (module === 'cpq') {
      const cpq = record.workspace.cpq;
      const mapping = safeMapping(cpq);
      const baseline = record.workspace.costVersions.find(
        (v) => v.code === cpq.draft.costVersion,
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
  let items = target.items || target.parent[target.field];
  if (options.id)
    items = items.filter((item) => item[target.key] === options.id);
  if (options.query) {
    const query = String(options.query).normalize('NFKC').toLowerCase();
    items = items.filter((item) =>
      Object.values(item).some(
        (v) =>
          typeof v === 'string' &&
          v.normalize('NFKC').toLowerCase().includes(query),
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
    fail('offset must be >= 0; limit must be 1–200.');
  return {
    ...data,
    total: items.length,
    offset,
    limit,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    items: compactValue(items.slice(offset, offset + limit)),
  };
}

function patchCollection(items, key, changes) {
  if (changes.set !== undefined)
    fail('Collection updates use upsert/remove, not set.');
  const updates = changes.upsert || [],
    remove = changes.remove || [];
  const seen = new Set();
  for (const item of updates) {
    if (typeof item[key] !== 'string' || !item[key].trim())
      fail(`Each upsert requires ${key}.`);
    if (seen.has(item[key]) || remove.includes(item[key]))
      fail('Duplicate or contradictory record IDs.');
    seen.add(item[key]);
  }
  if (new Set(remove).size !== remove.length) fail('Duplicate remove IDs.');
  for (const id of remove)
    if (!items.some((i) => i[key] === id))
      fail(`Cannot remove unknown ${key}: ${id}`);
  const remaining = items.filter((item) => !remove.includes(item[key]));
  for (const item of updates) {
    const index = remaining.findIndex((old) => old[key] === item[key]);
    if (index === -1) remaining.push(structuredClone(item));
    else remaining[index] = { ...remaining[index], ...structuredClone(item) };
  }
  return remaining;
}

export function updateResource(
  repository,
  id,
  module,
  options,
  changes,
  expectedRevision,
) {
  const record = requireRecord(repository, id);
  if (record.revision !== expectedRevision)
    throw new RepositoryConflictError(
      'Project changed. Read this resource again.',
      record.revision,
    );
  const w = record.workspace;
  const oldMapping =
    module === 'cpq' ? safeMapping(w.cpq || emptyCpq()).key : null;
  const locked = costLockReason(w);
  const finalizingOnly =
    module === 'cost' &&
    options.section === 'settings' &&
    Object.keys(changes).length === 1 &&
    Object.keys(changes.set || {}).length === 1 &&
    changes.set.state === 'Confirmed';
  if (
    locked &&
    ((module === 'cost' && !finalizingOnly) ||
      (module === 'masterdata' && options.tab === 'resources'))
  )
    fail(locked);
  const target = locate(w, module, options);
  if (target.readonly)
    fail('This section is read-only; use the explicit workflow command.');
  allowed(changes, ['set', 'upsert', 'remove']);
  if (
    module === 'cost' &&
    (!options.section || options.section === 'rows') &&
    (changes.upsert || []).some((item) => Object.hasOwn(item, 'source'))
  )
    fail(
      'Import source evidence is read-only. Use cost import to attach original TD/PM input.',
    );
  if (
    !Object.keys(changes).length ||
    !(
      Object.keys(changes.set || {}).length ||
      changes.upsert?.length ||
      changes.remove?.length
    )
  )
    fail('At least one change is required.');
  if (target.object) {
    if (
      changes.upsert !== undefined ||
      changes.remove !== undefined ||
      !changes.set
    )
      fail('Object updates require set.');
    allowed(changes.set, target.fields);
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
    }
    if (module === 'project') {
      Object.assign(w.project, pick(target.object, ['name', 'client']));
      Object.assign(
        w,
        pick(target.object, ['projectStatus', 'currentWorkflowStepCode']),
      );
    } else if (module === 'cost')
      Object.assign(
        w.costVersions.find((v) => v.code === target.version),
        target.object,
      );
    else if (module === 'quote') Object.assign(w, target.object);
    else if (module === 'cpq') w.cpq.draft = target.object;
    else if (module === 'ssr') Object.assign(w.ssr, target.object);
    else if (module === 'boq') Object.assign(w.maintenanceBoq, target.object);
  } else
    target.parent[target.field] = patchCollection(
      target.parent[target.field],
      target.key,
      changes,
    );
  if (
    module === 'project' ||
    (module === 'masterdata' && options.tab === 'workflow')
  ) {
    const index = w.processSteps.findIndex(
      (s) => s.code === w.currentWorkflowStepCode,
    );
    if (index < 0)
      fail(
        'Current workflow node cannot be removed. Select another node first.',
      );
    w.selectedStep = index;
  }
  if (module === 'cost') syncVersion(w, target.version);
  if (module === 'cpq') {
    const mapping = safeMapping(w.cpq).key;
    if (mapping === null || mapping !== oldMapping)
      delete w.cpq.draft.confirmation;
    delete w.cpq.draft.result;
  }
  const saved = repository.save(id, w, expectedRevision);
  return {
    ...mutationReceipt(saved, ''),
    resource: module,
    section: options.tab || options.section || 'default',
    ...(target.version ? { version: target.version } : {}),
    changedIds: (changes.upsert || []).map((i) => i[target.key]),
    removedIds: changes.remove || [],
    changedFields: Object.keys(changes.set || {}),
  };
}

function syncVersion(w, code) {
  const v = w.costVersions.find((v) => v.code === code);
  v.costRows = recalculateCostRows(v.costRows, v.resourceTypes, v.rateSettings);
  if (code === w.activeVersion)
    Object.assign(
      w,
      pick(v, [
        'costRows',
        'rateSettings',
        'travelSettings',
        'travelRows',
        'travelUplift',
        'manualCosts',
      ]),
    );
}

export function applyMasterRates(repository, id, version, revision) {
  const record = requireRecord(repository, id);
  const locked = costLockReason(record.workspace);
  if (locked) fail(locked);
  const v = record.workspace.costVersions.find((v) => v.code === version);
  if (!v) throw new RepositoryNotFoundError('Cost version not found.');
  v.resourceTypes = structuredClone(record.workspace.resourceTypes);
  syncVersion(record.workspace, version);
  return {
    ...mutationReceipt(repository.save(id, record.workspace, revision), ''),
    version,
  };
}
