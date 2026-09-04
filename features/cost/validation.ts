/**
 * Runtime validation shared by browser export and cost-cli.
 *
 * JSON Schema protects the CLI transport shape. These checks additionally
 * enforce cross-field business rules and protect browser callers, which hold
 * typed React state but do not run Ajv before every export.
 */

import {
  COST_EXPORT_SCHEMA_VERSION,
  type CostExportSnapshot,
} from './contracts.ts';
import {
  getCostStatementValues,
  getHQTravelSummary,
  getY1Year,
  totalRowCost,
  totalRowMandays,
  totalRowSites,
  YEAR_BUCKETS,
} from './domain.ts';

export const COST_LIMITS = {
  money: 1_000_000_000_000,
  sites: 1_000_000,
  mdPerSite: 1_000_000,
  mandaysPerMonth: 1_000,
  hoursPerManday: 24,
  trips: 100_000,
  upliftPercent: 1_000,
} as const;

export type CostExportIssue = {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
};

const finiteInRange = (value: unknown, minimum: number, maximum: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
};

/** Rejects calendar-looking strings such as 2026-99-99. */
export const isValidIsoDate = (value: string, allowEmpty = false) => {
  if (allowEmpty && value === '') return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/** Validates an ISO UTC timestamp and rejects Date.parse normalization. */
const isValidUtcTimestamp = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
};

/**
 * Returns every blocking error and non-blocking warning in deterministic
 * order. Callers must block export whenever at least one `severity=error`
 * issue is present.
 */
export const validateCostExportSnapshot = (
  snapshot: CostExportSnapshot,
): CostExportIssue[] => {
  const issues: CostExportIssue[] = [];
  const add = (
    severity: CostExportIssue['severity'],
    code: string,
    path: string,
    message: string,
  ) => issues.push({ severity, code, path, message });

  if (snapshot.schemaVersion !== COST_EXPORT_SCHEMA_VERSION) {
    add(
      'error',
      'UNSUPPORTED_SCHEMA_VERSION',
      '/schemaVersion',
      `Expected cost schema ${String(COST_EXPORT_SCHEMA_VERSION)}.`,
    );
  }

  if (!isValidUtcTimestamp(snapshot.exportedAt)) {
    add(
      'error',
      'INVALID_EXPORTED_AT',
      '/exportedAt',
      'exportedAt must be a real UTC timestamp.',
    );
  }
  [
    ['/project/id', snapshot.project.id],
    ['/project/name', snapshot.project.name],
    ['/project/client', snapshot.project.client],
    ['/costVersion/code', snapshot.costVersion.code],
    ['/costVersion/status', snapshot.costVersion.status],
  ].forEach(([path, value]) => {
    if (!String(value).trim()) {
      add(
        'error',
        'REQUIRED_TEXT',
        path,
        'Value cannot be blank or whitespace.',
      );
    }
  });

  const { rateSettings } = snapshot;
  (
    [
      ['quoteAsOf', false],
      ['tdStart', true],
      ['tdEnd', true],
    ] as const
  ).forEach(([field, allowEmpty]) => {
    if (!isValidIsoDate(rateSettings[field], allowEmpty)) {
      add(
        'error',
        'INVALID_DATE',
        `/rateSettings/${field}`,
        `${field} must be a real YYYY-MM-DD date${allowEmpty ? ' or empty' : ''}.`,
      );
    }
  });
  if (
    rateSettings.tdStart &&
    rateSettings.tdEnd &&
    isValidIsoDate(rateSettings.tdStart) &&
    isValidIsoDate(rateSettings.tdEnd) &&
    rateSettings.tdStart > rateSettings.tdEnd
  ) {
    add(
      'error',
      'INVALID_DELIVERY_RANGE',
      '/rateSettings/tdEnd',
      'TD end date cannot be earlier than TD start date.',
    );
  }
  if (
    !Number.isInteger(rateSettings.baseYear) ||
    !finiteInRange(rateSettings.baseYear, 2000, 2200)
  ) {
    add(
      'error',
      'INVALID_BASE_YEAR',
      '/rateSettings/baseYear',
      'Base year must be an integer from 2000 to 2200.',
    );
  }
  if (
    !finiteInRange(rateSettings.defaultUplift, -100, COST_LIMITS.upliftPercent)
  ) {
    add(
      'error',
      'INVALID_DEFAULT_UPLIFT',
      '/rateSettings/defaultUplift',
      'Default uplift is outside the supported range.',
    );
  }
  if (
    rateSettings.annualUplifts.length !== 5 ||
    rateSettings.annualUplifts.some(
      (value) => !finiteInRange(value, -100, COST_LIMITS.upliftPercent),
    )
  ) {
    add(
      'error',
      'INVALID_ANNUAL_UPLIFTS',
      '/rateSettings/annualUplifts',
      'Exactly five finite annual uplift percentages are required.',
    );
  }

  const resourceIds = new Set<string>();
  const resourceCodes = new Set<string>();
  snapshot.resourceTypes.forEach((resource, index) => {
    const path = `/resourceTypes/${index}`;
    const normalizedId = resource.id.trim();
    const normalizedCode = resource.code.trim().toUpperCase();
    if (!normalizedId || resourceIds.has(normalizedId)) {
      add(
        'error',
        normalizedId
          ? 'DUPLICATE_RESOURCE_TYPE_ID'
          : 'RESOURCE_TYPE_ID_REQUIRED',
        `${path}/id`,
        normalizedId
          ? `Duplicate resource type ID: ${resource.id}.`
          : 'Resource type ID cannot be blank.',
      );
    }
    if (!normalizedCode || resourceCodes.has(normalizedCode)) {
      add(
        'error',
        normalizedCode
          ? 'DUPLICATE_RESOURCE_TYPE_CODE'
          : 'RESOURCE_TYPE_CODE_REQUIRED',
        `${path}/code`,
        normalizedCode
          ? `Duplicate resource type code: ${resource.code}.`
          : 'Resource type code cannot be blank.',
      );
    }
    if (normalizedCode === 'NON_RESOURCE') {
      add(
        'error',
        'RESERVED_RESOURCE_TYPE_CODE',
        `${path}/code`,
        'NON_RESOURCE is reserved for generated non-resource costs.',
      );
    }
    resourceIds.add(normalizedId);
    resourceCodes.add(normalizedCode);
    if (!resource.name.trim()) {
      add(
        'error',
        'RESOURCE_TYPE_NAME_REQUIRED',
        `${path}/name`,
        'Resource type name cannot be blank.',
      );
    }
    if (
      !finiteInRange(
        resource.mandaysPerMonth,
        Number.MIN_VALUE,
        COST_LIMITS.mandaysPerMonth,
      )
    ) {
      add(
        'error',
        'INVALID_MANDAYS_PER_MONTH',
        `${path}/mandaysPerMonth`,
        'MD/month must be greater than zero and within the supported range.',
      );
    }
    if (!finiteInRange(resource.mandayRate, 0, COST_LIMITS.money)) {
      add(
        'error',
        'INVALID_MANDAY_RATE',
        `${path}/mandayRate`,
        'Manday rate must be finite, non-negative, and within the supported range.',
      );
    }
    if (
      !finiteInRange(
        resource.hoursPerManday,
        Number.MIN_VALUE,
        COST_LIMITS.hoursPerManday,
      )
    ) {
      add(
        'error',
        'INVALID_HOURS_PER_MANDAY',
        `${path}/hoursPerManday`,
        'Hours/MD must be greater than zero and no more than 24.',
      );
    }
    if (resource.category === 'subcontract' && resource.hqTravel) {
      add(
        'error',
        'SUBCONTRACT_HQ_TRAVEL_NOT_ALLOWED',
        `${path}/hqTravel`,
        'Only internal resource types can enable HQ travel.',
      );
    }
    if (
      (resource.category === 'internal' &&
        (resource.pool === null || resource.level === null)) ||
      (resource.category === 'subcontract' &&
        (resource.pool !== null || resource.level !== null))
    ) {
      add(
        'error',
        'INVALID_RESOURCE_LEVEL',
        `${path}/level`,
        'Internal RE Types require a pool and level; subcontract RE Types require null.',
      );
    }
    if (resource.category === 'internal') {
      const expectedCode = `${resource.pool}-${resource.level}`;
      if (normalizedCode !== expectedCode) {
        add(
          'error',
          'RESOURCE_TYPE_CODE_MISMATCH',
          `${path}/code`,
          `Internal RE Type code must be ${expectedCode}.`,
        );
      }
      if (resource.hqTravel !== (resource.pool === 'HQ')) {
        add(
          'error',
          'INVALID_HQ_TRAVEL_FLAG',
          `${path}/hqTravel`,
          'HQ travel must be enabled only for HQ RE Types.',
        );
      }
    }
    if (!isValidIsoDate(resource.effectiveFrom)) {
      add(
        'error',
        'INVALID_RE_EFFECTIVE_FROM',
        `${path}/effectiveFrom`,
        'effectiveFrom must be a real YYYY-MM-DD date.',
      );
    }
    if (!isValidIsoDate(resource.effectiveTo, true)) {
      add(
        'error',
        'INVALID_RE_EFFECTIVE_TO',
        `${path}/effectiveTo`,
        'effectiveTo must be a real YYYY-MM-DD date or empty.',
      );
    }
    if (resource.effectiveTo && resource.effectiveFrom > resource.effectiveTo) {
      add(
        'error',
        'INVALID_RE_EFFECTIVE_RANGE',
        `${path}/effectiveTo`,
        'effectiveTo cannot be earlier than effectiveFrom.',
      );
    }
  });

  if (snapshot.costRows.length === 0) {
    add(
      'error',
      'COST_ROWS_REQUIRED',
      '/costRows',
      'At least one cost input row is required.',
    );
  }
  const seenLineIds = new Set<string>();
  const hasDeliveryYear = getY1Year(rateSettings) !== null;
  snapshot.costRows.forEach((row, rowIndex) => {
    const path = `/costRows/${rowIndex}`;
    const id = row.id.trim();
    if (!id) {
      add(
        'error',
        'COST_LINE_ID_REQUIRED',
        `${path}/id`,
        'Every cost line requires a stable ID.',
      );
    } else if (seenLineIds.has(id)) {
      add(
        'error',
        'DUPLICATE_COST_LINE_ID',
        `${path}/id`,
        `Duplicate cost line ID: ${row.id}.`,
      );
    }
    seenLineIds.add(id);
    if (!row.scope.trim()) {
      add(
        'error',
        'SCOPE_REQUIRED',
        `${path}/scope`,
        'Scope cannot be blank or whitespace.',
      );
    }
    if (!row.bu.trim()) {
      add(
        'error',
        'BU_REQUIRED',
        `${path}/bu`,
        'BU cannot be blank or whitespace.',
      );
    }
    if (row.years.length !== YEAR_BUCKETS.length) {
      add(
        'error',
        'INVALID_YEAR_BUCKET_COUNT',
        `${path}/years`,
        'Cost lines must contain exactly Y1 through Y5.',
      );
    }
    if (!finiteInRange(row.mdPerSite, 0, COST_LIMITS.mdPerSite)) {
      add(
        'error',
        'INVALID_MD_PER_SITE',
        `${path}/mdPerSite`,
        'MD/Site must be finite, non-negative, and within the supported range.',
      );
    }
    row.years.forEach((year, yearIndex) => {
      const expectedBucket = YEAR_BUCKETS[yearIndex];
      if (year.bucket !== expectedBucket) {
        add(
          'error',
          'INVALID_YEAR_BUCKET_ORDER',
          `${path}/years/${yearIndex}/bucket`,
          expectedBucket
            ? `Year bucket at position ${yearIndex + 1} must be ${expectedBucket}.`
            : 'Cost lines cannot contain buckets after Y5.',
        );
      }
      if (
        !Number.isInteger(year.sites) ||
        !finiteInRange(year.sites, 0, COST_LIMITS.sites)
      ) {
        add(
          'error',
          'INVALID_SITE_COUNT',
          `${path}/years/${yearIndex}/sites`,
          'Sites must be a non-negative integer within the supported range.',
        );
      }
      if (!finiteInRange(year.cost, 0, COST_LIMITS.money)) {
        add(
          'error',
          'INVALID_YEAR_COST',
          `${path}/years/${yearIndex}/cost`,
          'Annual cost must be finite, non-negative, and within the supported range.',
        );
      }
    });
    const hasAnnualAllocation = row.years.some(
      (year) => Number(year.sites || 0) > 0 || Number(year.cost || 0) > 0,
    );
    if (!hasDeliveryYear && hasAnnualAllocation) {
      add(
        'error',
        'DELIVERY_YEAR_REQUIRED',
        `${path}/years`,
        'Scheduled buckets require a TD delivery start year.',
      );
    }
    if (totalRowSites(row) > 0 && Number(row.mdPerSite) <= 0) {
      add(
        'error',
        'MD_PER_SITE_REQUIRED',
        `${path}/mdPerSite`,
        'Rows with Sites require MD/Site greater than zero.',
      );
    }
    const resource = snapshot.resourceTypes.find(
      (item) => item.id === row.reTypeId,
    );
    if (!resource) {
      add(
        'error',
        'RESOURCE_TYPE_NOT_FOUND',
        `${path}/reTypeId`,
        `Cost line ${row.id || rowIndex + 1} has no valid RE Type.`,
      );
    } else if (!resource.active) {
      add(
        'warning',
        'INACTIVE_RESOURCE_TYPE_USED',
        `${path}/reTypeId`,
        `Cost line ${row.id} uses inactive resource type ${resource.code}.`,
      );
    }
    if (resource) {
      const effectiveDate = rateSettings.tdStart || rateSettings.quoteAsOf;
      if (
        isValidIsoDate(effectiveDate) &&
        (effectiveDate < resource.effectiveFrom ||
          (resource.effectiveTo !== '' && effectiveDate > resource.effectiveTo))
      ) {
        add(
          'warning',
          'RESOURCE_TYPE_OUTSIDE_EFFECTIVE_PERIOD',
          `${path}/reTypeId`,
          `RE Type ${resource.code} is outside its effective period on ${effectiveDate}.`,
        );
      }
    }
    if (
      !Number.isFinite(totalRowSites(row)) ||
      !Number.isFinite(totalRowMandays(row)) ||
      !Number.isFinite(totalRowCost(row))
    ) {
      add(
        'error',
        'NON_FINITE_DERIVED_VALUE',
        path,
        'A calculated row total is not finite.',
      );
    }
    if (
      totalRowCost(row) > COST_LIMITS.money ||
      totalRowMandays(row) > COST_LIMITS.sites * COST_LIMITS.mdPerSite
    ) {
      add(
        'error',
        'DERIVED_VALUE_OUT_OF_RANGE',
        path,
        'A calculated row total exceeds the supported range.',
      );
    }
  });

  const travelNumeric: Array<
    [keyof CostExportSnapshot['travelSettings'], number]
  > = [
    ['monthlyAllowance', snapshot.travelSettings.monthlyAllowance],
    ['airfarePerTrip', snapshot.travelSettings.airfarePerTrip],
    ['trips', snapshot.travelSettings.trips],
  ];
  travelNumeric.forEach(([field, value]) => {
    const maximum = field === 'trips' ? COST_LIMITS.trips : COST_LIMITS.money;
    if (
      !finiteInRange(value, 0, maximum) ||
      (field === 'trips' && !Number.isInteger(value))
    ) {
      add(
        'error',
        'INVALID_TRAVEL_INPUT',
        `/travelSettings/${field}`,
        `${field} is outside the supported range.`,
      );
    }
  });
  Object.entries(snapshot.manualCosts).forEach(([field, value]) => {
    if (!finiteInRange(value, 0, COST_LIMITS.money)) {
      add(
        'error',
        'INVALID_MANUAL_COST',
        `/manualCosts/${field}`,
        `${field} must be a finite, non-negative SGD amount within the supported range.`,
      );
    }
  });

  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const statement = getCostStatementValues(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
  );
  const derivedNumbers = [
    travel.hqMandays,
    travel.months,
    travel.allowanceCost,
    travel.airfareCost,
    travel.totalCost,
    ...Object.values(statement),
  ];
  if (derivedNumbers.some((value) => !Number.isFinite(value))) {
    add(
      'error',
      'NON_FINITE_CALCULATION_RESULT',
      '/',
      'Calculated output contains a non-finite number.',
    );
  }
  if (
    Object.values(statement).some(
      (value) => value < 0 || value > COST_LIMITS.money,
    ) ||
    travel.totalCost > COST_LIMITS.money
  ) {
    add(
      'error',
      'CALCULATION_RESULT_OUT_OF_RANGE',
      '/',
      'Calculated output exceeds the supported SGD amount range.',
    );
  }
  if (statement.sales + snapshot.manualCosts.riskContingency <= 0) {
    add(
      'error',
      'NO_COST_DATA',
      '/',
      'At least one cost amount is required before export.',
    );
  }

  const manualSalesCost =
    snapshot.manualCosts.localPurchasedEquipment +
    snapshot.manualCosts.inlandLogistics +
    snapshot.manualCosts.countryWarehousing +
    snapshot.manualCosts.nonInHouseLabour +
    snapshot.manualCosts.settlement +
    snapshot.manualCosts.carFee +
    snapshot.manualCosts.otherService;
  if (manualSalesCost + travel.totalCost > 0) {
    add(
      'warning',
      'UNALLOCATED_PROJECT_COST',
      '/manualCosts',
      'HQ travel and manual statement costs have no Scope or BU allocation and export as UNALLOCATED.',
    );
  }
  if (
    snapshot.manualCosts.nonInHouseLabour > 0 &&
    snapshot.costRows.some(
      (row) =>
        snapshot.resourceTypes.find((item) => item.id === row.reTypeId)
          ?.category === 'subcontract' && totalRowCost(row) > 0,
    )
  ) {
    add(
      'warning',
      'POTENTIAL_EXTERNAL_LABOUR_DOUBLE_COUNT',
      '/manualCosts/nonInHouseLabour',
      'Non-in-house labour and subcontract cost both contain values; confirm that scopes do not overlap.',
    );
  }
  return issues;
};
