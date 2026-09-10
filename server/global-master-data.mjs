/** Independent source catalogs. No update path reads or mutates a project. */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { GLOBAL_MASTER_DATA_TABS } from '../features/master-data/global-types.ts';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';
import { initialProcessSteps } from '../features/projects/demo-data.ts';
import { createProjectWorkflowSteps } from '../features/projects/workflow-domain.ts';
import { normalizeWorkflowDefinition } from '../features/projects/workflow-engine.ts';
import { initialProjectStatusDefinitions } from '../features/projects/types.ts';
import {
  createAssumptionLibrary,
  initialQuoteAssumptions,
  initialQuoteTemplates,
} from '../features/quote/types.ts';
import { assertCatalog, contentKey } from '../features/cpq/domain.ts';
import { assertMaintenanceImport } from '../features/master-data/maintenance-import.ts';
import {
  normalizeBu,
  validateProfitShareRates,
} from '../features/quote/profit-share.ts';

export { GLOBAL_MASTER_DATA_TABS };
export const GLOBAL_MASTER_TABS = {
  resources: ['resourceTypes', 'id', 'resourceType'],
  subcontract: ['subcontractItems', 'id', 'subcontractItem'],
  supplemental: ['supplementalCostItems', 'id', 'supplementalCostItem'],
  maintenance: ['maintenancePriceRecords', 'id', 'maintenancePriceRecord'],
  assumptions: ['assumptionLibrary', 'id', 'assumptionDefinition'],
  'quote-templates': ['quoteTemplates', 'id', 'quoteTemplate'],
  'profit-share': ['profitShareRates', 'id', 'profitShareRate'],
  workflow: ['processSteps', 'code', 'workflowStep'],
  status: ['projectStatusDefinitions', 'code', 'projectStatusDefinition'],
  'cpq-catalog': ['catalog', 'code', 'cpqCatalogItem'],
};
const INITIALIZATION_KEY = 'shared-catalogs-v1';
const PROJECT_WORKFLOW_TEMPLATE_KEY = 'project-workflow-template-v1';
const WORKFLOW_ENGINE_KEY = 'workflow-engine-definition-v1';
const codedTabs = new Set(['resources', 'subcontract', 'supplemental']);
const clone = (value) => structuredClone(value);
const workspaceSchema = JSON.parse(
  readFileSync(
    new URL('../schemas/workspace-state.schema.json', import.meta.url),
    'utf8',
  ),
);
const costSchema = JSON.parse(
  readFileSync(
    new URL('../schemas/cost-export.schema.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(costSchema);
ajv.addSchema(workspaceSchema);
const validators = Object.fromEntries(
  GLOBAL_MASTER_DATA_TABS.map((tab) => [
    tab,
    ajv.compile({
      type: 'array',
      maxItems: 10000,
      items: {
        $ref: `${tab === 'resources' ? costSchema.$id : workspaceSchema.$id}#/$defs/${GLOBAL_MASTER_TABS[tab][2]}`,
      },
    }),
  ]),
);

export class GlobalMasterDataValidationError extends TypeError {
  constructor(message, location = '/masterdata') {
    super(message);
    this.name = 'GlobalMasterDataValidationError';
    this.violations = [{ path: location, rule: 'globalMasterData', message }];
  }
}
export class GlobalMasterDataConflictError extends Error {
  constructor(message, currentRevision) {
    super(message);
    this.name = 'GlobalMasterDataConflictError';
    this.currentRevision = currentRevision;
  }
}
const fail = (message) => {
  throw new GlobalMasterDataValidationError(message);
};
const tabSpec = (tab) => {
  if (!Object.hasOwn(GLOBAL_MASTER_TABS, tab))
    fail(
      `Unknown master-data tab: ${tab}. Allowed: ${GLOBAL_MASTER_DATA_TABS.join(', ')}`,
    );
  return GLOBAL_MASTER_TABS[tab];
};
const objectOnly = (value, description) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${description} must be an object.`);
};
const keyOf = (tab, item) => item[tabSpec(tab)[1]];
const sameIdentity = (tab, a, b) =>
  keyOf(tab, a) === keyOf(tab, b) ||
  (codedTabs.has(tab) && a.code === b.code) ||
  (tab === 'profit-share' &&
    a.bu &&
    b.bu &&
    normalizeBu(a.bu) === normalizeBu(b.bu));
const workflowDefinition = (item) => {
  const definition = {
    ...item,
    state: 'not_started',
    tone: 'gray',
    date: '',
    dateZh: '',
    input: '',
    inputZh: '',
  };
  for (const key of [
    'startedAt',
    'dueAt',
    'completedAt',
    'pausedAt',
    'fieldValues',
    'skippedBy',
    'followUpDate',
    'note',
    'updatedAt',
  ])
    delete definition[key];
  return definition;
};
const defaultCatalogs = () => ({
  resources: initialResourceTypes,
  subcontract: [],
  supplemental: [],
  maintenance: [],
  assumptions: createAssumptionLibrary(initialQuoteAssumptions),
  'quote-templates': initialQuoteTemplates,
  'profit-share': [],
  workflow: createProjectWorkflowSteps(),
  status: initialProjectStatusDefinitions,
  'cpq-catalog': [],
});

function validateItems(tab, items) {
  const validate = validators[tab];
  if (!validate(items))
    fail(`${tab}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  const keys = new Set();
  const codes = new Set();
  for (const item of items) {
    const key = keyOf(tab, item);
    if (keys.has(key)) fail(`${tab}: duplicate ${tabSpec(tab)[1]} ${key}.`);
    keys.add(key);
    if (codedTabs.has(tab)) {
      if (codes.has(item.code))
        fail(
          `${tab}: duplicate code ${item.code}. Resolve the conflicting catalog entry explicitly.`,
        );
      codes.add(item.code);
    }
    if (tab === 'resources') {
      if (item.effectiveTo && item.effectiveFrom > item.effectiveTo)
        fail(`${key}: effectiveFrom must be on or before effectiveTo.`);
      if (item.hqTravel && item.pool !== 'HQ')
        fail(`${key}: HQ travel applies only to HQ resources.`);
    }
    if (
      tab === 'workflow' &&
      contentKey(item) !== contentKey(workflowDefinition(item))
    )
      fail(
        'Global workflow stores definitions only. Actual state, dates and submitted inputs belong to a project.',
      );
  }
  try {
    if (tab === 'profit-share') {
      const errors = validateProfitShareRates(items);
      if (errors.length) fail(errors.join(' '));
    }
    if (tab === 'cpq-catalog') assertCatalog(items);
    if (tab === 'maintenance')
      assertMaintenanceImport({ schemaVersion: '1.0.0', records: items });
  } catch (error) {
    if (error instanceof GlobalMasterDataValidationError) throw error;
    if (error instanceof TypeError) fail(error.message);
    throw error;
  }
}

/** Merge same IDs/codes without choosing a price based on project recency. */
function collectTab(tab, rows, initializedFrom, timestamp) {
  const groups = [];
  for (const { item: raw, source } of rows) {
    const item = tab === 'workflow' ? workflowDefinition(raw) : clone(raw);
    const matches = groups.filter((group) =>
      group.some((variant) => sameIdentity(tab, variant.item, item)),
    );
    const group = matches.shift() || [];
    for (const matching of matches) {
      group.push(...matching);
      groups.splice(groups.indexOf(matching), 1);
    }
    if (!groups.includes(group)) groups.push(group);
    const equal = group.find(
      (variant) => contentKey(variant.item) === contentKey(item),
    );
    if (equal) {
      if (!equal.sources.some((old) => contentKey(old) === contentKey(source)))
        equal.sources.push(source);
    } else group.push({ item, sources: [source] });
  }
  const payload = {
    items: [],
    conflicts: [],
    sources: [],
    initializedFrom,
    initializedAt: timestamp,
  };
  for (const variants of groups) {
    const key = keyOf(tab, variants[0].item);
    let invalid = '';
    try {
      validateItems(
        tab,
        variants.map((v) => v.item),
      );
    } catch (error) {
      invalid = error.message;
    }
    if (variants.length > 1 || invalid) {
      payload.conflicts.push({
        key,
        variants,
        reason:
          variants.length > 1
            ? 'Historical projects contain different values for the same catalog ID or code.'
            : invalid,
      });
    } else {
      payload.items.push(variants[0].item);
      payload.sources.push({ key, sources: variants[0].sources });
    }
  }
  return payload;
}

export function validateGlobalMasterDataRows(tab, items) {
  validateItems(tab, items);
}

function unavailableTemplateReferences(payloads) {
  const available = new Set(payloads.assumptions.items.map((item) => item.id));
  const templates = payloads['quote-templates'];
  templates.items = templates.items.filter((item) => {
    const unavailable = item.defaultAssumptionIds.filter(
      (id) => !available.has(id),
    );
    if (!unavailable.length) return true;
    templates.conflicts.push({
      key: item.id,
      reason: `Resolve unavailable/conflicting assumption references first: ${unavailable.join(', ')}`,
      variants: [
        {
          item,
          sources:
            templates.sources.find((entry) => entry.key === item.id)?.sources ||
            [],
        },
      ],
    });
    templates.sources = templates.sources.filter(
      (entry) => entry.key !== item.id,
    );
    return false;
  });
}

/** One-time copy. Source workspace bytes, revisions and cost snapshots are untouched. */
export function initializeGlobalMasterData(db) {
  const marker = db.prepare(
    'SELECT value FROM master_data_metadata WHERE key = ?',
  );
  if (marker.get(INITIALIZATION_KEY)) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (marker.get(INITIALIZATION_KEY)) {
      db.exec('COMMIT');
      return false;
    }
    const timestamp = new Date().toISOString();
    const projects = db
      .prepare(
        `SELECT project_id, revision, payload_json FROM workspace_snapshots ORDER BY project_id`,
      )
      .all();
    const rows = Object.fromEntries(
      GLOBAL_MASTER_DATA_TABS.map((tab) => [tab, []]),
    );
    for (const row of projects) {
      const workspace = JSON.parse(row.payload_json);
      const source = {
        kind: 'project',
        projectId: row.project_id,
        projectName: workspace.project?.name || row.project_id,
        revision: row.revision,
      };
      for (const tab of GLOBAL_MASTER_DATA_TABS) {
        // This new commercial catalog starts empty; historical projects are not
        // a source of company profit-share policy.
        if (tab === 'profit-share') continue;
        const items =
          tab === 'cpq-catalog'
            ? workspace.cpq?.catalog
            : workspace[GLOBAL_MASTER_TABS[tab][0]];
        for (const item of items || []) rows[tab].push({ item, source });
      }
    }
    if (!projects.length) {
      for (const [tab, items] of Object.entries(defaultCatalogs()))
        for (const item of items)
          rows[tab].push({ item, source: { kind: 'defaults' } });
    }
    const from = projects.length ? 'projects' : 'defaults';
    const payloads = Object.fromEntries(
      GLOBAL_MASTER_DATA_TABS.map((tab) => [
        tab,
        collectTab(
          tab,
          rows[tab],
          tab === 'profit-share' ? 'defaults' : from,
          timestamp,
        ),
      ]),
    );
    unavailableTemplateReferences(payloads);
    const insert = db.prepare(
      'INSERT INTO master_data_tabs (tab,revision,payload_json,updated_at) VALUES (?,1,?,?)',
    );
    const archive = db.prepare(
      'INSERT INTO master_data_revisions (tab,revision,payload_json,updated_at) VALUES (?,1,?,?)',
    );
    for (const tab of GLOBAL_MASTER_DATA_TABS) {
      const json = JSON.stringify(payloads[tab]);
      insert.run(tab, json, timestamp);
      archive.run(tab, json, timestamp);
    }
    db.prepare('INSERT INTO master_data_metadata (key,value) VALUES (?,?)').run(
      INITIALIZATION_KEY,
      timestamp,
    );
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Upgrade only the untouched legacy default; user templates and conflicts retain their exact values. */
export function upgradeDefaultProjectWorkflowCatalog(db) {
  const marker = db.prepare(
    'SELECT value FROM master_data_metadata WHERE key = ?',
  );
  if (marker.get(PROJECT_WORKFLOW_TEMPLATE_KEY)) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (marker.get(PROJECT_WORKFLOW_TEMPLATE_KEY)) {
      db.exec('COMMIT');
      return false;
    }
    const row = db
      .prepare(
        'SELECT revision, payload_json FROM master_data_tabs WHERE tab = ?',
      )
      .get('workflow');
    const timestamp = new Date().toISOString();
    let changed = false;
    if (row) {
      const payload = JSON.parse(row.payload_json);
      const oldDefaults = initialProcessSteps.map(workflowDefinition);
      const untouched =
        !payload.conflicts.length &&
        payload.items.length === oldDefaults.length &&
        payload.items.every(
          (item, index) => contentKey(item) === contentKey(oldDefaults[index]),
        );
      if (untouched) {
        const revision = row.revision + 1;
        payload.items = createProjectWorkflowSteps();
        payload.sources = payload.items.map((item) => ({
          key: item.code,
          sources: [{ kind: 'defaults' }],
        }));
        const json = JSON.stringify(payload);
        db.prepare(
          'INSERT INTO master_data_revisions (tab,revision,payload_json,updated_at) VALUES (?,?,?,?)',
        ).run('workflow', revision, json, timestamp);
        db.prepare(
          'UPDATE master_data_tabs SET revision=?,payload_json=?,updated_at=? WHERE tab=?',
        ).run(revision, json, timestamp, 'workflow');
        changed = true;
      }
    }
    db.prepare('INSERT INTO master_data_metadata (key,value) VALUES (?,?)').run(
      PROJECT_WORKFLOW_TEMPLATE_KEY,
      timestamp,
    );
    db.exec('COMMIT');
    return changed;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Add configurable rules once, retaining catalog revisions and unresolved source alternatives. */
export function upgradeWorkflowEngineCatalog(db) {
  if (
    db
      .prepare('SELECT 1 FROM master_data_metadata WHERE key=?')
      .get(WORKFLOW_ENGINE_KEY)
  )
    return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare('SELECT revision,payload_json FROM master_data_tabs WHERE tab=?')
      .get('workflow');
    const timestamp = new Date().toISOString();
    if (row) {
      const payload = JSON.parse(row.payload_json);
      payload.items = payload.items.map((item) =>
        workflowDefinition(normalizeWorkflowDefinition(item)),
      );
      payload.conflicts = payload.conflicts.map((conflict) => ({
        ...conflict,
        variants: conflict.variants.map((variant) => ({
          ...variant,
          item: workflowDefinition(normalizeWorkflowDefinition(variant.item)),
        })),
      }));
      const json = JSON.stringify(payload);
      if (contentKey(payload) !== contentKey(JSON.parse(row.payload_json))) {
        const revision = row.revision + 1;
        db.prepare(
          'INSERT INTO master_data_revisions (tab,revision,payload_json,updated_at) VALUES (?,?,?,?)',
        ).run('workflow', revision, json, timestamp);
        db.prepare(
          'UPDATE master_data_tabs SET revision=?,payload_json=?,updated_at=? WHERE tab=?',
        ).run(revision, json, timestamp, 'workflow');
      }
    }
    db.prepare('INSERT INTO master_data_metadata (key,value) VALUES (?,?)').run(
      WORKFLOW_ENGINE_KEY,
      timestamp,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function assertReferences(tab, payload, select) {
  if (!['assumptions', 'quote-templates'].includes(tab)) return;
  const assumptions =
    tab === 'assumptions'
      ? payload
      : JSON.parse(select.get('assumptions').payload_json);
  const templates =
    tab === 'quote-templates'
      ? payload
      : JSON.parse(select.get('quote-templates').payload_json);
  const ids = new Set(assumptions.items.map((item) => item.id));
  for (const item of templates.items) {
    const missing = item.defaultAssumptionIds.filter((id) => !ids.has(id));
    if (missing.length)
      fail(
        `Quote template ${item.id} references unavailable assumptions: ${missing.join(', ')}. Update template references first.`,
      );
  }
}
const integer = (value, fallback, min, max, name) => {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    fail(`${name} must be an integer between ${min} and ${max}.`);
  return result;
};
const projectRecord = (row, options = {}) => {
  const payload = JSON.parse(row.payload_json);
  const keyField = tabSpec(row.tab)[1];
  const offset = integer(options.offset, 0, 0, 1000000, 'offset');
  const limit = integer(options.limit, 100, 1, 10000, 'limit');
  const id = options.id;
  const query = (options.query || '').toLocaleLowerCase();
  const matches = (item) =>
    (!id || item[keyField] === id) &&
    (!query || JSON.stringify(item).toLocaleLowerCase().includes(query));
  const items = payload.items.filter(matches);
  const conflicts = payload.conflicts.filter(
    (conflict) =>
      (!id ||
        conflict.key === id ||
        conflict.variants.some((v) => v.item[keyField] === id)) &&
      (!query || JSON.stringify(conflict).toLocaleLowerCase().includes(query)),
  );
  const page = items.slice(offset, offset + limit);
  const keys = new Set(page.map((item) => item[keyField]));
  return {
    scope: 'global',
    tab: row.tab,
    keyField,
    revision: row.revision,
    updatedAt: row.updated_at,
    initializedFrom: payload.initializedFrom,
    initializedAt: payload.initializedAt,
    items: page,
    conflicts,
    sources: payload.sources.filter((source) => keys.has(source.key)),
    total: items.length,
    conflictTotal: conflicts.length,
    offset,
    limit,
    nextOffset:
      offset + page.length < items.length ? offset + page.length : null,
  };
};

export function makeGlobalMasterDataStore(db) {
  const select = db.prepare(
    'SELECT tab,revision,payload_json,updated_at FROM master_data_tabs WHERE tab = ?',
  );
  const ensureAdditiveTab = (tab) => {
    if (tab !== 'profit-share' || select.get(tab)) return;
    // A savepoint works both standalone and inside an existing repository
    // transaction. Never reseed existing tabs or inspect project snapshots.
    db.exec('SAVEPOINT initialize_profit_share');
    try {
      if (!select.get(tab)) {
        const timestamp = new Date().toISOString();
        const payload = collectTab(tab, [], 'defaults', timestamp);
        const json = JSON.stringify(payload);
        db.prepare(
          'INSERT INTO master_data_tabs (tab,revision,payload_json,updated_at) VALUES (?,1,?,?)',
        ).run(tab, json, timestamp);
        db.prepare(
          'INSERT INTO master_data_revisions (tab,revision,payload_json,updated_at) VALUES (?,1,?,?)',
        ).run(tab, json, timestamp);
      }
      db.exec('RELEASE SAVEPOINT initialize_profit_share');
    } catch (error) {
      db.exec('ROLLBACK TO SAVEPOINT initialize_profit_share');
      db.exec('RELEASE SAVEPOINT initialize_profit_share');
      throw error;
    }
  };
  const get = (tab, options) => {
    tabSpec(tab);
    ensureAdditiveTab(tab);
    const row = select.get(tab);
    if (!row) fail('Global master data has not been initialized.');
    return projectRecord(row, options);
  };
  return {
    get,
    all: () => GLOBAL_MASTER_DATA_TABS.map((tab) => get(tab, { limit: 10000 })),
    update(tab, changes, expectedRevision, internal = {}) {
      tabSpec(tab);
      ensureAdditiveTab(tab);
      objectOnly(changes, 'changes');
      for (const key of Object.keys(changes))
        if (!['upsert', 'remove'].includes(key))
          fail(`Unsupported change: ${key}.`);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
        fail('expectedRevision must be a positive integer.');
      const requestedUpsert =
        changes.upsert === undefined ? [] : clone(changes.upsert);
      const remove = changes.remove === undefined ? [] : changes.remove;
      if (!Array.isArray(requestedUpsert) || !Array.isArray(remove))
        fail('upsert and remove must be arrays.');
      if (
        remove.some((key) => typeof key !== 'string' || !key.trim()) ||
        new Set(remove).size !== remove.length
      )
        fail('remove must contain unique non-empty keys.');
      if (!requestedUpsert.length && !remove.length)
        fail('Provide at least one upsert or remove.');
      for (const item of requestedUpsert) {
        objectOnly(item, 'upsert item');
        if (typeof keyOf(tab, item) !== 'string' || !keyOf(tab, item).trim())
          fail(`Each upsert requires a non-empty ${tabSpec(tab)[1]}.`);
      }
      const written = new Set(requestedUpsert.map((item) => keyOf(tab, item)));
      if (written.size !== requestedUpsert.length)
        fail('upsert must contain unique keys.');
      if (remove.some((key) => written.has(key)))
        fail('Do not upsert and remove the same key in one update.');
      const ownsTransaction = !internal.inTransaction;
      if (ownsTransaction) db.exec('BEGIN IMMEDIATE');
      try {
        const current = select.get(tab);
        if (!current) fail('Global master data has not been initialized.');
        if (current.revision !== expectedRevision)
          throw new GlobalMasterDataConflictError(
            'Global master data changed. Read this tab again before updating.',
            current.revision,
          );
        const payload = JSON.parse(current.payload_json);
        const knownKeys = new Set([
          ...payload.items.map((item) => keyOf(tab, item)),
          ...payload.conflicts.flatMap((conflict) => [
            conflict.key,
            ...conflict.variants.map((variant) => keyOf(tab, variant.item)),
          ]),
        ]);
        for (const key of remove)
          if (!knownKeys.has(key)) fail(`Unknown ${tab} key: ${key}.`);
        const upsert = requestedUpsert.map((item) => {
          const existing = payload.items.find(
            (old) => keyOf(tab, old) === keyOf(tab, item),
          );
          const conflicting = payload.conflicts.some((conflict) =>
            conflict.variants.some((variant) =>
              sameIdentity(tab, variant.item, item),
            ),
          );
          return existing && !conflicting ? { ...existing, ...item } : item;
        });
        // Partial edits only inherit an unambiguous existing key. Choosing a
        // conflict variant or introducing a new key always requires a full row.
        validateItems(tab, upsert);
        const revision = current.revision + 1;
        const timestamp = new Date().toISOString();
        const source = {
          kind: 'global-update',
          revision,
          updatedAt: timestamp,
        };
        const removeSet = new Set(remove);
        const resolved = new Set();
        for (const conflict of payload.conflicts) {
          if (
            removeSet.has(conflict.key) ||
            conflict.variants.some((v) => removeSet.has(keyOf(tab, v.item))) ||
            conflict.variants.some((v) =>
              upsert.some((item) => sameIdentity(tab, item, v.item)),
            )
          )
            resolved.add(conflict.key);
        }
        payload.conflicts = payload.conflicts.filter(
          (conflict) => !resolved.has(conflict.key),
        );
        const changedKeys = new Set(remove);
        const replacements = new Map(
          upsert.map((item) => [keyOf(tab, item), item]),
        );
        payload.items = payload.items.flatMap((old) => {
          const key = keyOf(tab, old);
          if (removeSet.has(key)) return [];
          const replacement = replacements.get(key);
          if (!replacement) return [old];
          changedKeys.add(key);
          replacements.delete(key);
          return [replacement];
        });
        payload.items.push(...replacements.values());
        if (tab === 'workflow')
          payload.items.sort((a, b) =>
            a.no.localeCompare(b.no, 'en', { numeric: true }),
          );
        payload.sources = payload.sources.filter(
          (entry) => !changedKeys.has(entry.key),
        );
        payload.sources.push(
          ...upsert.map((item) => ({
            key: keyOf(tab, item),
            sources: [source],
          })),
        );
        validateItems(tab, payload.items);
        assertReferences(tab, payload, select);
        const json = JSON.stringify(payload);
        db.prepare(
          'UPDATE master_data_tabs SET revision=?,payload_json=?,updated_at=? WHERE tab=?',
        ).run(revision, json, timestamp, tab);
        db.prepare(
          'INSERT INTO master_data_revisions (tab,revision,payload_json,updated_at) VALUES (?,?,?,?)',
        ).run(tab, revision, json, timestamp);
        const result = projectRecord(select.get(tab), { limit: 10000 });
        if (ownsTransaction) db.exec('COMMIT');
        return result;
      } catch (error) {
        if (ownsTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
