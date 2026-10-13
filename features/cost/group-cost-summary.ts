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
import type { SubcontractCost } from './subcontract-domain.ts';
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
  kind: 'Group' | 'Project';
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
  'Group costs include HQ travel: monthly allowance by HQ person-months; airfare by HQ mandays. Subcontract, EHS, risk and other project costs are listed separately. All years; reconciles to Cost Statement.';

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
  const result: GroupCostSummaryRow[] = groupPersonnelRows(
    rows.filter((row) => !isLegacySubcontractRow(row, resources)),
  ).map((group) => {
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
      key: `group:${group.groupName}`,
      label: group.groupName || UNASSIGNED_PERSONNEL_GROUP,
      kind: 'Group',
      personnel,
      travel: hqTravel,
      total: roundMoney(personnel + hqTravel),
      mandays: roundQuantity(
        group.rows.reduce((sum, row) => sum + totalRowMandays(row), 0),
      ),
    };
  });
  const statement = buildCostStatementRows(
    rows,
    resources,
    getHQTravelSummary(rows, resources, settings).totalCost,
    manual,
    subcontract,
    startYear,
  );
  const accounts = [
    ['2.3.2', 'Subcontract', 'subcontract'],
    ['2.3.4.2', 'EHS', 'ehs'],
    ['15', 'Risk Contingency', 'risk'],
    ['2.1.2', 'Local Purchased Equipment', 'other'],
    ['2.2.1', 'Logistics', 'other'],
    ['2.3.1.2', 'Non In-house Labour', 'other'],
    ['2.3.3', 'Settlement', 'other'],
    ['2.3.4.1', 'Car Fee', 'other'],
  ] as const;
  for (const [code, label, field] of accounts) {
    const amount = statement.find((row) => row.code === code)?.amount ?? 0;
    if (amount || field !== 'other')
      result.push({
        ...empty,
        key: `account:${code}`,
        label,
        kind: 'Project',
        [field]: amount,
        total: amount,
      });
  }
  const total = roundMoney(result.reduce((sum, row) => sum + row.total, 0));
  return result.map((row) => ({
    ...row,
    share: total ? row.total / total : 0,
  }));
}
