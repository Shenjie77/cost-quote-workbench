import * as engine from './engine.js';

/** Switching one row preserves its five annual efforts and clears site-only fields. */
export function editDirectMandays(row, year, value) {
  row.years = Array.from({ length: 5 }, (_, i) => row.years[i] ?? 0);
  row.years[year] = value;
  row.inputMode = 'mandays';
  row.mdSite = 0;
  row.siteYears = [0, 0, 0, 0, 0];
}

/** A breakdown of internal HR cost; allowance is included once, travel separately. */
export function costInputSummary(snapshot) {
  const { costRows, resourceTypes, rateSettings, travelSettings } = snapshot;
  const rows = costRows.filter(
    (r) =>
      resourceTypes.find((t) => t.id === r.reTypeId)?.category === 'internal',
  );
  const withoutAllowance = {
    ...rateSettings,
    allowancePools: [],
    allowanceResourceTypeIds: [],
  };
  const sum = (settings) =>
    rows.reduce(
      (total, row) =>
        total +
        row.years.reduce(
          (subtotal, _, i) =>
            subtotal +
            engine.calculatedYearCost(row, i, resourceTypes, settings),
          0,
        ),
      0,
    );
  const hr = engine.roundMoney(sum(withoutAllowance));
  const withAllowance = engine.roundMoney(sum(rateSettings));
  const allowance = engine.roundMoney(withAllowance - hr);
  const travel = engine.getHQTravelSummary(
    costRows,
    resourceTypes,
    travelSettings,
  ).totalCost;
  return {
    hr,
    allowance,
    travel,
    mandays: engine.roundQuantity(
      rows.reduce((sum, r) => sum + engine.totalRowMandays(r), 0),
    ),
    total: engine.roundMoney(withAllowance + travel),
  };
}

/** Repair the old editor's unfinished direct-entry payload only on explicit recovery.
 * Missing direct years mean zero; entered years and all unrelated business fields remain.
 */
export function repairCostRecovery(workspace) {
  const w = structuredClone(workspace);
  const active = w.costVersions.find((v) => v.code === w.activeVersion);
  if (active?.state !== 'Draft') return w;
  w.costRows = w.costRows.map((row) =>
    row.inputMode !== 'mandays'
      ? row
      : {
          ...row,
          mdPerSite: 0,
          years: Array.from({ length: 5 }, (_, i) => ({
            ...row.years[i],
            bucket: `Y${i + 1}`,
            sites: 0,
            mandays: row.years[i]?.mandays ?? 0,
            cost: row.years[i]?.cost ?? 0,
          })),
        },
  );
  w.costRows = engine.recalculateCostRows(
    w.costRows,
    active.resourceTypes || w.resourceTypes,
    w.rateSettings,
  );
  active.costRows = structuredClone(w.costRows);
  return w;
}
