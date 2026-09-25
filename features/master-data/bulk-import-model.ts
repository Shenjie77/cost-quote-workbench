import {
  projectTagKey,
  normalizeProjectTags,
} from '../projects/project-tags.ts';
/** Spreadsheet import contracts and an atomic, side-effect-free catalog merge preview. */
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import costSchema from '../../schemas/cost-export.schema.json' with { type: 'json' };
import workspaceSchema from '../../schemas/workspace-state.schema.json' with { type: 'json' };
import { assertCatalog, contentKey, type CatalogItem } from '../cpq/domain.ts';
import { isValidIsoDate } from '../cost/validation.ts';
import {
  validateProfitShareRates,
  normalizeBu,
} from '../quote/profit-share.ts';
import { validateQuoteExcelMapping } from '../quote/excel-template-mapping.ts';
import type { QuoteExcelTemplate } from '../quote/excel-template-types.ts';
import { assertMaintenanceImport } from './maintenance-import.ts';
import type { GlobalMasterDataTab } from './global-types.ts';

export type BulkColumn = {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'list';
  required?: boolean;
  options?: string[];
  description: string;
  example?: string | number | boolean;
  min?: number;
  max?: number;
};
export type BulkTabSpec = {
  tab: GlobalMasterDataTab;
  label: string;
  columns: BulkColumn[];
};
export type BulkImportIssue = { row: number; column?: string; message: string };
export type BulkImportPreview = {
  items: Record<string, unknown>[];
  issues: BulkImportIssue[];
  added: number;
  updated: number;
  unchanged: number;
  changes: {
    row: number;
    key: string;
    label: string;
    action: 'add' | 'update' | 'unchanged';
  }[];
  contextKey: string;
};
type Item = Record<string, unknown>;
type Related = Partial<Record<GlobalMasterDataTab, Item[]>>;

/** Creates self-describing columns; required means required when creating a new record. */
function column(
  key: string,
  label: string,
  kind: BulkColumn['kind'],
  description: string,
  extra: Partial<BulkColumn> = {},
): BulkColumn {
  return { key, label, kind, description, ...extra };
}
/** Text identifiers stay strings so leading zeroes survive an Excel round trip. */
function textColumn(
  key: string,
  label: string,
  description: string,
  required = false,
  example?: string,
): BulkColumn {
  return column(key, label, 'text', description, { required, example });
}
/** Decimal limits mirror the persisted schemas; domain validators enforce cross-field constraints. */
function numberColumn(
  key: string,
  label: string,
  description: string,
  required = true,
  min = 0,
  max = 1e12,
  example?: number,
): BulkColumn {
  return column(key, label, 'number', description, {
    required,
    min,
    max,
    example,
  });
}
/** Boolean blanks preserve existing values and use the documented default for new rows. */
function flag(key: string, label: string, defaultValue = true): BulkColumn {
  return column(
    key,
    label,
    'boolean',
    `TRUE or FALSE. New-row default: ${defaultValue ? 'TRUE' : 'FALSE'}.`,
    { example: defaultValue },
  );
}
const id = textColumn(
  'id',
  'Record ID',
  'Keep an existing ID to update it. Leave blank for a new record; a UUID is assigned.',
);
const code = textColumn(
  'code',
  'Code',
  'Unique catalog code. Existing exact codes update the same record and retain its ID.',
  true,
  'EXAMPLE-001',
);
const active = flag('active', 'Active');
const currency = textColumn(
  'currency',
  'Currency',
  'New-row default: SGD.',
  false,
  'SGD',
);
const lists =
  'Separate values with newlines or semicolons, or use a JSON string array. Blank preserves the old list; [] clears it.';
const specs: Record<GlobalMasterDataTab, BulkTabSpec> = {
  resources: {
    tab: 'resources',
    label: 'RE Types & Rates',
    columns: [
      id,
      code,
      textColumn(
        'name',
        'Name',
        'Resource display name.',
        true,
        'Local engineer',
      ),
      column('category', 'Category', 'text', 'New-row default: internal.', {
        options: ['internal', 'subcontract'],
      }),
      column(
        'pool',
        'Pool',
        'text',
        'Required for internal resources. New internal rows default to LOCAL; new subcontract rows use no pool.',
        { options: ['LOCAL', 'ARP', 'HQ', 'OTHER'] },
      ),
      column(
        'level',
        'Level',
        'text',
        'Required for internal resources. New internal rows default to L1; new subcontract rows use no level.',
        { options: ['L0', 'L1', 'L2', 'L3', 'L4'] },
      ),
      numberColumn(
        'mandayRate',
        'Manday rate',
        'Non-negative daily rate.',
        true,
        0,
        1e12,
        500,
      ),
      numberColumn(
        'mandaysPerMonth',
        'Mandays per month',
        'Must be greater than zero. New-row default: 21.75.',
        false,
        0,
        1000,
        21.75,
      ),
      numberColumn(
        'hoursPerManday',
        'Hours per manday',
        'Must be greater than zero. New-row default: 8.',
        false,
        0,
        24,
        8,
      ),
      flag('hqTravel', 'HQ travel', false),
      column(
        'effectiveFrom',
        'Effective from',
        'date',
        'Calendar date in YYYY-MM-DD format.',
        { required: true, example: '2026-01-01' },
      ),
      column(
        'effectiveTo',
        'Effective to',
        'date',
        'Optional YYYY-MM-DD date, on or after effectiveFrom. Blank preserves an existing end date.',
      ),
      active,
    ],
  },
  subcontract: {
    tab: 'subcontract',
    label: 'Subcontract Items',
    columns: [
      id,
      code,
      textColumn(
        'item',
        'Item',
        'Subcontract service description.',
        true,
        'Installation',
      ),
      textColumn(
        'bu',
        'Business unit',
        'Business unit name.',
        true,
        'Delivery',
      ),
      textColumn(
        'unit',
        'Unit',
        'Optional reference unit. Blank new values remain unset.',
        false,
        'site',
      ),
      numberColumn(
        'unitPrice',
        'Unit price',
        'Optional reference price. Zero means free; blank new values remain unset.',
        false,
        0,
        1e12,
        100,
      ),
      currency,
      active,
    ],
  },
  supplemental: {
    tab: 'supplemental',
    label: 'Supplemental Costs',
    columns: [
      id,
      code,
      textColumn(
        'name',
        'Name',
        'Reference cost description.',
        true,
        'Inland transport',
      ),
      textColumn(
        'statementCode',
        'Statement code',
        'Cost statement account code.',
        true,
        '2.2.1.2',
      ),
      numberColumn(
        'defaultAmount',
        'Default amount',
        'Non-negative reference amount.',
        true,
        0,
        1e12,
        100,
      ),
      currency,
      textColumn('owner', 'Owner', 'Optional accountable owner.'),
      textColumn(
        'sourceNote',
        'Source note',
        'Optional source or reference notes.',
      ),
      active,
    ],
  },
  maintenance: {
    tab: 'maintenance',
    label: 'Maintenance History',
    columns: [
      id,
      textColumn(
        'client',
        'Client',
        'Customer name.',
        true,
        'Example Customer',
      ),
      textColumn(
        'service',
        'Service',
        'Maintenance service description.',
        true,
        'Hardware maintenance',
      ),
      textColumn(
        'productModel',
        'Product model',
        'Equipment model.',
        true,
        'Model A',
      ),
      textColumn(
        'serviceLevel',
        'Service level',
        'Service-level agreement.',
        true,
        '8x5 NBD',
      ),
      textColumn('site', 'Site', 'Covered location.', true, 'Singapore'),
      column(
        'coverageMonths',
        'Coverage months',
        'integer',
        'Whole contract duration in months.',
        { required: true, min: 0, max: 1200, example: 12 },
      ),
      numberColumn(
        'quantity',
        'Quantity',
        'Covered equipment quantity.',
        true,
        0,
        1e9,
        1,
      ),
      numberColumn(
        'costAmount',
        'Cost amount',
        'Total historical cost.',
        true,
        0,
        1e12,
        100,
      ),
      numberColumn(
        'quotedAmount',
        'Quoted amount',
        'Total historical quoted price.',
        true,
        0,
        1e12,
        150,
      ),
      currency,
      column(
        'quoteDate',
        'Quote date',
        'date',
        'Calendar date in YYYY-MM-DD format.',
        { required: true, example: '2026-01-01' },
      ),
      column('outcome', 'Outcome', 'text', 'New-row default: Reference.', {
        options: ['Quoted', 'Won', 'Lost', 'Reference'],
      }),
      textColumn(
        'source',
        'Source',
        'Original quote number or reference.',
        true,
        'QT-001',
      ),
    ],
  },
  assumptions: {
    tab: 'assumptions',
    label: 'Assumptions',
    columns: [
      id,
      textColumn(
        'name',
        'Name',
        'Reusable assumption title.',
        true,
        'Scope changes',
      ),
      textColumn('category', 'Category', 'New-row default: General.'),
      textColumn(
        'clientPattern',
        'Client pattern',
        'Customer matching pattern. New-row default: *.',
      ),
      textColumn(
        'text',
        'Assumption text',
        'Customer-facing assumption wording.',
        true,
        'Scope changes require approval.',
      ),
      textColumn(
        'textZh',
        'Translation',
        'Optional alternate wording; existing translations are retained when blank.',
      ),
      active,
    ],
  },
  'quote-templates': {
    tab: 'quote-templates',
    label: 'Quote Templates',
    columns: [
      id,
      textColumn('name', 'Name', 'Template name.', true, 'Customer quotation'),
      textColumn(
        'clientPattern',
        'Client pattern',
        'Customer matching pattern. New-row default: *.',
      ),
      textColumn(
        'documentTitle',
        'Document title',
        'Title printed in the quotation.',
        true,
        'SERVICE QUOTATION',
      ),
      column(
        'validityDays',
        'Validity days',
        'integer',
        'Quotation validity. New-row default: 30.',
        { min: 1, max: 3650, example: 30 },
      ),
      textColumn(
        'paymentTerms',
        'Payment terms',
        'Payment terms printed in the quotation.',
        true,
        '30 days from invoice date',
      ),
      textColumn(
        'termsAndConditions',
        'Terms and conditions',
        'Optional customer terms; blank preserves existing wording.',
      ),
      column(
        'defaultAssumptionIds',
        'Default assumption IDs',
        'list',
        `${lists} IDs must exist in the assumption library.`,
      ),
      active,
    ],
  },
  'project-tags': {
    tab: 'project-tags',
    label: 'Project Tags',
    columns: [
      id,
      textColumn(
        'name',
        'Tag name',
        'Unique project classification label.',
        true,
        'Data Centre',
      ),
      active,
    ],
  },
  'profit-share': {
    tab: 'profit-share',
    label: 'Business Units & Profit Share',
    columns: [
      id,
      textColumn(
        'bu',
        'Business unit',
        'Unique BU name. Matching ignores letter case and repeated spaces.',
        true,
        'Delivery',
      ),
      textColumn(
        'buCode',
        'Company BU code',
        'Optional company reference only. Never used as an identity or matching key.',
        false,
        '001',
      ),
      numberColumn(
        'ratePercent',
        'Profit-share rate (%)',
        'Percentage from 0 to 100.',
        true,
        0,
        100,
        10,
      ),
      active,
    ],
  },
  workflow: {
    tab: 'workflow',
    label: 'Workflow Definitions',
    columns: [
      textColumn(
        'code',
        'Node code',
        'Keep the existing node code to update it. Leave blank to assign a new stable code.',
      ),
      column(
        'no',
        'Order',
        'integer',
        'Positive order number. The resulting definition is sorted numerically.',
        { required: true, min: 1, max: 10000, example: 1 },
      ),
      textColumn(
        'name',
        'Name',
        'Workflow node name.',
        true,
        'Technical review',
      ),
      textColumn('nameZh', 'Alternate name', 'Optional alternate node name.'),
      textColumn(
        'owner',
        'Owner',
        'Default responsible owner.',
        true,
        'Engineering',
      ),
      textColumn('detail', 'Detail', 'Optional node instructions.'),
      textColumn(
        'detailZh',
        'Alternate detail',
        'Optional alternate instructions.',
      ),
      flag('required', 'Mandatory', false),
      textColumn(
        'parallelGroup',
        'Parallel group',
        'Optional group name. Group members must be consecutive before publishing.',
      ),
      column(
        'slaDays',
        'SLA days',
        'integer',
        'Node SLA. New-row default: 3.',
        { min: 1, max: 365, example: 3 },
      ),
      column(
        'slaCalendar',
        'SLA calendar',
        'text',
        'New-row default: business.',
        { options: ['business', 'calendar'] },
      ),
      column(
        'slaHolidays',
        'SLA holidays',
        'list',
        `${lists} Every entry must be YYYY-MM-DD.`,
      ),
      flag('reminderEnabled', 'Reminders'),
      column('requiredFields', 'Required fields', 'list', lists),
      flag('roundStart', 'Starts cost round', false),
      flag('requiresConfirmedCost', 'Requires confirmed cost', false),
      flag('finishesWorkflow', 'Finishes workflow', false),
      column(
        'autoSkip',
        'Automatic skip',
        'boolean',
        'TRUE or FALSE. New-row default: inverse of Mandatory. Mandatory nodes cannot skip automatically.',
      ),
      flag('createFolder', 'Create folder'),
    ],
  },
  status: {
    tab: 'status',
    label: 'Project Status Definitions',
    columns: [
      code,
      textColumn('name', 'Name', 'Status display name.', true, 'Active'),
      textColumn('nameZh', 'Alternate name', 'Optional alternate status name.'),
      active,
    ],
  },
  'cpq-catalog': {
    tab: 'cpq-catalog',
    label: 'CPQ Catalog',
    columns: [
      code,
      textColumn(
        'scope',
        'Scope',
        'Company catalog scope description.',
        true,
        'Implementation service',
      ),
      textColumn('unit', 'Unit', 'Pricing unit.', true, 'day'),
      numberColumn(
        'unitCost',
        'Unit cost',
        'Positive unit cost with no more than two decimal places.',
        true,
        0.01,
        1e8,
        100,
      ),
      column('kind', 'Kind', 'text', 'New-row default: service.', {
        options: ['equipment', 'service'],
      }),
      flag('adjustable', 'Adjustable quantity', false),
      active,
      numberColumn(
        'step',
        'Quantity step',
        'Positive quantity increment, at most four decimal places. New-row default: 1.',
        false,
        0.0001,
        1e6,
        1,
      ),
      numberColumn(
        'minQty',
        'Minimum quantity',
        'At most four decimal places. New-row default: 0.',
        false,
        0,
        1e6,
        0,
      ),
      numberColumn(
        'maxQty',
        'Maximum quantity',
        'At least minQty. New-row default: 1000000.',
        false,
        0,
        1e6,
        1000000,
      ),
      numberColumn(
        'referenceQty',
        'Reference quantity',
        'At most four decimal places. New-row default: 1.',
        false,
        0,
        1e6,
        1,
      ),
      textColumn('tags', 'Tags', 'Optional search tags.'),
      textColumn(
        'revision',
        'Revision',
        'Company catalog revision. New-row default: 1.',
      ),
    ],
  },
};

/** Returns detached metadata so consumers cannot change later import rules. */
export function bulkTabSpec(tab: GlobalMasterDataTab): BulkTabSpec {
  if (!Object.hasOwn(specs, tab))
    throw new TypeError(`Unknown master-data tab: ${tab}`);
  return structuredClone(specs[tab]);
}

/** Canonical JSON gives exact stale-preview detection without hash collisions or business writes. */
export function bulkImportContextKey(
  current: Item[],
  related: Related = {},
): string {
  return contentKey({ current, related });
}

/** Blank cells intentionally mean no update; zero and FALSE remain actual values. */
function blank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim())
  );
}

/** Formats only scalar keys and labels; unexpected objects must never become catalog identities. */
function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

/** Parses only explicit scalar formats; loose numeric coercion would silently corrupt Excel data. */
function parseCell(value: unknown, spec: BulkColumn): unknown {
  if (spec.kind === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === 'string' && /^(true|false|1|0)$/i.test(value.trim()))
      return /^(true|1)$/i.test(value.trim());
    throw new TypeError('Use TRUE or FALSE (1 or 0 is also accepted).');
  }
  if (spec.kind === 'number' || spec.kind === 'integer') {
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new TypeError('Enter a valid number.');
    const text = String(value).trim();
    if (
      typeof value === 'string' &&
      !/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)
    )
      throw new TypeError(
        'Enter a decimal number with valid thousands separators.',
      );
    const number =
      typeof value === 'number' ? value : Number(text.replaceAll(',', ''));
    if (
      !Number.isFinite(number) ||
      (spec.kind === 'integer' && !Number.isSafeInteger(number))
    )
      throw new TypeError(`Enter a finite ${spec.kind}.`);
    if (
      (spec.min !== undefined && number < spec.min) ||
      (spec.max !== undefined && number > spec.max)
    )
      throw new TypeError(
        `Enter a value between ${spec.min ?? '-infinity'} and ${spec.max ?? 'infinity'}.`,
      );
    return number;
  }
  if (spec.kind === 'list') {
    let values: unknown = value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (text.startsWith('[')) {
        try {
          values = JSON.parse(text);
        } catch {
          throw new TypeError('Enter a valid JSON string array.');
        }
      } else values = text.split(/[;\r\n]+/).map((entry) => entry.trim());
    }
    if (
      !Array.isArray(values) ||
      values.some((entry) => typeof entry !== 'string' || !entry.trim())
    )
      throw new TypeError('Every list entry must be nonempty text.');
    const result = values.map((entry: string) => entry.trim());
    if (new Set(result).size !== result.length)
      throw new TypeError('List entries must be unique.');
    return result;
  }
  if (spec.kind === 'date') {
    if (typeof value !== 'string' || !isValidIsoDate(value.trim()))
      throw new TypeError('Enter a valid calendar date as YYYY-MM-DD.');
    return value.trim();
  }
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new TypeError('Enter text.');
  const text = String(value).trim();
  if (spec.options && !spec.options.includes(text))
    throw new TypeError(`Choose one of: ${spec.options.join(', ')}.`);
  // Identity and option whitespace is incidental; free-form customer wording is preserved verbatim.
  return spec.options || ['id', 'code'].includes(spec.key)
    ? text
    : String(value);
}

/** Supplies only documented defaults for new rows; existing rows keep their exact stored metadata. */
function newItem(tab: GlobalMasterDataTab, values: Item): Item {
  const identity = ['workflow', 'status', 'cpq-catalog'].includes(tab)
    ? {}
    : { id: crypto.randomUUID() };
  const defaults: Record<GlobalMasterDataTab, Item> = {
    resources: {
      category: 'internal',
      pool: 'LOCAL',
      level: 'L1',
      mandaysPerMonth: 21.75,
      hoursPerManday: 8,
      hqTravel: false,
      effectiveTo: '',
      active: true,
    },
    subcontract: { currency: 'SGD', active: true },
    supplemental: { currency: 'SGD', owner: '', sourceNote: '', active: true },
    maintenance: { currency: 'SGD', outcome: 'Reference' },
    assumptions: {
      category: 'General',
      clientPattern: '*',
      textZh: '',
      active: true,
    },
    'quote-templates': {
      clientPattern: '*',
      validityDays: 30,
      termsAndConditions: '',
      defaultAssumptionIds: [],
      active: true,
    },
    'profit-share': { active: true },
    'project-tags': { active: true },
    workflow: {
      code: `CUSTOM-STAGE-${crypto.randomUUID()}`,
      nameZh: '',
      state: 'not_started',
      tone: 'gray',
      date: '',
      dateZh: '',
      detail: '',
      detailZh: '',
      input: '',
      inputZh: '',
      required: false,
      parallelGroup: '',
      slaDays: 3,
      slaCalendar: 'business',
      slaHolidays: [],
      reminderEnabled: true,
      requiredFields: [],
      roundStart: false,
      requiresConfirmedCost: false,
      finishesWorkflow: false,
      autoSkip: values.required !== true,
      createFolder: true,
    },
    status: { nameZh: '', active: true },
    'cpq-catalog': {
      kind: 'service',
      adjustable: false,
      active: true,
      step: 1,
      minQty: 0,
      maxQty: 1000000,
      referenceQty: 1,
      tags: '',
      revision: '1',
    },
  };
  if (tab === 'resources' && values.category === 'subcontract')
    Object.assign(defaults.resources, { pool: null, level: null });
  return { ...identity, ...defaults[tab], ...values };
}

const definitionNames: Record<GlobalMasterDataTab, string> = {
  resources: 'resourceType',
  subcontract: 'subcontractItem',
  supplemental: 'supplementalCostItem',
  maintenance: 'maintenancePriceRecord',
  assumptions: 'assumptionDefinition',
  'quote-templates': 'quoteTemplate',
  'profit-share': 'profitShareRate',
  'project-tags': 'projectTagDefinition',
  workflow: 'workflowStep',
  status: 'projectStatusDefinition',
  'cpq-catalog': 'cpqCatalogItem',
};
// Compilation stays lazy because Worker SSR forbids AJV's dynamic code generation during imports.
let ajv: Ajv2020 | undefined;
const validators = new Map<GlobalMasterDataTab, ValidateFunction>();

/** Reuses the exact persisted record schemas rather than a weaker spreadsheet-only shape. */
function validator(tab: GlobalMasterDataTab): ValidateFunction {
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(costSchema);
    ajv.addSchema(workspaceSchema);
  }
  let validate = validators.get(tab);
  if (!validate) {
    validate = ajv.compile({
      $ref: `${tab === 'resources' ? costSchema.$id : workspaceSchema.$id}#/$defs/${definitionNames[tab]}`,
    });
    validators.set(tab, validate);
  }
  return validate;
}

/** Converts schema and domain failures into original spreadsheet row locations. */
function validateItem(
  tab: GlobalMasterDataTab,
  item: Item,
  row: number,
  related: Related,
): BulkImportIssue[] {
  const issues: BulkImportIssue[] = [];
  const add = (message: string, column?: string) =>
    issues.push({ row, column, message });
  const validate = validator(tab);
  if (!validate(item)) {
    for (const error of validate.errors ?? [])
      add(
        error.message ?? 'Invalid value.',
        error.instancePath.split('/')[1] || error.params.missingProperty,
      );
    return issues;
  }
  try {
    if (tab === 'resources') {
      if (!isValidIsoDate(String(item.effectiveFrom)))
        add('Enter a valid calendar date.', 'effectiveFrom');
      if (item.effectiveTo && !isValidIsoDate(scalarText(item.effectiveTo)))
        add('Enter a valid calendar date.', 'effectiveTo');
      if (
        item.effectiveTo &&
        scalarText(item.effectiveFrom) > scalarText(item.effectiveTo)
      )
        add('Effective to must be on or after effective from.', 'effectiveTo');
      if (item.hqTravel && item.pool !== 'HQ')
        add('HQ travel applies only to HQ resources.', 'hqTravel');
    }
    if (
      tab === 'project-tags' &&
      normalizeProjectTags([scalarText(item.name)])[0] !== item.name
    )
      add('Remove leading, trailing or repeated whitespace.', 'name');
    if (tab === 'maintenance')
      assertMaintenanceImport({ schemaVersion: '1.0.0', records: [item] });
    if (tab === 'profit-share')
      for (const error of validateProfitShareRates([item])) add(error);
    if (tab === 'cpq-catalog') assertCatalog([item as CatalogItem]);
    if (tab === 'quote-templates') {
      if (item.excel)
        for (const error of validateQuoteExcelMapping(
          item.excel as QuoteExcelTemplate,
        ))
          add(error);
      const available = new Set(
        (related.assumptions ?? []).map((entry) => entry.id),
      );
      for (const id of (item.defaultAssumptionIds ?? []) as string[])
        if (!available.has(id))
          add(`Unknown assumption ID: ${id}.`, 'defaultAssumptionIds');
    }
    if (tab === 'workflow') {
      if (
        item.state !== 'not_started' ||
        item.tone !== 'gray' ||
        item.date ||
        item.dateZh ||
        item.input ||
        item.inputZh ||
        [
          'startedAt',
          'dueAt',
          'completedAt',
          'pausedAt',
          'fieldValues',
          'skippedBy',
          'followUpDate',
          'note',
          'updatedAt',
        ].some((key) => Object.hasOwn(item, key))
      )
        add(
          'Workflow imports contain definitions only; project execution state cannot be imported.',
        );
      if (item.required && item.autoSkip)
        add('Mandatory nodes cannot skip automatically.', 'autoSkip');
      for (const date of (item.slaHolidays ?? []) as string[])
        if (!isValidIsoDate(date))
          add(`Invalid holiday date: ${date}.`, 'slaHolidays');
      for (const field of (item.requiredFields ?? []) as string[])
        if (!field.trim())
          add('Required field names cannot be blank.', 'requiredFields');
    }
  } catch (error) {
    add(error instanceof Error ? error.message : 'Invalid catalog record.');
  }
  return issues;
}

/** Uses exact IDs/codes, with normalized BU names as the only special business identity. */
function matchingItems(
  tab: GlobalMasterDataTab,
  values: Item,
  items: Item[],
): Item[] {
  const keyField = ['workflow', 'status', 'cpq-catalog'].includes(tab)
    ? 'code'
    : 'id';
  return items.filter(
    (item) =>
      (!!values[keyField] && values[keyField] === item[keyField]) ||
      (['resources', 'subcontract', 'supplemental'].includes(tab) &&
        !!values.code &&
        values.code === item.code) ||
      (tab === 'project-tags' &&
        !!values.name &&
        projectTagKey(scalarText(values.name)) ===
          projectTagKey(scalarText(item.name))) ||
      (tab === 'profit-share' &&
        !!values.bu &&
        normalizeBu(scalarText(values.bu)) ===
          normalizeBu(scalarText(item.bu))),
  );
}

/** Previews an all-or-nothing upsert. No workbook row can remove an unmentioned catalog record. */
export function previewBulkImport(
  tab: GlobalMasterDataTab,
  input: { row: number; values: Item }[],
  current: Item[],
  related: Related = {},
): BulkImportPreview {
  const spec = bulkTabSpec(tab);
  const items = structuredClone(current);
  const result: BulkImportPreview = {
    items,
    issues: [],
    added: 0,
    updated: 0,
    unchanged: 0,
    changes: [],
    contextKey: bulkImportContextKey(current, related),
  };
  const keyField = ['workflow', 'status', 'cpq-catalog'].includes(tab)
    ? 'code'
    : 'id';
  const importedKeys = new Map<string, number>();
  const sourceRows = new Map<string, number>();
  const allowed = new Set(spec.columns.map((entry) => entry.key));
  if (input.length > 10000)
    result.issues.push({
      row: 0,
      message: 'Import at most 10000 rows at once.',
    });
  if (!input.length)
    result.issues.push({ row: 0, message: 'No data rows were found.' });
  for (const { row, values: raw } of input.slice(0, 10000)) {
    const values: Item = {};
    for (const key of Object.keys(raw))
      if (!allowed.has(key))
        result.issues.push({
          row,
          column: key,
          message: 'Unknown or unsupported import column.',
        });
    for (const field of spec.columns) {
      if (blank(raw[field.key])) continue;
      try {
        values[field.key] = parseCell(raw[field.key], field);
      } catch (error) {
        result.issues.push({
          row,
          column: field.key,
          message: error instanceof Error ? error.message : 'Invalid cell.',
        });
      }
    }
    const matches = matchingItems(tab, values, items);
    if (matches.length > 1) {
      result.issues.push({
        row,
        message:
          'ID and business key identify different records. Resolve the conflicting identifiers.',
      });
      continue;
    }
    const existing = matches[0];
    if (existing && values.id && values.id !== existing.id) {
      result.issues.push({
        row,
        column: 'id',
        message:
          'The existing code or BU belongs to a different ID. Keep its original ID or leave ID blank.',
      });
      continue;
    }
    if (!existing)
      for (const field of spec.columns)
        if (field.required && blank(values[field.key]))
          result.issues.push({
            row,
            column: field.key,
            message: 'Required for a new record.',
          });
    const item = existing ? { ...existing, ...values } : newItem(tab, values);
    if (tab === 'workflow' && values.no !== undefined)
      item.no = scalarText(values.no).padStart(2, '0');
    const key = String(item[keyField]);
    if (importedKeys.has(key)) {
      result.issues.push({
        row,
        column: keyField,
        message: `Duplicate import identity; already specified at row ${importedKeys.get(key)}.`,
      });
      continue;
    }
    importedKeys.set(key, row);
    sourceRows.set(key, row);
    result.issues.push(...validateItem(tab, item, row, related));
    const action = !existing
      ? 'add'
      : contentKey(existing) === contentKey(item)
        ? 'unchanged'
        : 'update';
    result.changes.push({
      row,
      key,
      label: scalarText(
        item.name ?? item.item ?? item.bu ?? item.scope ?? item.client ?? key,
      ),
      action,
    });
    if (action === 'add') {
      result.added++;
      items.push(item);
    } else if (action === 'update') {
      result.updated++;
      items[items.indexOf(existing)] = item;
    } else result.unchanged++;
  }
  // Check the final combined directory too: changing a code must not collide with an untouched row.
  const identities = new Map<string, number>();
  for (const item of items) {
    const row = sourceRows.get(String(item[keyField])) ?? 0;
    // Existing drafts can contain invalid edits; prevent importing a valid file into an unsaveable combined directory.
    if (!sourceRows.has(String(item[keyField])))
      result.issues.push(...validateItem(tab, item, row, related));
    const identitiesForItem = [`${keyField}:${String(item[keyField])}`];
    if (['resources', 'subcontract', 'supplemental'].includes(tab))
      identitiesForItem.push(`code:${String(item.code)}`);
    if (tab === 'project-tags')
      identitiesForItem.push(`tag:${projectTagKey(scalarText(item.name))}`);
    if (tab === 'profit-share')
      identitiesForItem.push(`bu:${normalizeBu(String(item.bu))}`);
    for (const identity of identitiesForItem) {
      if (identities.has(identity))
        result.issues.push({
          row,
          message: `Duplicate catalog identity: ${identity}.`,
        });
      identities.set(identity, row);
    }
  }
  if (items.length > 10000)
    result.issues.push({
      row: 0,
      message: 'The merged catalog cannot exceed 10000 records.',
    });
  if (tab === 'workflow')
    items.sort((left, right) =>
      String(left.no).localeCompare(String(right.no), 'en', { numeric: true }),
    );
  // Invalid batches expose the unchanged baseline so even an inattentive caller cannot partially import them.
  if (result.issues.length) {
    result.items = structuredClone(current);
    result.added = 0;
    result.updated = 0;
    result.unchanged = 0;
  }
  return result;
}
