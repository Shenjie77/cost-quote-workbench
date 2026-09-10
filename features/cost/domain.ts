/**
 * Cost-domain types and calculations shared by the web UI, Excel exporter,
 * and local CLI. Keeping the arithmetic here prevents the three interfaces
 * from drifting as the platform grows.
 *
 * Business invariants:
 * - Y1 is the first delivery year and can be the current calendar year.
 * - Mandays use recorded effort or Sites × MD/Site, according to input mode.
 * - HQ travel is calculated only for internal resource types marked HQ.
 * - Cost-statement parent rows are roll-ups; only leaf rows can be entered.
 */

import {
  calculateSubcontractCost,
  subcontractCostDetails,
  type SubcontractCost,
} from './subcontract-domain.ts';
import {
  isPersonnelAllowanceApplied,
  type AllowancePool,
} from './personnel-allowance.ts';

// Preserve the public domain API while isolating allowance compatibility rules.
export {
  PERSONNEL_ALLOWANCE_POOLS,
  getAllowancePools,
  getAllowanceResourceTypeIds,
  isPersonnelAllowanceApplied,
  validatePersonnelAllowanceSelection,
  type AllowancePool,
} from './personnel-allowance.ts';

export const YEAR_BUCKETS = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'] as const;

/**
 * All SGD amounts round upward at two decimal places. Near-cent float noise is
 * normalized first so 100.00000000001 stays 100.00, while 18848.282 becomes
 * 18848.29.
 */
export const roundMoney = (value: number) => {
  const number = Number(value);
  const scaled = number * 100;
  const nearestCent = Math.round(scaled);
  const tolerance = Math.max(1e-7, Number.EPSILON * Math.abs(scaled));
  const rounded =
    Math.abs(scaled - nearestCent) < tolerance
      ? nearestCent / 100
      : Math.ceil(scaled) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Operational quantities retain four decimals without leaking float noise. */
export const roundQuantity = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;

export type YearBucket = (typeof YEAR_BUCKETS)[number];

export type YearAllocation = {
  bucket: YearBucket;
  sites: number;
  cost: number;
  mandays?: number;
};

export type CostInputRow = {
  /** Optional personnel grouping label, independent of Scope. Empty/absent means Unassigned Group. */
  groupName?: string;
  inputMode?: 'sites' | 'mandays';
  source?: {
    importedValues?: string;
    fileName: string;
    sha256: string;
    sheet: string;
    row: number;
    mappingKey: string;
    role: 'TD' | 'PM';
    importedAt: string;
  };
  id: string;
  scope: string;
  bu: string;
  reTypeId: string;
  mdPerSite: number;
  years: YearAllocation[];
};

export type RateSettings = {
  /** Authoritative pool selection; [] explicitly disables the 3% allowance. */
  allowancePools?: AllowancePool[];
  /** Historical per-RE selection, used only when allowancePools is absent. */
  allowanceResourceTypeIds?: string[];
  /** Legacy fallback only when both explicit selections are absent. */
  localArpAllowanceEnabled?: boolean;
  quoteAsOf: string;
  tdStart: string;
  tdEnd: string;
  baseYear: number;
  defaultUplift: number;
  annualUplifts: number[];
};

export type ResourceType = {
  id: string;
  code: string;
  name: string;
  category: 'internal' | 'subcontract';
  /** Personnel family and level are part of RE Type, not a second master. */
  /** Personnel pools classify rates; the version explicitly selects allowance and HQ travel. */
  pool: 'LOCAL' | 'HQ' | 'ARP' | 'OTHER' | null;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | null;
  /** Governed base-year SGD rate for one manday. */
  mandayRate: number;
  /** Unit conversions maintained with the rate definition. */
  mandaysPerMonth: number;
  hoursPerManday: number;
  hqTravel: boolean;
  effectiveFrom: string;
  effectiveTo: string;
  active: boolean;
};

export type TravelSettings = {
  /** New versions opt in; absent retains the historical resource-flag calculation. */
  enabled?: boolean;
  monthlyAllowance: number;
  airfarePerTrip: number;
  trips: number;
};

export type ManualCostInputs = {
  localPurchasedEquipment: number;
  inlandLogistics: number;
  countryWarehousing: number;
  nonInHouseLabour: number;
  settlement: number;
  carFee: number;
  otherService: number;
  /** Absent preserves a saved manual amount; present applies this fraction to 2.3.1. */
  otherServiceRate?: number;
  riskContingency: number;
};

/**
 * User-controlled lifecycle for a cost snapshot. Creating another version
 * never changes this value on an existing snapshot.
 */
export type CostVersionState = 'Draft' | 'Suspended' | 'Confirmed';

/**
 * Global Master Data supplies future projects. Each cost version captures
 * its own resource definitions, MD rates and conversion factors; refreshing a
 * catalogue does not change a version until Apply Master Rates is selected.
 */
export type CostVersionSnapshot = {
  /** Revision explicitly used when capturing global personnel rates. */
  masterDataRevision?: number;
  code: string;
  state: CostVersionState;
  createdAt: string;
  sourceVersion: string | null;
  costRows: CostInputRow[];
  rateSettings: RateSettings;
  travelSettings: TravelSettings;
  travelRows: import('@/features/cost/additional-travel-domain').TravelCostRow[];
  travelUplift: number;
  manualCosts: ManualCostInputs;
  /** Cost-affecting rate/conversion snapshot. Optional only for legacy imports. */
  resourceTypes?: ResourceType[];
  /** One-time correction warning for legacy versions without captured rates. */
  calculationNote?: string;
  subcontractCost?: SubcontractCost;
};

export type CostStatementValues = {
  inHouseLabour: number;
  subcontract: number;
  travel: number;
  logistics: number;
  period: number;
  labour: number;
  otherService: number;
  service: number;
  sales: number;
  totalWithRisk: number;
};

export type CostStatementRow = {
  code: string;
  en: string;
  zh: string;
  level: number;
  mode: 'section' | 'subtotal' | 'auto' | 'manual' | 'grand-total';
  amount: number;
  source: string;
  manualKey?: keyof ManualCostInputs;
};

export type CostDimension = 'scope' | 'bu' | 'resourceType';

export type CostDimensionSummary = {
  key: string;
  label: string;
  sites: number;
  mandays: number;
  cost: number;
  /** Ratio from 0 to 1; format as a percentage only at the presentation edge. */
  shareRatio: number;
  allocationStatus: 'ALLOCATED' | 'UNALLOCATED';
  resourceCategory?: ResourceType['category'] | 'unmapped';
};

/** Returns mandays for one annual bucket using the TD allocation rule. */
export const yearRowMandays = (row: CostInputRow, yearIndex: number) =>
  roundQuantity(
    row.inputMode === 'mandays'
      ? Number(row.years[yearIndex]?.mandays || 0)
      : Number(row.mdPerSite || 0) * Number(row.years[yearIndex]?.sites || 0),
  );

/** Sums all Y1–Y5 site allocations for one cost row. */
export const totalRowSites = (row: CostInputRow) =>
  roundQuantity(
    row.inputMode === 'mandays'
      ? 0
      : row.years.reduce((sum, year) => sum + Number(year.sites || 0), 0),
  );

/** Sums the row's direct or site-derived annual mandays across Y1–Y5. */
export const totalRowMandays = (row: CostInputRow) =>
  roundQuantity(
    row.years.reduce(
      (sum, _year, yearIndex) => sum + yearRowMandays(row, yearIndex),
      0,
    ),
  );

/**
 * Sums normalized annual cost values for one cost row. Each source amount is
 * rounded first so the displayed Y1–Y5 cells always reconcile to the row total.
 */
export const totalRowCost = (row: CostInputRow) =>
  roundMoney(
    row.years.reduce(
      (sum, year) => sum + roundMoney(Number(year.cost || 0)),
      0,
    ),
  );

/**
 * Resolves the real calendar year represented by Y1. A missing delivery start
 * returns null and blocks annual cost allocation until TD dates are recorded.
 */
export const getY1Year = (settings: RateSettings) => {
  const year = Number(settings.tdStart.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
};

/** Returns the Y1–Y5 calendar-year labels derived from the TD start date. */
export const getActualYears = (settings: RateSettings) =>
  Array.from({ length: 5 }, (_, index) => {
    const y1Year = getY1Year(settings);
    return y1Year === null ? null : y1Year + index;
  });

/**
 * Calculates cumulative labour-rate factors. Y1 has no uplift when delivery
 * starts in the base year; future years compound each configured uplift.
 */
export const getLabourRateFactors = (settings: RateSettings) => {
  const y1Year = getY1Year(settings);
  if (y1Year === null) return [1, 1, 1, 1, 1];
  let factor = 1;
  return Array.from({ length: 5 }, (_, index) => {
    const uplift =
      index === 0 && y1Year === settings.baseYear
        ? 0
        : Number(settings.annualUplifts[index] ?? settings.defaultUplift ?? 0);
    const periods = index === 0 ? Math.max(0, y1Year - settings.baseYear) : 1;
    factor *= Math.pow(1 + uplift / 100, periods);
    return factor;
  });
};

/** Converts a governed MD rate to the equivalent MM and Hour rates. */
export const getResourceRateConversions = (resourceType: ResourceType) => ({
  perManday: roundMoney(resourceType.mandayRate),
  perMonth: roundMoney(
    resourceType.mandayRate * Math.max(resourceType.mandaysPerMonth, 0),
  ),
  perHour: roundMoney(
    resourceType.hoursPerManday > 0
      ? resourceType.mandayRate / resourceType.hoursPerManday
      : 0,
  ),
});

/** Missing flags retain historical HQ travel; explicit false disables all travel charges. */
export const isHQTravelEnabled = (settings: TravelSettings) =>
  settings.enabled !== false;

/** Old versions retain saved flags; explicitly configured versions use the HQ pool. */
export const isHQTravelResource = (
  resource: ResourceType,
  settings: TravelSettings,
) =>
  resource.category === 'internal' &&
  (settings.enabled === undefined ? resource.hqTravel : resource.pool === 'HQ');

/** Rebuild annual internal cost from effort/rate, with 3% only for selected RE Types. */
export const calculatedYearCost = (
  row: CostInputRow,
  yearIndex: number,
  resourceTypes: ResourceType[],
  rateSettings: RateSettings,
) => {
  const resourceType = resourceTypes.find((item) => item.id === row.reTypeId);
  if (!resourceType || resourceType.category !== 'internal') {
    // Unknown and packaged resource rows retain their saved manual amounts.
    return roundMoney(Number(row.years[yearIndex]?.cost || 0));
  }
  const factor = getLabourRateFactors(rateSettings)[yearIndex] ?? 1;
  const allowanceFactor = isPersonnelAllowanceApplied(
    resourceType,
    rateSettings,
  )
    ? 1.03
    : 1;
  return roundMoney(
    yearRowMandays(row, yearIndex) *
      resourceType.mandayRate *
      factor *
      allowanceFactor,
  );
};

/**
 * Rebuilds derived labour amounts whenever sites, rates or delivery assumptions
 * change. Packaged subcontract amounts remain user inputs. All consumers use
 * this function rather than relying on a grid's manual Recalculate action.
 */
export const recalculateCostRows = (
  rows: CostInputRow[],
  resourceTypes: ResourceType[],
  rateSettings: RateSettings,
): CostInputRow[] =>
  rows.map((row) => ({
    ...row,
    years: row.years.map((year, index) => ({
      ...year,
      cost: calculatedYearCost(row, index, resourceTypes, rateSettings),
    })),
  }));

/**
 * Calculates travel only for internal HQ resources. Monthly allowance uses
 * actual HQ mandays divided by the resource type's MD/month; airfare uses the
 * user-entered trip count and is never inferred from mandays.
 */
export const getHQTravelSummary = (
  rows: CostInputRow[],
  resourceTypes: ResourceType[],
  settings: TravelSettings,
) => {
  // Eligibility remains visible when travel is disabled so effort summaries stay useful.
  const hqRows = rows.filter((row) =>
    resourceTypes.some(
      (resourceType) =>
        resourceType.id === row.reTypeId &&
        isHQTravelResource(resourceType, settings),
    ),
  );
  const hqMandays = roundQuantity(
    hqRows.reduce((sum, row) => sum + totalRowMandays(row), 0),
  );
  const yearMandays = YEAR_BUCKETS.map((_, yearIndex) =>
    roundQuantity(
      hqRows.reduce((sum, row) => sum + yearRowMandays(row, yearIndex), 0),
    ),
  );
  // Legacy rates without a conversion use 21.75 MD/month; zero follows the same fallback.
  const months = roundQuantity(
    hqRows.reduce((sum, row) => {
      const resourceType = resourceTypes.find(
        (item) => item.id === row.reTypeId,
      );
      const mandaysPerMonth = Number(resourceType?.mandaysPerMonth || 21.75);
      return sum + totalRowMandays(row) / Math.max(mandaysPerMonth, 0.01);
    }, 0),
  );
  const enabled = isHQTravelEnabled(settings);
  const required = enabled && hqMandays > 0;
  // Round each entered unit price before multiplication to reconcile displayed prices.
  const allowanceCost = roundMoney(
    required ? months * roundMoney(settings.monthlyAllowance) : 0,
  );
  const airfareCost = roundMoney(
    required ? settings.trips * roundMoney(settings.airfarePerTrip) : 0,
  );
  return {
    hqRows,
    hqMandays,
    yearMandays,
    months,
    enabled,
    required,
    allowanceCost,
    airfareCost,
    totalCost: roundMoney(allowanceCost + airfareCost),
  };
};

/**
 * Sums already-rounded row costs for one captured resource category. Lookup
 * deliberately uses the first matching RE ID, including in legacy rate cards.
 * The caller owns the final roll-up rounding so BOQ addition keeps its boundary.
 */
function sumResourceCategoryCosts(
  rows: CostInputRow[],
  resourceTypes: ResourceType[],
  category: ResourceType['category'],
): number {
  return rows
    .filter(
      (row) =>
        resourceTypes.find((resource) => resource.id === row.reTypeId)
          ?.category === category,
    )
    .reduce((sum, row) => sum + totalRowCost(row), 0);
}

/**
 * Maps cost lines into the company statement. `subcontract` resource rows are
 * treated as packaged/partner cost. Time-and-material non-house labour stays a
 * separate manual leaf until the data model can identify the commercial basis.
 */
export const getCostStatementValues = (
  rows: CostInputRow[],
  resourceTypes: ResourceType[],
  travelCost: number,
  manual: ManualCostInputs,
  subcontractCost?: SubcontractCost,
): CostStatementValues => {
  // Normalize every monetary leaf before roll-up. This makes the arithmetic
  // agree with the two-decimal values visible in the statement and workbook.
  const equipment = roundMoney(manual.localPurchasedEquipment);
  const inlandLogistics = roundMoney(manual.inlandLogistics);
  const countryWarehousing = roundMoney(manual.countryWarehousing);
  const nonInHouseLabour = roundMoney(manual.nonInHouseLabour);
  const settlement = roundMoney(manual.settlement);
  const carFee = roundMoney(manual.carFee);
  const riskContingency = roundMoney(manual.riskContingency);
  const normalizedTravelCost = roundMoney(travelCost);
  const inHouseLabour = roundMoney(
    sumResourceCategoryCosts(rows, resourceTypes, 'internal'),
  );
  const subcontract = roundMoney(
    sumResourceCategoryCosts(rows, resourceTypes, 'subcontract') +
      calculateSubcontractCost(subcontractCost).total,
  );
  // Follow statement hierarchy in order; each subtotal retains its own cent rounding.
  const logistics = roundMoney(inlandLogistics + countryWarehousing);
  const period = logistics;
  const labour = roundMoney(
    inHouseLabour + nonInHouseLabour + normalizedTravelCost,
  );
  const otherServiceCost = getOtherServiceCost(labour, manual);
  const otherService = roundMoney(carFee + otherServiceCost);
  const service = roundMoney(labour + subcontract + settlement + otherService);
  const sales = roundMoney(equipment + period + service);
  return {
    inHouseLabour,
    subcontract,
    travel: normalizedTravelCost,
    logistics,
    period,
    labour,
    otherService,
    service,
    sales,
    totalWithRisk: roundMoney(sales + riskContingency),
  };
};

/** Applies a configured labour fraction, or retains the saved manual amount when absent. */
export const getOtherServiceCost = (labour: number, manual: ManualCostInputs) =>
  roundMoney(
    manual.otherServiceRate === undefined
      ? manual.otherService
      : labour * manual.otherServiceRate,
  );

/** Saves a nonnegative manual override and removes the percentage to prevent recalculation. */
export const overrideOtherServiceCost = (
  manual: ManualCostInputs,
  amount: number,
): ManualCostInputs => {
  const updated = {
    ...manual,
    otherService: Math.max(0, Number.isFinite(amount) ? amount : 0),
  };
  delete updated.otherServiceRate;
  return updated;
};

/**
 * Builds the canonical statement row order used by both the UI and Excel.
 * Parent rows are deliberately calculated here and are never editable.
 */
export const buildCostStatementRows = (
  rows: CostInputRow[],
  resourceTypes: ResourceType[],
  travelCost: number,
  manualCosts: ManualCostInputs,
  subcontractCost?: SubcontractCost,
): CostStatementRow[] => {
  const values = getCostStatementValues(
    rows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
  );
  return [
    {
      code: '2',
      en: 'Sales Cost',
      zh: '销售成本',
      level: 0,
      mode: 'section',
      amount: values.sales,
      source: 'Calculated subtotal / 自动小计',
    },
    {
      code: '2.1.2',
      en: 'Local Purchased Equipment Cost',
      zh: '本地采购设备成本',
      level: 1,
      mode: 'manual',
      amount: roundMoney(manualCosts.localPurchasedEquipment),
      source: 'Manual input / 手动录入',
      manualKey: 'localPurchasedEquipment',
    },
    {
      code: '2.2',
      en: 'Period Cost',
      zh: '期间成本',
      level: 0,
      mode: 'subtotal',
      amount: values.period,
      source: 'Calculated subtotal / 自动小计',
    },
    {
      code: '2.2.1',
      en: 'Logistics Cost',
      zh: '供应物流成本',
      level: 1,
      mode: 'subtotal',
      amount: values.logistics,
      source: 'Calculated subtotal / 自动小计',
    },
    {
      code: '2.2.1.2',
      en: 'Inland Logistics Cost',
      zh: '内陆物流成本',
      level: 2,
      mode: 'manual',
      amount: roundMoney(manualCosts.inlandLogistics),
      source: 'Manual input / 手动录入',
      manualKey: 'inlandLogistics',
    },
    {
      code: '2.2.1.3',
      en: 'Country Warehousing Expense',
      zh: '国家仓储费',
      level: 2,
      mode: 'manual',
      amount: roundMoney(manualCosts.countryWarehousing),
      source: 'Manual input / 手动录入',
      manualKey: 'countryWarehousing',
    },
    {
      code: '2.3',
      en: 'Service Cost',
      zh: '服务成本',
      level: 0,
      mode: 'subtotal',
      amount: values.service,
      source: 'Calculated subtotal / 自动小计',
    },
    {
      code: '2.3.1',
      en: 'Labour Cost',
      zh: '人力成本',
      level: 1,
      mode: 'subtotal',
      amount: values.labour,
      source: 'Calculated subtotal / 自动小计',
    },
    {
      code: '2.3.1.1',
      en: 'In-house Labour Cost',
      zh: '自有人力成本',
      level: 2,
      mode: 'auto',
      amount: values.inHouseLabour,
      source: 'Cost Input · Internal RE / 成本表自有资源',
    },
    {
      code: '2.3.1.2',
      en: 'Non-in-house Labour Cost',
      zh: '外包人力成本',
      level: 2,
      mode: 'manual',
      amount: roundMoney(manualCosts.nonInHouseLabour),
      source: 'Manual input / 手动录入',
      manualKey: 'nonInHouseLabour',
    },
    {
      code: '2.3.1.3',
      en: 'Travelling Expense',
      zh: '差旅费',
      level: 2,
      mode: 'auto',
      amount: values.travel,
      source: 'HQ Travel / HQ 差旅自动计算',
    },
    {
      code: '2.3.2',
      en: 'Subcontract Cost',
      zh: '合作成本',
      level: 1,
      mode: 'auto',
      amount: values.subcontract,
      source: subcontractCost
        ? 'Subcon BOQ + preserved legacy cost / 分包明细及历史成本'
        : 'Legacy subcontract cost / 历史分包成本',
    },
    {
      code: '2.3.3',
      en: 'Settlement Cost',
      zh: '结算成本',
      level: 1,
      mode: 'manual',
      amount: roundMoney(manualCosts.settlement),
      source: 'Manual input / 手动录入',
      manualKey: 'settlement',
    },
    {
      code: '2.3.4',
      en: 'Other Service Costs (EHS)',
      zh: '其他服务成本 EHS',
      level: 1,
      mode: 'subtotal',
      amount: values.otherService,
      source: 'Calculated subtotal / 自动小计',
    },
    {
      code: '2.3.4.1',
      en: 'Car Fee',
      zh: '汽车费',
      level: 2,
      mode: 'manual',
      amount: roundMoney(manualCosts.carFee),
      source: 'Manual input / 手动录入',
      manualKey: 'carFee',
    },
    {
      code: '2.3.4.2',
      en: 'Other Service Costs',
      zh: '其他服务成本_其他',
      level: 2,
      mode: 'manual',
      amount: getOtherServiceCost(values.labour, manualCosts),
      source:
        manualCosts.otherServiceRate === undefined
          ? 'Manual input / 手动录入'
          : `2.3.1 × ${manualCosts.otherServiceRate * 100}% / 人力成本比例，可手动修改`,
      manualKey: 'otherService',
    },
    {
      code: '15',
      en: 'Risk Contingency',
      zh: '风险准备金',
      level: 0,
      mode: 'manual',
      amount: roundMoney(manualCosts.riskContingency),
      source: 'Manual input / 手动录入',
      manualKey: 'riskContingency',
    },
    {
      code: '',
      en: 'Total Cost with Risk',
      zh: '含风险总成本（2. 销售成本 + 15. 风险准备金）',
      level: 0,
      mode: 'grand-total',
      amount: values.totalWithRisk,
      source: 'Calculated total / 自动合计',
    },
  ];
};

type CostDimensionTotals = Omit<CostDimensionSummary, 'shareRatio'>;

const SUBCONTRACT_SUMMARY_KEY = '__SUBCONTRACT__';
const SUBCONTRACT_SUMMARY_LABEL = '2.3.2 · Subcontract Cost';

/** Resolves business grouping text while preserving stable resource IDs as keys. */
function getCostDimensionKey(
  scope: string,
  bu: string,
  dimension: CostDimension,
  resourceKey: string,
): string {
  if (dimension === 'scope') return scope.trim() || 'UNSPECIFIED';
  if (dimension === 'bu') return bu.trim() || 'UNSPECIFIED';
  return resourceKey;
}

/** Gives each RE group its existing report label, including legacy subcontract and unmapped rows. */
function getResourceSummaryLabel(
  resourceType: ResourceType | undefined,
): string {
  if (resourceType?.category === 'subcontract')
    return SUBCONTRACT_SUMMARY_LABEL;
  return resourceType
    ? `${resourceType.code} · ${resourceType.name}`
    : 'UNMAPPED · Unmapped Resource Type';
}

/** Reuses group metadata from its first contribution, or initializes an uncounted group. */
function getCostDimensionGroup(
  groups: Map<string, CostDimensionTotals>,
  key: string,
  label: string,
  resourceCategory: CostDimensionTotals['resourceCategory'],
): CostDimensionTotals {
  return (
    groups.get(key) ?? {
      key,
      label,
      sites: 0,
      mandays: 0,
      cost: 0,
      allocationStatus: 'ALLOCATED',
      resourceCategory,
    }
  );
}

/** Calculates shares against the rounded total, then orders largest cost first with label ties. */
function finalizeCostDimensionSummary(
  items: CostDimensionTotals[],
): CostDimensionSummary[] {
  const totalCost = roundMoney(items.reduce((sum, item) => sum + item.cost, 0));
  return items
    .map((item) => ({
      ...item,
      shareRatio: totalCost > 0 ? item.cost / totalCost : 0,
    }))
    .sort(
      (left, right) =>
        right.cost - left.cost || left.label.localeCompare(right.label),
    );
}

/**
 * Groups cost-input rows for Scope, BU, or resource-type reporting. Resource
 * types use their stable master-data ID as the key so duplicate display names
 * cannot be merged silently.
 */
export const buildCostDimensionSummary = (
  rows: CostInputRow[],
  dimension: CostDimension,
  resourceTypes: ResourceType[],
  subcontractCost?: SubcontractCost,
): CostDimensionSummary[] => {
  const groups = new Map<string, CostDimensionTotals>();

  // Accumulate in input order and round each contribution exactly as the displayed rows do.
  for (const row of rows) {
    const resourceType = resourceTypes.find((item) => item.id === row.reTypeId);
    const resourceKey =
      resourceType?.category === 'subcontract'
        ? SUBCONTRACT_SUMMARY_KEY
        : resourceType?.id || 'UNMAPPED';
    const key = getCostDimensionKey(row.scope, row.bu, dimension, resourceKey);
    const current = getCostDimensionGroup(
      groups,
      key,
      dimension === 'resourceType'
        ? getResourceSummaryLabel(resourceType)
        : key,
      resourceType?.category ?? 'unmapped',
    );
    current.sites = roundQuantity(current.sites + totalRowSites(row));
    current.mandays = roundQuantity(current.mandays + totalRowMandays(row));
    current.cost = roundMoney(current.cost + totalRowCost(row));
    groups.set(key, current);
  }

  // BOQ leaves add money to the same business groups; their quantities are not labour effort.
  for (const line of subcontractCostDetails(subcontractCost)) {
    const key = getCostDimensionKey(
      line.scope,
      line.bu,
      dimension,
      SUBCONTRACT_SUMMARY_KEY,
    );
    const current = getCostDimensionGroup(
      groups,
      key,
      dimension === 'resourceType' ? SUBCONTRACT_SUMMARY_LABEL : key,
      'subcontract',
    );
    current.cost = roundMoney(current.cost + line.total);
    groups.set(key, current);
  }
  return finalizeCostDimensionSummary([...groups.values()]);
};

/** The non-overlapping statement accounts added to each reporting dimension. */
const SUMMARY_STATEMENT_CODES = [
  '2.1.2',
  '2.2.1',
  '2.3.1.2',
  '2.3.1.3',
  '2.3.3',
  '2.3.4',
  '15',
] as const;

/** Presentation can resolve bilingual labels without adding fields to CLI summaries. */
export const getCostSummaryStatementCode = (key: string) =>
  key === SUBCONTRACT_SUMMARY_KEY
    ? '2.3.2'
    : key.startsWith('__STATEMENT__:')
      ? key.slice('__STATEMENT__:'.length)
      : undefined;

/** Named statement subtotals preserve their children exactly once; risk is opt-in. */
export const buildReconciledCostDimensionSummary = (
  rows: CostInputRow[],
  dimension: CostDimension,
  resourceTypes: ResourceType[],
  travelCost: number,
  manualCosts: ManualCostInputs,
  subcontractCost?: SubcontractCost,
  options: { includeRisk?: boolean } = {},
): CostDimensionSummary[] => {
  const items = buildCostDimensionSummary(
    rows,
    dimension,
    resourceTypes,
    subcontractCost,
  ).map(({ shareRatio: _shareRatio, ...item }) => item);
  const statementRows = buildCostStatementRows(
    rows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
  );
  // Add only non-overlapping positive statement accounts; risk remains explicitly opt-in.
  for (const code of SUMMARY_STATEMENT_CODES) {
    if (code === '15' && !options.includeRisk) continue;
    const statement = statementRows.find((row) => row.code === code)!;
    if (statement.amount <= 0) continue;
    items.push({
      key: `__STATEMENT__:${code}`,
      label: `${code} · ${statement.en}`,
      sites: 0,
      mandays: 0,
      cost: statement.amount,
      allocationStatus: 'UNALLOCATED',
      resourceCategory: 'unmapped',
    });
  }
  return finalizeCostDimensionSummary(items);
};

/** Subcon-only business scopes, including preserved legacy packages and BOQ leaves. */
export const buildSubcontractScopeSummary = (
  rows: CostInputRow[],
  resourceTypes: ResourceType[],
  subcontractCost?: SubcontractCost,
): CostDimensionSummary[] =>
  buildCostDimensionSummary(
    rows.filter(
      (row) =>
        resourceTypes.find((resource) => resource.id === row.reTypeId)
          ?.category === 'subcontract',
    ),
    'scope',
    resourceTypes,
    subcontractCost,
  );
