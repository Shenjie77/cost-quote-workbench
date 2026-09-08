/** Version-owned subcontract BOQs. Catalogue edits never change these snapshots. */
import { roundMoney, roundQuantity } from './domain.ts';

export type SubcontractLineBase = {
  id: string;
  catalogItemId?: string;
  code: string;
  description: string;
  bu: string;
  unit: string;
  /** Null means not priced; zero is an explicitly priced free item. */
  unitPrice: number | null;
  currency: 'SGD';
};
export type SubcontractCostLine = SubcontractLineBase & {
  quantities: number[];
};
export type SubcontractSiteLine = SubcontractLineBase & {
  quantityPerSite: number;
};
export type SubcontractSiteType = {
  id: string;
  name: string;
  sites: number[];
  lines: SubcontractSiteLine[];
};
export type SubcontractCost = {
  mode: 'project' | 'site-types';
  lines: SubcontractCostLine[];
  siteTypes: SubcontractSiteType[];
};

const fiveYears = () => [0, 0, 0, 0, 0];
const total = (years: number[]) =>
  roundMoney(years.reduce((sum, cost) => sum + cost, 0));
export const emptySubcontractCost = (): SubcontractCost => ({
  mode: 'project',
  lines: [],
  siteTypes: [],
});

/** Each annual item is rounded to cents before any annual or statement roll-up. */
export function calculateSubcontractCost(data?: SubcontractCost) {
  const lines = (data?.lines ?? []).map((line) => {
    const years = fiveYears().map((_, year) =>
      roundMoney((line.unitPrice ?? 0) * (line.quantities[year] ?? 0)),
    );
    return { id: line.id, years, total: total(years) };
  });
  const siteTypes = (data?.mode === 'site-types' ? data.siteTypes : []).map(
    (site) => {
      const siteLines = site.lines.map((line) => {
        const unitCost = roundMoney(
          (line.unitPrice ?? 0) * line.quantityPerSite,
        );
        const years = fiveYears().map((_, year) =>
          roundMoney(unitCost * (site.sites[year] ?? 0)),
        );
        return { id: line.id, unitCost, years, total: total(years) };
      });
      const years = fiveYears().map((_, year) =>
        roundMoney(siteLines.reduce((sum, line) => sum + line.years[year], 0)),
      );
      return {
        id: site.id,
        name: site.name,
        unitCost: roundMoney(
          siteLines.reduce((sum, line) => sum + line.unitCost, 0),
        ),
        lines: siteLines,
        years,
        total: total(years),
      };
    },
  );
  const years = fiveYears().map((_, year) =>
    roundMoney(
      [...lines, ...siteTypes].reduce(
        (sum, entry) => sum + entry.years[year],
        0,
      ),
    ),
  );
  return { years, total: total(years), lines, siteTypes };
}

/** Flat calculated leaves for dimensional reporting and export, never labour rows. */
export function subcontractCostDetails(data?: SubcontractCost) {
  if (!data) return [];
  const calculated = calculateSubcontractCost(data);
  const project = data.lines.map((line, index) => ({
    ...line,
    scope: line.description,
    siteType: '',
    quantities: [...line.quantities],
    quantityPerSite: null as number | null,
    sites: fiveYears(),
    ...calculated.lines[index],
  }));
  const siteTypes =
    data.mode === 'site-types'
      ? data.siteTypes.flatMap((site, siteIndex) =>
          site.lines.map((line, lineIndex) => ({
            ...line,
            id: `${site.id}:${line.id}`,
            scope: line.description,
            siteType: site.name,
            quantities: site.sites.map((count) =>
              roundQuantity(count * line.quantityPerSite),
            ),
            sites: [...site.sites],
            quantityPerSite: line.quantityPerSite,
            years: calculated.siteTypes[siteIndex].lines[lineIndex].years,
            total: calculated.siteTypes[siteIndex].lines[lineIndex].total,
          })),
        )
      : [];
  return [...project, ...siteTypes];
}

/** Shared checks for UI confirmation, export, and API finalization. Drafts may be unpriced. */
export function validateSubcontractCost(
  data: SubcontractCost | undefined,
  requirePrices = true,
) {
  const issues: Array<{ code: string; path: string; message: string }> = [];
  if (!data) return issues;
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path: `/subcontractCost${path}`, message });
  const amount = (value: unknown, maximum = 1_000_000_000_000) =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= maximum;
  const quantities = (values: number[], path: string, integer = false) => {
    if (
      !Array.isArray(values) ||
      values.length !== 5 ||
      values.some(
        (value) =>
          !amount(value, 1_000_000) || (integer && !Number.isInteger(value)),
      )
    )
      add(
        'INVALID_SUBCONTRACT_QUANTITY',
        path,
        'Enter five finite, non-negative annual quantities; site counts must be whole numbers.',
      );
  };
  const lines = (
    values: Array<SubcontractCostLine | SubcontractSiteLine>,
    path: string,
    site: boolean,
  ) => {
    const ids = new Set<string>();
    values.forEach((line, index) => {
      const itemPath = `${path}/${index}`;
      if (!line.id?.trim() || ids.has(line.id))
        add(
          'INVALID_SUBCONTRACT_ID',
          `${itemPath}/id`,
          'Subcontract line IDs must be present and unique within their group.',
        );
      ids.add(line.id);
      for (const field of ['code', 'description', 'bu', 'unit'] as const) {
        if (typeof line[field] !== 'string')
          add(
            'INVALID_SUBCONTRACT_TEXT',
            `${itemPath}/${field}`,
            `Subcontract ${field} must be text.`,
          );
        else if (requirePrices && !line[field].trim())
          add(
            'SUBCONTRACT_TEXT_REQUIRED',
            `${itemPath}/${field}`,
            `Subcontract ${field} is required.`,
          );
      }
      if (line.currency !== 'SGD')
        add(
          'INVALID_SUBCONTRACT_CURRENCY',
          `${itemPath}/currency`,
          'Subcontract costs must be priced in SGD before posting.',
        );
      if (line.unitPrice === null) {
        if (requirePrices)
          add(
            'SUBCONTRACT_PRICE_REQUIRED',
            `${itemPath}/unitPrice`,
            'Set a unit price before confirming or exporting this cost version.',
          );
      } else if (!amount(line.unitPrice))
        add(
          'INVALID_SUBCONTRACT_PRICE',
          `${itemPath}/unitPrice`,
          'Unit price must be a finite non-negative SGD amount.',
        );
      if (site) {
        if (
          !amount((line as SubcontractSiteLine).quantityPerSite, 1_000_000) ||
          (line.unit?.trim?.().toLowerCase() === 'pcs' &&
            !Number.isInteger((line as SubcontractSiteLine).quantityPerSite))
        )
          add(
            'INVALID_SUBCONTRACT_QUANTITY',
            `${itemPath}/quantityPerSite`,
            'Quantity per site must be finite and non-negative.',
          );
      } else
        quantities(
          (line as SubcontractCostLine).quantities,
          `${itemPath}/quantities`,
          line.unit?.trim?.().toLowerCase() === 'pcs',
        );
    });
  };
  if (!['project', 'site-types'].includes(data.mode))
    add(
      'INVALID_SUBCONTRACT_MODE',
      '/mode',
      'Choose Project total or Site types.',
    );
  if (!Array.isArray(data.lines) || !Array.isArray(data.siteTypes)) {
    add(
      'INVALID_SUBCONTRACT_LINES',
      '',
      'Subcontract project lines and site types must be arrays.',
    );
    return issues;
  }
  lines(data.lines, '/lines', false);
  const ids = new Set<string>();
  data.siteTypes.forEach((site, index) => {
    const path = `/siteTypes/${index}`;
    if (!site.id?.trim() || ids.has(site.id))
      add(
        'INVALID_SUBCONTRACT_ID',
        `${path}/id`,
        'Site type IDs must be present and unique.',
      );
    ids.add(site.id);
    if (typeof site.name !== 'string')
      add(
        'INVALID_SUBCONTRACT_TEXT',
        `${path}/name`,
        'Site type name must be text.',
      );
    else if (requirePrices && !site.name.trim())
      add(
        'SUBCONTRACT_TEXT_REQUIRED',
        `${path}/name`,
        'Site type name is required.',
      );
    quantities(site.sites, `${path}/sites`, true);
    if (!Array.isArray(site.lines))
      add(
        'INVALID_SUBCONTRACT_LINES',
        `${path}/lines`,
        'Site type lines must be an array.',
      );
    else lines(site.lines, `${path}/lines`, true);
    if (
      data.mode === 'project' &&
      (site.lines.length || site.sites.some((value) => value > 0))
    )
      add(
        'INACTIVE_SUBCONTRACT_SITE_TYPES',
        path,
        'Populated site types cannot be hidden by Project total mode.',
      );
    if (site.sites.some((value) => value > 0) && !site.lines.length)
      add(
        'SUBCONTRACT_SITE_BOQ_REQUIRED',
        `${path}/lines`,
        'Add BOQ items before entering site deployments.',
      );
  });
  if (!issues.some((issue) => issue.code.startsWith('INVALID_'))) {
    const result = calculateSubcontractCost(data);
    if (!amount(result.total) || result.years.some((value) => !amount(value)))
      add(
        'SUBCONTRACT_TOTAL_OUT_OF_RANGE',
        '',
        'Calculated subcontract cost exceeds the supported SGD amount range.',
      );
  }
  return issues;
}
