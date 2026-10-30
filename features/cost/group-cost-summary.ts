/** Reporting-only allocation. Saved personnel costs and statement account boundaries stay intact. */
import {
  YEAR_BUCKETS,
  getHQTravelSummary,
  buildCostStatementRows,
  roundMoney,
  roundQuantity,
  totalRowCost,
  totalRowMandays,
  yearRowMandays,
  type CostInputRow,
  type ResourceType,
  type TravelSettings,
  type ManualCostInputs,
} from './domain.ts';
import {
  subcontractCostDetails,
  type SubcontractCost,
} from './subcontract-domain.ts';
import {
  groupPersonnelRows,
  UNASSIGNED_PERSONNEL_GROUP,
} from './personnel-table-layout.ts';
import { isLegacySubcontractRow } from './personnel-cost-rows.ts';

/** Largest remainder distributes an already-rounded account without creating extra cents. */
function allocateCents(amount: number, weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!total || !amount) return weights.map(() => 0);
  const cents = Math.round(amount * 100);
  const exact = weights.map((weight) => (cents * weight) / total);
  const allocated = exact.map(Math.floor);
  const order = exact
    .map((value, index) => ({ index, fraction: value - allocated[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const remainder = cents - allocated.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remainder; index++)
    allocated[order[index].index]++;
  return allocated.map((value) => value / 100);
}

export function allocateHQTravel(
  rows: CostInputRow[],
  resources: ResourceType[],
  settings: TravelSettings,
) {
  const travel = getHQTravelSummary(rows, resources, settings);
  // Stable IDs make cent allocation independent of user-driven row/group reordering.
  const eligible = [...travel.hqRows].sort((a, b) => a.id.localeCompare(b.id));
  const entries = eligible.flatMap((row) => {
    const resource = resources.find((item) => item.id === row.reTypeId);
    const mdPerMonth = Math.max(
      Number(resource?.mandaysPerMonth || 21.75),
      0.01,
    );
    return YEAR_BUCKETS.map((_, index) => ({
      id: row.id,
      index,
      md: yearRowMandays(row, index),
      months: yearRowMandays(row, index) / mdPerMonth,
    }));
  });
  const allowances = allocateCents(
    travel.allowanceCost,
    entries.map((item) => item.months),
  );
  const airfare = allocateCents(
    travel.airfareCost,
    entries.map((item) => item.md),
  );
  const byRow = new Map(rows.map((row) => [row.id, YEAR_BUCKETS.map(() => 0)]));
  entries.forEach((item, index) => {
    byRow.get(item.id)![item.index] = roundMoney(
      allowances[index] + airfare[index],
    );
  });
  return byRow;
}

/** Display a loaded row with HQ travel included, never write these values back to inputs. */
export function costRowsIncludingHQTravel(
  rows: CostInputRow[],
  resources: ResourceType[],
  settings: TravelSettings,
) {
  const allocation = allocateHQTravel(rows, resources, settings);
  return rows.map((row) => ({
    ...row,
    years: row.years.map((year, index) => ({
      ...year,
      cost: roundMoney(
        Number(year.cost) + (allocation.get(row.id)?.[index] ?? 0),
      ),
    })),
  }));
}

export type GroupCostSummaryRow = {
  key: string;
  label: string;
  category?: string;
  groupName?: string;
  kind: 'Group' | 'Subcontract' | 'Project';
  accountCode?: string;
  /** Statement leaf amounts retained when the Group row displays a parent account. */
  statementAmounts?: Record<string, number>;
  riskWeight?: number;
  mandays: number;
  personnel: number;
  travel: number;
  subcontract: number;
  ehs: number;
  risk: number;
  other: number;
  total: number;
  share: number;
};
export const GROUP_COST_NOTE =
  'Each Category retains its groups and project costs. EHS includes Car Fee and Other Service Costs, following Cost Statement 2.3.4. Risk defaults to pre-risk Category cost proportions; saved percentages override this. Category totals reconcile to Cost Statement.';

export const GROUP_COST_FIELDS = [
  'mandays',
  'personnel',
  'travel',
  'subcontract',
  'ehs',
  'risk',
  'other',
  'total',
  'share',
] as const;
export type GroupCostMeasures = Pick<
  GroupCostSummaryRow,
  (typeof GROUP_COST_FIELDS)[number]
>;
export type GroupCostSection = {
  key: string;
  kind: 'Category' | 'Project';
  label: string;
  category?: string;
  items: GroupCostSummaryRow[];
  totals: GroupCostMeasures;
};

function sumGroupCostMeasures(
  items: GroupCostSummaryRow[],
  grandTotal: number,
): GroupCostMeasures {
  const totals = Object.fromEntries(
    GROUP_COST_FIELDS.map((field) => [
      field,
      field === 'mandays'
        ? roundQuantity(items.reduce((sum, item) => sum + item[field], 0))
        : roundMoney(items.reduce((sum, item) => sum + item[field], 0)),
    ]),
  ) as GroupCostMeasures;
  totals.share = grandTotal ? totals.total / grandTotal : 0;
  return totals;
}

/** Section totals stay outside the leaf rows so consumers cannot count them twice. */
export function buildGroupCostSections(
  items: GroupCostSummaryRow[],
): GroupCostSection[] {
  const categories = new Map<string, GroupCostSummaryRow[]>();
  const projectItems: GroupCostSummaryRow[] = [];
  for (const item of items) {
    if (item.kind === 'Project' && item.category === undefined) {
      projectItems.push(item);
    } else {
      const category = item.category?.trim() || '';
      const group = categories.get(category) ?? [];
      group.push(item);
      categories.set(category, group);
    }
  }
  const grandTotal = roundMoney(
    items.reduce((sum, item) => sum + item.total, 0),
  );
  const sections: GroupCostSection[] = [...categories].map(
    ([category, categoryItems]) => ({
      key: `category:${JSON.stringify(category)}`,
      kind: 'Category',
      label: category || 'Uncategorized',
      category,
      items: categoryItems,
      totals: sumGroupCostMeasures(categoryItems, grandTotal),
    }),
  );
  if (projectItems.length)
    sections.push({
      key: 'project-accounts',
      kind: 'Project',
      label: 'Project Accounts',
      items: projectItems,
      totals: sumGroupCostMeasures(projectItems, grandTotal),
    });
  return sections;
}

/** Shared worksheet positions for the visible export and its live formulas. */
export function buildGroupCostSheetLayout(
  items: GroupCostSummaryRow[],
  firstRow = 5,
) {
  let nextRow = firstRow;
  const sections = buildGroupCostSections(items).map((section) => {
    const headerRow = nextRow++;
    const entries = section.items.map((item) => ({
      rowNumber: nextRow++,
      item,
    }));
    return { ...section, headerRow, entries, subtotalRow: nextRow++ };
  });
  const grandTotal = roundMoney(
    items.reduce((sum, item) => sum + item.total, 0),
  );
  return {
    sections,
    totalRow: nextRow,
    totals: sumGroupCostMeasures(items, grandTotal),
  };
}

export function buildGroupCostSummary(
  rows: CostInputRow[],
  resources: ResourceType[],
  settings: TravelSettings,
  manual: ManualCostInputs,
  subcontract?: SubcontractCost,
  startYear?: number | null,
): GroupCostSummaryRow[] {
  const travel = allocateHQTravel(rows, resources, settings);
  const empty = {
    mandays: 0,
    personnel: 0,
    travel: 0,
    subcontract: 0,
    ehs: 0,
    risk: 0,
    other: 0,
    total: 0,
    share: 0,
  };
  const categories = new Map<string, CostInputRow[]>();
  for (const row of rows.filter(
    (row) => !isLegacySubcontractRow(row, resources),
  )) {
    const category = row.category?.trim() || '';
    categories.set(category, [...(categories.get(category) ?? []), row]);
  }
  const result: GroupCostSummaryRow[] = [...categories]
    .flatMap(([category, rows]) =>
      groupPersonnelRows(rows).map((group) => ({ ...group, category })),
    )
    .map((group) => {
      const personnel = roundMoney(
        group.rows.reduce((sum, row) => sum + totalRowCost(row), 0),
      );
      const hqTravel = roundMoney(
        group.rows.reduce(
          (sum, row) =>
            sum + (travel.get(row.id) ?? []).reduce((a, b) => a + b, 0),
          0,
        ),
      );
      return {
        ...empty,
        key: group.category
          ? `category:${JSON.stringify([group.category, group.groupName])}`
          : `group:${group.groupName}`,
        label: group.groupName || UNASSIGNED_PERSONNEL_GROUP,
        category: group.category,
        groupName: group.groupName,
        kind: 'Group',
        personnel,
        travel: hqTravel,
        total: roundMoney(personnel + hqTravel),
        mandays: roundQuantity(
          group.rows.reduce((sum, row) => sum + totalRowMandays(row), 0),
        ),
      };
    });
  const categorizedSubcontract = new Map<string, number>();
  for (const item of [
    ...rows
      .filter((row) => isLegacySubcontractRow(row, resources))
      .map((row) => ({ category: row.category, total: totalRowCost(row) })),
    ...subcontractCostDetails(subcontract, startYear),
  ]) {
    const category = item.category?.trim() || '';
    categorizedSubcontract.set(
      category,
      roundMoney((categorizedSubcontract.get(category) ?? 0) + item.total),
    );
  }
  for (const [category, amount] of categorizedSubcontract)
    result.push({
      ...empty,
      key: `subcontract-category:${JSON.stringify(category)}`,
      label: 'Subcontract',
      kind: 'Subcontract',
      accountCode: '2.3.2',
      category,
      subcontract: amount,
      total: amount,
    });
  const statement = buildCostStatementRows(
    rows,
    resources,
    getHQTravelSummary(rows, resources, settings).totalCost,
    manual,
    subcontract,
    startYear,
  );
  const categoryNames = [...new Set(result.map((item) => item.category ?? ''))];
  if (!categoryNames.length) categoryNames.push('');
  const amount = (code: string) =>
    statement.find((row) => row.code === code)?.amount ?? 0;
  const direct = categoryNames.map((category) =>
    result
      .filter((row) => row.category === category)
      .reduce((sum, row) => sum + row.total, 0),
  );
  const accountAmounts = new Map<string, number[]>();
  for (const code of [
    '2.1.2',
    '2.2.1.2',
    '2.2.1.3',
    '2.3.1.2',
    '2.3.3',
    '2.3.4.1',
  ])
    accountAmounts.set(code, allocateCategoryAmount(amount(code), direct));
  const ehsBases = direct.map((_, index) => {
    const category = categoryNames[index];
    return roundMoney(
      result
        .filter((row) => row.category === category)
        .reduce(
          (sum, row) => sum + row.personnel + row.travel + row.subcontract,
          0,
        ) +
        accountAmounts.get('2.3.1.2')![index] +
        accountAmounts.get('2.3.3')![index],
    );
  });
  accountAmounts.set(
    '2.3.4.2',
    allocateCategoryAmount(amount('2.3.4.2'), ehsBases),
  );
  const beforeRisk = direct.map((cost, index) =>
    roundMoney(
      cost +
        [...accountAmounts.values()].reduce(
          (sum, values) => sum + values[index],
          0,
        ),
    ),
  );
  const saved = new Map(
    manual.categoryRiskWeights?.map((item) => [item.category, item.weight]),
  );
  const custom = categoryNames.map((category) => saved.get(category) ?? 0);
  const riskWeights = normalizedCategoryWeights(
    custom.some((weight) => weight > 0) ? custom : beforeRisk,
  );
  accountAmounts.set('15', allocateCategoryAmount(amount('15'), riskWeights));
  for (const code of ['2.2.1', '2.3.4'])
    accountAmounts.set(
      code,
      categoryNames.map((_, index) =>
        roundMoney(
          CATEGORY_STATEMENT_SUMS[code].reduce(
            (sum, child) => sum + accountAmounts.get(child)![index],
            0,
          ),
        ),
      ),
    );
  const accounts = [
    ['2.3.4', 'EHS', 'ehs'],
    ['15', 'Risk Contingency', 'risk'],
    ['2.1.2', 'Local Purchased Equipment', 'other'],
    ['2.2.1', 'Logistics', 'other'],
    ['2.3.1.2', 'Non In-house Labour', 'other'],
    ['2.3.3', 'Settlement', 'other'],
  ] as const;
  categoryNames.forEach((category, index) => {
    for (const [code, label, field] of accounts) {
      const value = accountAmounts.get(code)![index];
      if (value || field !== 'other')
        result.push({
          ...empty,
          key: `account:${JSON.stringify([category, code])}`,
          category,
          accountCode: code,
          ...(CATEGORY_STATEMENT_SUMS[code]
            ? {
                statementAmounts: Object.fromEntries(
                  CATEGORY_STATEMENT_SUMS[code].map((child) => [
                    child,
                    accountAmounts.get(child)![index],
                  ]),
                ),
              }
            : {}),
          label,
          kind: 'Project',
          [field]: value,
          total: value,
          ...(code === '15' ? { riskWeight: riskWeights[index] } : {}),
        });
    }
  });
  const total = roundMoney(result.reduce((sum, row) => sum + row.total, 0));
  return result.map((row) => ({
    ...row,
    share: total ? row.total / total : 0,
  }));
}

export function normalizedCategoryWeights(weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) =>
    total > 0 ? weight / total : 1 / weights.length,
  );
}

/** Editing one category amount preserves the other amounts and updates the project total. */
export function overrideCategoryRiskAmount(
  manual: ManualCostInputs,
  allocations: { category: string; amount: number }[],
  category: string,
  amount: number,
): ManualCostInputs {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !allocations.some((item) => item.category === category)
  )
    return manual;
  const next = allocations.map((item) => ({
    ...item,
    amount: item.category === category ? roundMoney(amount) : item.amount,
  }));
  const total = roundMoney(next.reduce((sum, item) => sum + item.amount, 0));
  return {
    ...manual,
    riskContingency: total,
    categoryRiskWeights: next.map((item) => ({
      category: item.category,
      weight: total > 0 ? item.amount / total : 0,
    })),
  };
}

/** Cumulative cent rounding reconciles every allocation without a floating remainder rank. */
export function allocateCategoryAmount(amount: number, weights: number[]) {
  const shares = normalizedCategoryWeights(weights);
  const cents = Math.round(amount * 100);
  let cumulative = 0,
    previous = 0;
  return shares.map((share, index) => {
    cumulative += share;
    const rounded =
      index === shares.length - 1 ? cents : Math.round(cents * cumulative);
    const result = (rounded - previous) / 100;
    previous = rounded;
    return result;
  });
}

export const CATEGORY_STATEMENT_SUMS: Record<string, string[]> = {
  '2': ['2.1.2', '2.2', '2.3'],
  '2.2': ['2.2.1'],
  '2.2.1': ['2.2.1.2', '2.2.1.3'],
  '2.3': ['2.3.1', '2.3.2', '2.3.3', '2.3.4'],
  '2.3.1': ['2.3.1.1', '2.3.1.2', '2.3.1.3'],
  '2.3.4': ['2.3.4.1', '2.3.4.2'],
  '': ['2', '15'],
};
export function categoryStatementAmounts(items: GroupCostSummaryRow[]) {
  const amounts: Record<string, number> = {};
  for (const item of items) {
    if (item.kind === 'Group') {
      amounts['2.3.1.1'] = roundMoney(
        (amounts['2.3.1.1'] ?? 0) + item.personnel,
      );
      amounts['2.3.1.3'] = roundMoney((amounts['2.3.1.3'] ?? 0) + item.travel);
    } else if (item.statementAmounts) {
      for (const [code, amount] of Object.entries(item.statementAmounts))
        amounts[code] = roundMoney((amounts[code] ?? 0) + amount);
    } else if (item.accountCode)
      amounts[item.accountCode] = roundMoney(
        (amounts[item.accountCode] ?? 0) + item.total,
      );
  }
  const resolve = (code: string): number =>
    amounts[code] ??
    (amounts[code] = CATEGORY_STATEMENT_SUMS[code]
      ? roundMoney(
          CATEGORY_STATEMENT_SUMS[code].reduce(
            (sum, child) => sum + resolve(child),
            0,
          ),
        )
      : 0);
  resolve('');
  return amounts;
}
