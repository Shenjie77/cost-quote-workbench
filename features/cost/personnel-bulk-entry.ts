/** Local, deterministic personnel table parsing. Pasted prices never become costs. */
import {
  YEAR_BUCKETS,
  getActualYears,
  getY1Year,
  recalculateCostRows,
  roundMoney,
  roundQuantity,
  totalRowCost,
  totalRowMandays,
  type CostInputRow,
  type RateSettings,
  type ResourceType,
} from './domain.ts';
import { COST_LIMITS } from './validation.ts';

export const PERSONNEL_BULK_LIMITS = {
  characters: 1_000_000,
  rows: 1000,
  columns: 40,
} as const;
export type PersonnelBulkMode = 'sites' | 'mandays';
export type PersonnelBulkColumnTarget =
  | 'groupName'
  | 'scope'
  | 'bu'
  | 'reType'
  | 'mode'
  | 'mdPerSite'
  | 'sites'
  | 'mandays'
  | 'ignore'
  | 'unmapped'
  | `sites:${number}`
  | `mandays:${number}`
  | `quantity:${number}`;
export type PersonnelBulkOptions = {
  resources: ResourceType[];
  rates: RateSettings;
  defaultMode: PersonnelBulkMode;
  defaultYear: number;
  defaultBU?: string;
  defaultRETypeId?: string;
  hasHeader?: boolean;
  fillDownScope?: boolean;
  fillDownGroup?: boolean;
  mapping?: Record<number, PersonnelBulkColumnTarget>;
  reTypeOverrides?: Record<number, string>;
};
export type PersonnelBulkColumn = {
  index: number;
  header: string;
  target: PersonnelBulkColumnTarget;
  detected: PersonnelBulkColumnTarget;
};
export type PersonnelBulkEntry = {
  sourceRow: number;
  groupName?: string;
  scope: string;
  bu: string;
  reTypeText: string;
  reTypeId?: string;
  mode: PersonnelBulkMode;
  mdPerSite: number | null;
  quantities: (number | null)[];
  costs: number[] | null;
  issues: string[];
  row?: CostInputRow;
};
export type PersonnelBulkPreview = {
  rows: CostInputRow[];
  entries: PersonnelBulkEntry[];
  columns: PersonnelBulkColumn[];
  issues: string[];
  notices: string[];
  canConfirm: boolean;
  basisFingerprint: string;
  totalCost: number;
  totalMandays: number;
};

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—./()（）]+/g, '');
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  return value;
};

/** Current version rates/resources, including the active allowance policy. No project rows are replaced. */
export function personnelBulkBasisFingerprint(
  resources: ResourceType[],
  rates: RateSettings,
): string {
  return JSON.stringify(
    stableValue({
      resources: [...resources].sort((a, b) => a.id.localeCompare(b.id)),
      rates,
    }),
  );
}

/** Match only one active internal record; aliases that collide are deliberately unresolved. */
export function matchPersonnelBulkResource(
  value: string,
  resources: ResourceType[],
) {
  const key = normalize(value);
  const matches = key
    ? resources.filter(
        (resource) =>
          resource.active &&
          resource.category === 'internal' &&
          [resource.id, resource.code, resource.name].some(
            (alias) => normalize(alias) === key,
          ),
      )
    : [];
  return {
    resource: matches.length === 1 ? matches[0] : undefined,
    ambiguous: matches.length > 1,
  };
}

const aliases: Record<string, PersonnelBulkColumnTarget> = {};
for (const [target, names] of Object.entries({
  groupName: [
    'group',
    'group name',
    'groupname',
    '分组',
    '组名',
    '分组名称',
    'Group / 分组',
  ],
  scope: [
    'scope',
    'scope description',
    'description',
    'work scope',
    '工作范围',
    '范围',
    '工作内容',
    '服务范围',
    '项目范围',
    'Scope / 工作范围',
    'Scope / 范围',
  ],
  bu: ['bu', 'business unit', '业务单元', '事业部', '部门', 'BU / 业务单元'],
  reType: [
    're type',
    'retype',
    're type code',
    'resource type',
    'resource',
    're code',
    're',
    '人员类型',
    '资源类型',
    '人员编码',
    '人员类别',
    'RE Type / 人员类型',
    'RE Type / 资源类型',
  ],
  mode: ['mode', 'input mode', '录入模式', '模式'],
  mdPerSite: [
    'md/site',
    'md per site',
    'mandays per site',
    'md-site',
    'md/站',
    '人天/站',
    '每站人天',
    '每站点人天',
    '单站人天',
  ],
  sites: ['sites', 'site', 'site count', '站点', '站点数', '站数', '站点数量'],
  mandays: [
    'md',
    'mandays',
    'man days',
    'direct md',
    '人天',
    '人天数',
    '总人天',
  ],
}))
  for (const name of names)
    aliases[normalize(name)] = target as PersonnelBulkColumnTarget;
export const isPersonnelBulkCostColumn = (value: string) =>
  /(?:^|[^a-z])(?:costs?|prices?|amounts?|rates?|sgd)(?:$|[^a-z])|费用|成本|金额|单价|费率/i.test(
    value.replace(/([a-z])([A-Z])/g, '$1 $2'),
  );
const totalLabel = (value: string) =>
  /^(?:total|subtotal|grandtotal|合计|小计|总计)$/i.test(normalize(value));

function detectColumn(
  header: string,
  rates: RateSettings,
): { target: PersonnelBulkColumnTarget; issue?: string } {
  if (isPersonnelBulkCostColumn(header)) return { target: 'ignore' };
  const key = normalize(header);
  const matches = [
    ...header
      .normalize('NFKC')
      .matchAll(
        /(?:[Yy]\s*([1-5])(?!\d)|(?<!\d)((?:19|20|21|22)\d{2})(?!\d))/g,
      ),
  ];
  if (matches.length > 1)
    return {
      target: 'unmapped',
      issue: `Ambiguous year header “${header}”. Choose one year in the column mapping.`,
    };
  if (matches.length === 1) {
    const match = matches[0];
    const index = match[1]
      ? Number(match[1]) - 1
      : getActualYears(rates).indexOf(Number(match[2]));
    if (index < 0)
      return {
        target: 'unmapped',
        issue: `Calendar year “${header}” is outside this version's Y1–Y5. Set delivery dates or map its year explicitly.`,
      };
    const rest = normalize(header.replace(match[0], ''));
    const type = aliases[rest];
    if (!rest || rest === '年') return { target: `quantity:${index}` };
    if (type === 'sites' || type === 'mandays')
      return { target: `${type}:${index}` };
    return { target: 'unmapped' };
  }
  return { target: aliases[key] || 'unmapped' };
}

type MatrixRow = { sourceRow: number; cells: string[] };
function readMatrix(text: string): {
  rows: MatrixRow[];
  issues: string[];
  notices: string[];
} {
  if (text.length > PERSONNEL_BULK_LIMITS.characters)
    return {
      rows: [],
      issues: ['Paste at most 1,000,000 characters per batch.'],
      notices: [],
    };
  const value = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = value.split('\n').find((line) => line.trim()) || '';
  const delimiter = first.includes('\t')
    ? '\t'
    : first.includes('|')
      ? '|'
      : first.includes(',')
        ? ','
        : /\S {2,}\S/.test(first)
          ? 'spaces'
          : ',';
  const records: MatrixRow[] = [];
  const issues: string[] = [];
  const notices: string[] = [];
  let cells: string[] = [],
    cell = '',
    quoted = false,
    afterQuote = false,
    line = 1,
    startLine = 1;
  const addRow = () => {
    cells.push(cell.trim());
    if (delimiter === '|') {
      if (!cells[0]) cells.shift();
      if (!cells.at(-1)) cells.pop();
    }
    if (cells.some((item) => item.trim())) {
      if (
        delimiter === '|' &&
        cells.every((item) => /^:?-{3,}:?$/.test(item.trim()))
      )
        notices.push(`Row ${startLine}: Markdown separator ignored.`);
      else records.push({ sourceRow: startLine, cells });
    }
    cells = [];
    cell = '';
    afterQuote = false;
  };
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += char;
        if (char === '\n') line++;
      }
      continue;
    }
    if (char === '"' && !cell.trim() && !afterQuote) {
      quoted = true;
      continue;
    }
    const isDelimiter =
      delimiter === 'spaces'
        ? char === ' ' && value[index + 1] === ' '
        : char === delimiter;
    if (isDelimiter) {
      cells.push(cell.trim());
      cell = '';
      afterQuote = false;
      if (delimiter === 'spaces') while (value[index + 1] === ' ') index++;
    } else if (char === '\n') {
      addRow();
      line++;
      startLine = line;
      if (records.length > PERSONNEL_BULK_LIMITS.rows + 1)
        return {
          rows: [],
          issues: ['Paste at most 1,000 data rows per batch.'],
          notices: [],
        };
    } else if (afterQuote && char.trim()) {
      issues.push(
        `Row ${line}: unexpected text after a quoted cell. Check delimiters and quotation marks.`,
      );
      afterQuote = false;
      cell += char;
    } else cell += char;
    if (cells.length > PERSONNEL_BULK_LIMITS.columns + 2)
      return {
        rows: [],
        issues: ['Use at most 40 columns per batch.'],
        notices: [],
      };
  }
  if (quoted) issues.push(`Row ${startLine}: quotation marks are not closed.`);
  addRow();
  if (records.length > PERSONNEL_BULK_LIMITS.rows + 1)
    issues.push('Paste at most 1,000 data rows per batch.');
  return { rows: records, issues, notices };
}

function quantity(value: string, integer: boolean): number | null {
  const text = value.trim().replace(/[\u00a0\u202f]/g, '');
  if (!text) return 0;
  const normalized = /^\+?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)
    ? text.replace(/,/g, '')
    : text;
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized))
    return null;
  const result = Number(normalized);
  return Number.isFinite(result) &&
    result >= 0 &&
    result <= (integer ? COST_LIMITS.sites : COST_LIMITS.mdPerSite) &&
    (!integer || Number.isInteger(result))
    ? result
    : null;
}
const modeValue = (value: string): PersonnelBulkMode | null => {
  const key = normalize(value);
  if (['sites', 'site', 'persite', '站点', '站点模式', '按站点'].includes(key))
    return 'sites';
  if (['md', 'mandays', 'directmd', '人天', '直接人天', '按人天'].includes(key))
    return 'mandays';
  return null;
};
const targetAllowed = (target: string) =>
  [
    'groupName',
    'scope',
    'bu',
    'reType',
    'mode',
    'mdPerSite',
    'sites',
    'mandays',
    'ignore',
    'unmapped',
  ].includes(target) || /^(?:sites|mandays|quantity):[0-4]$/.test(target);

export function parsePersonnelBulkEntry(
  text: string,
  options: PersonnelBulkOptions,
): PersonnelBulkPreview {
  const preview: PersonnelBulkPreview = {
    rows: [],
    entries: [],
    columns: [],
    issues: [],
    notices: [],
    canConfirm: false,
    basisFingerprint: personnelBulkBasisFingerprint(
      options.resources,
      options.rates,
    ),
    totalCost: 0,
    totalMandays: 0,
  };
  if (!text.trim()) {
    preview.issues.push('Paste or type a personnel table first.');
    return preview;
  }
  if (
    !Number.isInteger(options.defaultYear) ||
    options.defaultYear < 0 ||
    options.defaultYear > 4
  ) {
    preview.issues.push('Choose a delivery year between Y1 and Y5.');
    return preview;
  }
  const parsed = readMatrix(text);
  preview.issues.push(...parsed.issues);
  preview.notices.push(...parsed.notices);
  if (parsed.issues.length) return preview;
  if (!parsed.rows.length) {
    preview.issues.push(
      'No personnel table cells were found. Paste a header and at least one data row.',
    );
    return preview;
  }
  const hasHeader = options.hasHeader !== false;
  const header = hasHeader
    ? parsed.rows[0].cells
    : parsed.rows[0].cells.map((_, index) => `Column ${index + 1}`);
  if (header.length > PERSONNEL_BULK_LIMITS.columns) {
    preview.issues.push('Use at most 40 columns per batch.');
    return preview;
  }
  const data = hasHeader ? parsed.rows.slice(1) : parsed.rows;
  if (data.length > PERSONNEL_BULK_LIMITS.rows) {
    preview.issues.push('Paste at most 1,000 data rows per batch.');
    return preview;
  }
  const targets = new Set<string>();
  preview.columns = header.map((name, index) => {
    const detected = hasHeader
      ? detectColumn(name, options.rates)
      : { target: 'unmapped' as const };
    // Financial columns can never be repurposed as effort by an accidental mapping.
    const target =
      hasHeader && isPersonnelBulkCostColumn(name)
        ? 'ignore'
        : (options.mapping?.[index] ?? detected.target);
    if (detected.issue && options.mapping?.[index] === undefined)
      preview.issues.push(detected.issue);
    if (!targetAllowed(target))
      preview.issues.push(`Column ${index + 1}: invalid mapping.`);
    if (
      target === 'unmapped' &&
      data.some((record) => record.cells[index]?.trim())
    )
      preview.issues.push(
        `Map column “${name || index + 1}” or explicitly choose Ignore.`,
      );
    const canonical =
      target === 'sites' || target === 'mandays'
        ? `${target}:${options.defaultYear}`
        : target;
    if (!['ignore', 'unmapped'].includes(target)) {
      if (targets.has(canonical))
        preview.issues.push(
          `Duplicate mapping for “${name}”. Keep one column for each field/year.`,
        );
      targets.add(canonical);
    }
    if (
      target === 'ignore' &&
      data.some((record) => record.cells[index]?.trim())
    )
      preview.notices.push(
        `Column “${name || index + 1}” ignored${isPersonnelBulkCostColumn(name) ? '; costs are recalculated from effort and version rates' : ' by column mapping'}.`,
      );
    return {
      index,
      header: name || `Column ${index + 1}`,
      target,
      detected: detected.target,
    };
  });
  const columns = preview.columns;
  const effortColumns = columns.filter(({ target }) =>
    /^(?:sites|mandays)(?::[0-4])?$|^quantity:[0-4]$/.test(target),
  );
  if (!effortColumns.length)
    preview.issues.push(
      'Map at least one Sites or MD column. Cost-only amounts cannot create personnel effort.',
    );
  const column = (target: string) =>
    columns.find((item) => item.target === target)?.index;
  const get = (record: MatrixRow, target: string) => {
    const index = column(target);
    return index === undefined ? '' : record.cells[index]?.trim() || '';
  };
  let previousScope = '';
  let previousGroup = '';
  for (const record of data) {
    const rowIssues: string[] = [];
    if (record.cells.slice(header.length).some((value) => value.trim()))
      rowIssues.push('This row has extra cells beyond the mapped columns.');
    let scope = get(record, 'scope');
    const rawRE = get(record, 'reType');
    if (
      totalLabel(scope || record.cells.find((cell) => cell.trim()) || '') &&
      (!rawRE || totalLabel(rawRE))
    ) {
      preview.notices.push(
        `Row ${record.sourceRow}: summary row “${scope || record.cells.find((cell) => cell.trim())}” skipped.`,
      );
      continue;
    }
    let groupName = get(record, 'groupName');
    if (!groupName && options.fillDownGroup === true && previousGroup) {
      groupName = previousGroup;
      preview.notices.push(
        `Row ${record.sourceRow}: Group filled down from “${previousGroup}”.`,
      );
    }
    if (groupName) previousGroup = groupName;
    if (Array.from(groupName).length > 200)
      rowIssues.push('Group must be at most 200 characters.');
    if (!scope && options.fillDownScope !== false && previousScope) {
      scope = previousScope;
      preview.notices.push(
        `Row ${record.sourceRow}: Scope filled down from “${previousScope}”.`,
      );
    }
    if (scope) previousScope = scope;
    const bu = get(record, 'bu') || options.defaultBU?.trim() || '';
    if (!scope || scope.length > 500)
      rowIssues.push('Scope is required and must be at most 500 characters.');
    if (!bu || bu.length > 200)
      rowIssues.push('BU is required and must be at most 200 characters.');
    const explicitREId = Object.hasOwn(
      options.reTypeOverrides || {},
      record.sourceRow,
    )
      ? options.reTypeOverrides![record.sourceRow]
      : !rawRE
        ? options.defaultRETypeId
        : undefined;
    const reText = explicitREId ?? rawRE;
    // Dropdown choices are exact record IDs, even if another record has that text as an alias.
    const matched =
      explicitREId !== undefined
        ? {
            resource: options.resources.find(
              (resource) =>
                resource.id === explicitREId &&
                resource.active &&
                resource.category === 'internal',
            ),
            ambiguous: false,
          }
        : matchPersonnelBulkResource(reText, options.resources);
    if (!matched.resource)
      rowIssues.push(
        matched.ambiguous
          ? `RE Type “${reText}” is ambiguous. Select the intended record.`
          : `Select an active internal RE Type${reText ? ` for “${reText}”` : ''}.`,
      );
    const rawMode = get(record, 'mode');
    const explicitMode = rawMode ? modeValue(rawMode) : null;
    if (rawMode && !explicitMode)
      rowIssues.push(
        `Unknown input mode “${rawMode}”. Use Sites or Direct MD.`,
      );
    const explicitSites = effortColumns.some(({ target }) =>
      target.startsWith('sites'),
    );
    const explicitMD = effortColumns.some(({ target }) =>
      target.startsWith('mandays'),
    );
    const mode =
      explicitMode ||
      (explicitSites && !explicitMD
        ? 'sites'
        : explicitMD && !explicitSites
          ? 'mandays'
          : options.defaultMode);
    const mdPerSite = quantity(get(record, 'mdPerSite'), false);
    if (mdPerSite === null)
      rowIssues.push('MD/Site must be a number between 0 and 1,000,000.');
    const annual: { sites: (number | null)[]; mandays: (number | null)[] } = {
      sites: [0, 0, 0, 0, 0],
      mandays: [0, 0, 0, 0, 0],
    };
    const seen = new Set<string>();
    let provided = false;
    for (const item of effortColumns) {
      const [kind, year] = item.target.split(':');
      const kindForMode = (
        kind === 'quantity' ? mode : kind
      ) as PersonnelBulkMode;
      const yearIndex = year === undefined ? options.defaultYear : Number(year);
      const key = `${kindForMode}:${yearIndex}`;
      if (seen.has(key))
        rowIssues.push(
          `Multiple columns write ${YEAR_BUCKETS[yearIndex]} ${kindForMode === 'sites' ? 'Sites' : 'MD'}.`,
        );
      seen.add(key);
      const raw = record.cells[item.index]?.trim() || '';
      if (raw) provided = true;
      const amount = quantity(raw, kindForMode === 'sites');
      if (amount === null)
        rowIssues.push(
          `${item.header}: enter ${kindForMode === 'sites' ? 'a whole number' : 'a number'} between 0 and 1,000,000.`,
        );
      annual[kindForMode][yearIndex] = amount;
    }
    if (!provided)
      rowIssues.push(
        'Enter at least one annual Sites or MD value (zero is allowed).',
      );
    if (mode === 'sites') {
      if (
        annual.sites.some((amount) => amount !== null && amount > 0) &&
        !mdPerSite
      )
        rowIssues.push(
          'Positive site counts require MD/Site greater than zero.',
        );
      for (let index = 0; index < 5; index++) {
        if (
          seen.has(`mandays:${index}`) &&
          annual.mandays[index] !== null &&
          roundQuantity(annual.mandays[index]!) !==
            roundQuantity((annual.sites[index] || 0) * (mdPerSite || 0))
        )
          rowIssues.push(
            `${YEAR_BUCKETS[index]} MD does not match Sites × MD/Site.`,
          );
      }
      if (!seen.size || ![...seen].some((key) => key.startsWith('sites:')))
        rowIssues.push('Sites mode requires a Sites column.');
    } else {
      if (mdPerSite)
        rowIssues.push(
          'Direct MD cannot also contain MD/Site. Clear it or use Sites mode.',
        );
      if (annual.sites.some((amount) => amount !== null && amount !== 0))
        rowIssues.push(
          'Direct MD cannot also contain site counts. Clear them or use Sites mode.',
        );
      if (![...seen].some((key) => key.startsWith('mandays:')))
        rowIssues.push('Direct MD requires an MD column.');
    }
    const entry: PersonnelBulkEntry = {
      sourceRow: record.sourceRow,
      ...(column('groupName') !== undefined ? { groupName } : {}),
      scope,
      bu,
      reTypeText: rawRE || options.defaultRETypeId || '',
      reTypeId: matched.resource?.id,
      mode,
      mdPerSite,
      quantities: annual[mode],
      costs: null,
      issues: rowIssues,
    };
    if (!rowIssues.length && matched.resource) {
      const raw: CostInputRow = {
        id: `BULK-PREVIEW-${record.sourceRow}`,
        ...(column('groupName') !== undefined ? { groupName } : {}),
        scope,
        bu,
        reTypeId: matched.resource.id,
        inputMode: mode,
        mdPerSite: mode === 'sites' ? mdPerSite! : 0,
        years: YEAR_BUCKETS.map((bucket, index) => ({
          bucket,
          sites: mode === 'sites' ? annual.sites[index]! : 0,
          ...(mode === 'mandays' ? { mandays: annual.mandays[index]! } : {}),
          cost: 0,
        })),
      };
      const calculated = recalculateCostRows(
        [raw],
        options.resources,
        options.rates,
      )[0];
      if (
        calculated.years.some(
          ({ cost }) =>
            !Number.isFinite(cost) || cost < 0 || cost > COST_LIMITS.money,
        ) ||
        totalRowCost(calculated) > COST_LIMITS.money
      )
        entry.issues.push(
          'Calculated cost exceeds the supported amount. Check effort and the version RE rate.',
        );
      else {
        entry.row = calculated;
        entry.costs = calculated.years.map((year) => year.cost);
        preview.rows.push(calculated);
      }
    }
    preview.entries.push(entry);
  }
  if (!preview.entries.length)
    preview.issues.push('No personnel data rows were found.');
  preview.totalCost = roundMoney(
    preview.rows.reduce((sum, row) => sum + totalRowCost(row), 0),
  );
  preview.totalMandays = roundQuantity(
    preview.rows.reduce((sum, row) => sum + totalRowMandays(row), 0),
  );
  if (preview.totalCost > COST_LIMITS.money)
    preview.issues.push(
      'This batch exceeds the supported total cost. Split or correct the input.',
    );
  if (getY1Year(options.rates) === null && preview.totalMandays > 0)
    preview.notices.push(
      'Delivery start is not set. Costs currently use the version fallback; set dates before finalizing the cost version.',
    );
  preview.canConfirm =
    !preview.issues.length &&
    !!preview.entries.length &&
    preview.entries.every((entry) => !entry.issues.length && !!entry.row);
  return preview;
}
