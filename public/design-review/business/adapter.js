import { liveSnapshot, livePricing } from './live-model.js';
import * as engine from './engine.js';
export { engine };
export const businessDefaults = {
  manual: {
    localPurchasedEquipment: 0,
    inlandLogistics: 0,
    countryWarehousing: 0,
    nonInHouseLabour: 0,
    settlement: 0,
    carFee: 0,
    otherService: 0,
    otherServiceRate: 0.01,
    riskContingency: 6000,
    categoryRiskWeights: [],
  },
  rateSettings: {
    quoteAsOf: '2026-11-02',
    tdStart: '2027-01-01',
    tdEnd: '2031-12-31',
    baseYear: 2027,
    defaultUplift: 5,
    annualUplifts: [0, 5, 5, 5, 5],
    allowancePools: [],
  },
  travelSettings: {
    enabled: true,
    monthlyAllowance: 1200,
    airfarePerTrip: 800,
    trips: 2,
  },
  profitShareRates: [
    { id: 'ps1', bu: 'FBB', ratePercent: 15, active: true },
    { id: 'ps2', bu: 'MBB', ratePercent: 10, active: true },
  ],
  quoteMode: 'gp',
  lineGp: {},
  sections: {
    Mandatory: 'mandatory',
    Phase2: 'mandatory',
    Optional: 'optional',
  },
  discountShares: {},
};
export function makeSnapshot(state) {
  if (state.live) return liveSnapshot(state);
  const resourceTypes = state.rows.map((row) => {
    const master = state.resources.find((r) => r.name === row.resource);
    return {
      id: row.id,
      code: master?.code || row.resource,
      name: row.resource,
      category: 'internal',
      pool: row.resource.startsWith('HQ') ? 'HQ' : 'LOCAL',
      level: row.resource.split(' ').at(-1),
      mandayRate: row.rate,
      mandaysPerMonth: 21.75,
      hoursPerManday: 8,
      hqTravel: row.resource.startsWith('HQ'),
      effectiveFrom: '2027-01-01',
      effectiveTo: '2031-12-31',
      active: true,
    };
  });
  // Reuse a resource identity for identical captured rates, while preserving a version-owned rate snapshot.
  const resourceKey = (r) => `${r.name}:${r.mandayRate}`;
  const unique = new Map(
    resourceTypes.map((r) => [resourceKey(r), { ...r, id: resourceKey(r) }]),
  );
  const costRows = state.rows.map((row) => {
    const group = state.groups.find((g) => g.id === row.group);
    return {
      id: row.id,
      groupName: group?.name || '',
      category: group?.category || '',
      scope: row.scope,
      bu: row.bu,
      reTypeId: `${row.resource}:${row.rate}`,
      inputMode: row.inputMode || 'mandays',
      mdPerSite: row.mdSite,
      years: row.years.map((md, i) => ({
        bucket: `Y${i + 1}`,
        sites: row.siteYears?.[i] ?? (row.mdSite ? md / row.mdSite : 0),
        mandays: md,
        cost: 0,
      })),
    };
  });
  const subcontractCost = {
    mode: state.siteTypes?.length ? 'site-types' : 'project',
    siteTypes: state.siteTypes || [],
    ...(state.subconRates ? { rateSettings: state.subconRates } : {}),
    lines: state.subcon.map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      category: row.category || '',
      bu: row.bu || '',
      unit: row.unit,
      currency: 'SGD',
      unitPrice: row.price,
      quantities: row.quantities || [row.qty, 0, 0, 0, 0],
    })),
  };
  return {
    resourceTypes: [...unique.values()],
    costRows: engine.recalculateCostRows(
      costRows,
      [...unique.values()],
      state.rateSettings,
    ),
    rateSettings: state.rateSettings,
    travelSettings: state.travelSettings,
    manualCosts: state.manual,
    subcontractCost,
  };
}
export function reviewData(state) {
  const snapshot = makeSnapshot(state),
    { costRows, resourceTypes, travelSettings, manualCosts, subcontractCost } =
      snapshot;
  const year = engine.getY1Year(state.rateSettings),
    travel = engine.getHQTravelSummary(costRows, resourceTypes, travelSettings);
  const statement = engine.buildCostStatementRows(
    costRows,
    resourceTypes,
    travel.totalCost,
    manualCosts,
    subcontractCost,
    year,
  );
  const groupRows = engine.buildGroupCostSummary(
    costRows,
    resourceTypes,
    travelSettings,
    manualCosts,
    subcontractCost,
    year,
  );
  const sections = engine.buildGroupCostSections(groupRows).map((section) => ({
    ...section,
    amounts: engine.categoryStatementAmounts(section.items),
  }));
  const categories = sections.map((s) => ({
    category: s.category || '',
    label: s.label,
    personnel: s.amounts['2.3.1.1'],
    travel: s.amounts['2.3.1.3'],
    subcon: s.amounts['2.3.2'],
    settlement: s.amounts['2.3.3'],
    ehs: s.amounts['2.3.4'],
    risk: s.amounts['15'],
    other: s.totals.other,
    total: s.amounts[''],
    mandays: s.totals.mandays,
    amounts: s.amounts,
  }));
  const dimension = (key) =>
    engine.buildReconciledCostDimensionSummary(
      costRows,
      key,
      resourceTypes,
      travel.totalCost,
      manualCosts,
      subcontractCost,
      { includeRisk: true },
      year,
    );
  const total = statement.at(-1).amount,
    buAllocation = engine.calculateBuCostAllocation(snapshot);
  return {
    snapshot,
    travel,
    statement,
    groupRows,
    sections,
    categories,
    total,
    bu: dimension('bu'),
    resource: dimension('resourceType'),
    buAllocation,
  };
}
export function reviewPricing(state, data = reviewData(state)) {
  if (state.live) return livePricing(state, data);
  const settings = {
    targetGrossMargin: state.gp,
    discount: state.discount,
    gstPercent: 0,
    profitShareRates: state.profitShareRates,
  };
  const global = engine.calculatePricing(
    data.total,
    settings,
    data.buAllocation,
  );
  const automatic = engine.allocateMoneyByWeights(
    global.listPrice,
    data.categories.map((r) => r.total || 0),
  );
  let lines = data.categories.map((r, i) => ({
    id: `category:${r.category}`,
    description: r.label,
    category: r.category || 'Uncategorized',
    inclusion: state.sections[r.category] || 'mandatory',
    quantity: 1,
    unit: 'lot',
    unitPrice:
      state.quoteMode === 'gp'
        ? automatic[i]
        : (state.prices[r.category] ?? automatic[i]),
    costWeight: r.total,
    ...(state.quoteMode === 'line-gp'
      ? { targetGrossMargin: state.lineGp[r.category] ?? state.gp }
      : {}),
    priceFixed: false,
  }));
  const result =
    state.quoteMode === 'gp'
      ? global
      : engine.calculatePricing(
          data.total,
          {
            ...settings,
            lineMode: 'manual',
            ...(state.quoteMode === 'line-gp'
              ? { manualPricingBasis: 'line-gp' }
              : {}),
            manualLines: lines,
          },
          data.buAllocation,
        );
  lines = (result.allocatedManualLines || lines).map((line) => ({
    ...line,
    amount: engine.roundMoney(line.quantity * line.unitPrice),
  }));
  const descriptions = {},
    shares = [];
  lines.forEach((line) => {
    const key = engine.discountGroupKey(line.inclusion, line.category);
    descriptions[key] =
      state.descriptions[
        data.categories.find(
          (r) => (r.category || 'Uncategorized') === line.category,
        )?.category || ''
      ] || '';
    const percentage = state.discountShares[line.category];
    if (percentage !== undefined) shares.push({ key, percentage });
  });
  const discounts = engine.allocateQuotationDiscount(lines, state.discount, {
    mode: 'category',
    shares,
    descriptions,
  });
  const rows = data.categories.map((r, i) => {
    const discount = discounts.rows.find(
      (x) =>
        x.key ===
        engine.discountGroupKey(lines[i].inclusion, lines[i].category),
    );
    return {
      ...r,
      price: lines[i].amount,
      discount: discount?.discount || 0,
      net: discount?.net || 0,
      percentage: discount?.percentage || 0,
      inclusion: lines[i].inclusion,
      description: discount?.description || '',
    };
  });
  const errors = [...result.errors, ...discounts.errors];
  return {
    ...result,
    rows,
    discounts,
    lines,
    errors,
    valid: errors.length === 0,
  };
}
