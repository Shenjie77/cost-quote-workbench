/** The approved compact view is a projection, never a replacement workspace schema. */
import * as engine from './engine.js';
const clone = (v) => structuredClone(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const costKeys = [
  'costRows',
  'resourceTypes',
  'rateSettings',
  'travelSettings',
  'manualCosts',
  'subcontractCost',
];
export function projectState(workspace, index = []) {
  const w = clone(workspace);
  const activeResources =
    w.costVersions.find((v) => v.code === w.activeVersion)?.resourceTypes ||
    w.resourceTypes;
  const groups = [],
    groupIds = new Map();
  const rows = w.costRows.map((r) => {
    const key = JSON.stringify([r.groupName || '', r.category || '']);
    if (!groupIds.has(key)) {
      const id = `group-${groups.length}`;
      groupIds.set(key, id);
      groups.push({ id, name: r.groupName || '', category: r.category || '' });
    }
    const resource = activeResources.find((t) => t.id === r.reTypeId);
    return {
      id: r.id,
      group: groupIds.get(key),
      scope: r.scope,
      bu: r.bu,
      resource: resource?.id || r.reTypeId,
      rate: resource?.mandayRate || 0,
      inputMode: r.inputMode || 'sites',
      mdSite: r.mdPerSite,
      siteYears: Array.from({ length: 5 }, (_, i) => r.years[i]?.sites || 0),
      years: Array.from({ length: 5 }, (_, i) => engine.yearRowMandays(r, i)),
    };
  });
  const state = {
    live: true,
    _source: w,
    projects: index.map((p) => ({
      ...p,
      id: p.projectId,
      name: p.name,
      client: p.client,
      owner: p.workflowOwner || '',
      stage: p.currentWorkflowStepCode || '',
      cost: p.totalCost || 0,
      quote: p.totalQuote || 0,
      due: p.workflowFollowUpDate || '',
      tags: p.tags || [],
    })),
    groups: groups.length
      ? groups
      : [{ id: 'group-0', name: '', category: '' }],
    rows,
    resources: activeResources.map((r) => ({
      ...r,
      name: r.id,
      label: r.name || r.code,
      rate: r.mandayRate,
    })),
    manual: clone(w.manualCosts),
    rateSettings: clone(w.rateSettings),
    travelSettings: clone(w.travelSettings),
    subcon: (w.subcontractCost?.lines || []).map((r) => ({
      ...r,
      price: r.unitPrice,
      qty: r.quantities?.[0] || 0,
    })),
    siteTypes: clone(w.subcontractCost?.siteTypes || []),
    subconRates: clone(w.subcontractCost?.rateSettings),
    subconCatalog: w.subcontractItems.map((r) => ({
      ...r,
      description: r.item,
      price: r.unitPrice,
    })),
    selectedTemplate: w.selectedQuoteTemplateId,
    quoteTemplates: clone(w.quoteTemplates),
    quoteAssumptions: clone(w.quoteAssumptions),
    pricing: clone(w.pricing),
    gp: w.pricing.targetGrossMargin,
    discount: w.pricing.discount,
    profitShareRates: clone(w.pricing.profitShareRates || []),
    prices: {},
    lineGp: {},
    sections: {},
    discountShares: {},
    descriptions: {},
    cpqWorkspace: clone(w.cpq || engine.emptyCpq()),
    cpqMeta: { confirmer: '' },
    cpq: [],
    maintenance: (w.maintenanceBoq?.boq || []).map((r) => ({
      ...r,
      qty: r.quantity,
      years: r.durationYears ?? (w.maintenanceBoq?.coverageMonths || 12) / 12,
      ct: r.ct ?? r.unitAnnualQuote,
      spms: r.spms ?? 0,
    })),
    maintenanceSettings: {
      startYear:
        w.maintenanceBoq?.startYear || engine.getY1Year(w.rateSettings),
    },
    tasks: w.processSteps.map((r) => ({
      ...r,
      id: r.code,
      fields: clone(r.fieldValues || {}),
      name: r.name || r.nameZh,
      owner: r.owner || '',
      due: r.followUpDate || '',
      note: r.note || '',
    })),
    files: [],
    archive: { rootPath: '', projectPath: '' },
    drafts: [],
    projectTags: [],
    supplemental: clone(w.supplementalCostItems),
    assumptions: clone(w.assumptionLibrary),
    statusNodes: clone(w.projectStatusDefinitions),
  };
  const existing = state.projects.find((p) => p.id === w.project.id);
  const p = {
    ...existing,
    ...w.project,
    ...w.ssr,
    tags: w.projectTags || [],
  };
  if (existing) Object.assign(existing, p);
  else state.projects.push(p);
  state._baseline = clone(
    Object.fromEntries(
      [
        'rows',
        'groups',
        'resources',
        'manual',
        'rateSettings',
        'travelSettings',
        'subcon',
        'siteTypes',
        'subconRates',
        'pricing',
        'cpqWorkspace',
        'maintenance',
        'maintenanceSettings',
        'projects',
        'selectedTemplate',
        'quoteTemplates',
        'quoteAssumptions',
      ].map((k) => [k, state[k]]),
    ),
  );
  return state;
}
export function liveSnapshot(state) {
  const w = state._source,
    base = state._baseline;
  const resources = state.resources.map((r) => {
    const original = (
      w.costVersions.find((v) => v.code === w.activeVersion)?.resourceTypes ||
      w.resourceTypes
    ).find((t) => t.id === r.id);
    return { ...(original || r), mandayRate: r.rate };
  });
  const costInputsChanged = [
    'rows',
    'groups',
    'resources',
    'rateSettings',
  ].some((k) => !same(state[k], base[k]));
  let rows = clone(w.costRows);
  if (costInputsChanged) {
    rows = state.rows.map((r) => {
      const original = w.costRows.find((x) => x.id === r.id),
        group = state.groups.find((g) => g.id === r.group);
      return {
        ...original,
        id: r.id,
        groupName: group?.name || '',
        category: group?.category || '',
        scope: r.scope,
        bu: r.bu,
        reTypeId: r.resource,
        inputMode: r.inputMode || 'mandays',
        mdPerSite: r.inputMode === 'sites' ? r.mdSite || 0 : 0,
        years: Array.from({ length: 5 }, (_, i) => ({
          ...original?.years[i],
          bucket: `Y${i + 1}`,
          mandays: r.inputMode === 'sites' ? 0 : (r.years[i] ?? 0),
          sites: r.inputMode === 'sites' ? (r.siteYears?.[i] ?? 0) : 0,
          cost: original?.years[i]?.cost || 0,
        })),
      };
    });
    rows = engine.recalculateCostRows(rows, resources, state.rateSettings);
  }
  const subconChanged = ['subcon', 'siteTypes', 'subconRates'].some(
    (k) => !same(state[k], base[k]),
  );
  const subcontractCost = subconChanged
    ? {
        ...w.subcontractCost,
        mode: state.siteTypes.length ? 'site-types' : 'project',
        siteTypes: clone(state.siteTypes),
        lines: state.subcon.map((r) => {
          const { price, qty, ...rest } = r;
          return {
            ...rest,
            unitPrice: price,
            currency: r.currency || 'SGD',
            quantities: r.quantities || [qty || 0, 0, 0, 0, 0],
          };
        }),
        ...(state.subconRates
          ? { rateSettings: clone(state.subconRates) }
          : {}),
      }
    : clone(w.subcontractCost);
  return {
    schemaVersion: '2.0.0',
    exportedAt: new Date().toISOString(),
    project: clone(w.project),
    costVersion: {
      code: w.activeVersion,
      status:
        w.costVersions.find((v) => v.code === w.activeVersion)?.state ||
        'Draft',
    },
    costRows: rows,
    resourceTypes: resources,
    rateSettings: clone(state.rateSettings),
    travelSettings: clone(state.travelSettings),
    manualCosts: clone(state.manual),
    subcontractCost,
  };
}
export function workspaceFromState(state) {
  const w = clone(state._source),
    snapshot = liveSnapshot(state);
  const originalRates =
    w.costVersions.find((v) => v.code === w.activeVersion)?.resourceTypes ||
    w.resourceTypes;
  const costChanged = costKeys.some(
    (k) => !same(snapshot[k], k === 'resourceTypes' ? originalRates : w[k]),
  );
  if (costChanged) {
    if (
      w.costVersions.find((v) => v.code === w.activeVersion)?.state !== 'Draft'
    )
      throw new Error(
        '此成本版本只读，请复制 Draft / This cost version is read-only.',
      );
    for (const key of costKeys)
      if (key !== 'resourceTypes' && snapshot[key] !== undefined)
        w[key] = clone(snapshot[key]);
    w.costVersions = w.costVersions.map((v) =>
      v.code === w.activeVersion
        ? {
            ...v,
            ...Object.fromEntries(
              costKeys
                .filter((k) => snapshot[k] !== undefined)
                .map((k) => [k, clone(snapshot[k])]),
            ),
          }
        : v,
    );
  }
  if (state.selectedTemplate !== state._baseline.selectedTemplate)
    w.selectedQuoteTemplateId = state.selectedTemplate;
  if (!same(state.quoteTemplates, state._baseline.quoteTemplates))
    w.quoteTemplates = clone(state.quoteTemplates);
  if (!same(state.quoteAssumptions, state._baseline.quoteAssumptions))
    w.quoteAssumptions = clone(state.quoteAssumptions);
  if (!same(state.pricing, state._baseline.pricing))
    w.pricing = clone(state.pricing);
  if (!same(state.cpqWorkspace, state._baseline.cpqWorkspace))
    w.cpq = clone(state.cpqWorkspace);
  if (
    !same(state.maintenance, state._baseline.maintenance) ||
    !same(state.maintenanceSettings, state._baseline.maintenanceSettings)
  ) {
    w.maintenanceBoq = {
      ...w.maintenanceBoq,
      pricingMode: 'components',
      startYear: state.maintenanceSettings.startYear,
      coverageMonths: w.maintenanceBoq?.coverageMonths || 12,
      archives: w.maintenanceBoq?.archives || [],
      boq: state.maintenance.map((r) => {
        const { qty, years, ...rest } = r;
        return {
          ...rest,
          quantity: qty,
          durationYears: years,
          unitAnnualQuote: r.ct,
          referenceId: r.referenceId || '',
          serviceLevel: r.serviceLevel || '',
          basis: r.basis || '',
          source: r.source || '',
          site: r.site || '',
        };
      }),
    };
  }
  const p = state.projects.find((p) => p.id === w.project.id),
    before = state._baseline.projects.find((p) => p.id === w.project.id);
  for (const k of ['name', 'client'])
    if (p?.[k] !== before?.[k]) w.project[k] = p[k];
  if (!same(p?.tags, before?.tags)) w.projectTags = clone(p.tags);
  for (const k of [
    'proposalNumber',
    'companyUrl',
    'cpqUrl',
    'scopeBrief',
    'technicalBasis',
  ])
    if (p?.[k] !== before?.[k]) w.ssr = { ...w.ssr, [k]: p[k] };
  return w;
}
/** Uses saved line modes and prices; loading never regenerates a quotation. */
export function livePricing(state, data) {
  const settings = state.pricing,
    resolved =
      settings.manualPricingBasis === 'line-gp' && settings.manualLines
        ? engine.resolveQuoteCostBindings(
            settings.manualLines,
            data.snapshot,
            data.total,
            settings.riskScopeShares,
          )
        : null;
  const current = resolved
    ? { ...settings, manualLines: resolved.lines }
    : settings;
  const result = engine.calculatePricing(
    data.total,
    { ...current, gstPercent: 0 },
    data.buAllocation,
  );
  const lines = engine.buildQuoteLines(
    data.snapshot,
    settings.lineMode || 'single',
    result.listPrice,
    result.allocatedManualLines ?? settings.manualLines,
  );
  const grouped = engine.groupedLines(
    lines,
    settings.lineGroups,
    settings.sectionNames,
  );
  let discounts = engine.allocateQuotationDiscount(
    grouped,
    settings.discount,
    settings.discountAllocation,
  );
  let customer = null;
  const customerErrors = [];
  try {
    customer = engine.customerDocument({
      project: state._source.project,
      template:
        state.quoteTemplates.find((t) => t.id === state.selectedTemplate) || {},
      pricing: result,
      lines,
      lineMode: settings.lineMode,
      maintenance: workspaceFromState(state).maintenanceBoq,
    });
    discounts = customer.allocation;
  } catch (error) {
    customerErrors.push(error.message);
  }
  const generated =
    settings.lineMode !== 'manual'
      ? engine.buildQuoteLines(
          data.snapshot,
          settings.lineMode || 'single',
          data.total,
        )
      : null;
  const drafts = lines.map(({ amount, ...line }, i) => ({
    ...line,
    ...(result.allocatedManualLines ?? settings.manualLines ?? []).find(
      (r) => r.id === line.id,
    ),
    costWeight:
      settings.lineMode === 'manual'
        ? ((result.allocatedManualLines ?? settings.manualLines ?? []).find(
            (r) => r.id === line.id,
          )?.costWeight ?? amount)
        : (generated?.[i]?.amount ?? amount),
  }));
  return {
    ...result,
    customer,
    customerTotal: customer?.total ?? result.quoteAfterTax,
    customerLines: customer?.allLines ?? grouped,
    lines,
    drafts,
    costs: engine.lineCostAmounts(drafts, data.total),
    grouped,
    discounts,
    valid:
      result.valid &&
      discounts.valid !== false &&
      !resolved?.errors.length &&
      !customerErrors.length,
    errors: [
      ...result.errors,
      ...customerErrors,
      ...discounts.errors,
      ...(resolved?.errors || []),
    ],
  };
}
export function editLiveQuoteLine(state, data, id, patch) {
  const p = livePricing(state, data),
    mode = state.pricing.lineSourceMode || state.pricing.lineMode || 'single';
  const lines = p.drafts.map((r) => (r.id === id ? { ...r, ...patch } : r));
  const bound = engine.resolveQuoteCostBindings(
    lines,
    data.snapshot,
    data.total,
    state.pricing.riskScopeShares,
  );
  if (bound.errors.length) throw new Error(bound.errors.join('; '));
  const calculated = engine.allocateLinePricing(
    bound.lines,
    data.total,
    p.weightedProfitShareRate,
  );
  const { manualTargetPrice: _old, ...rest } = state.pricing;
  state.pricing = {
    ...rest,
    lineMode: 'manual',
    manualPricingBasis: 'line-gp',
    lineSourceMode: mode,
    manualLines: calculated.lines,
    ...(mode === 'manual' ? { customLinesDraft: calculated.lines } : {}),
  };
}
