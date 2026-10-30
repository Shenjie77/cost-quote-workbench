/** Live formulas for the simple report. Omitted source sheets retain captured inputs. */
import type { Cell, Workbook, Worksheet } from 'exceljs';
import type { CostExportSnapshot } from './contracts.ts';
import type { PersonnelExportReferences } from './export-simple-workbook.ts';
import {
  buildCostStatementRows,
  buildReconciledCostDimensionSummary,
  buildSubcontractScopeSummary,
  getCostSummaryStatementCode,
  getHQTravelSummary,
  getLabourRateFactors,
  getY1Year,
  isHQTravelResource,
  roundMoney,
  totalRowCost,
  totalRowMandays,
  yearRowMandays,
  type CostInputRow,
  type CostDimension,
} from './domain.ts';
import { isPersonnelAllowanceApplied } from './personnel-allowance.ts';
import {
  allocateHQTravel,
  buildGroupCostSummary,
  buildGroupCostSheetLayout,
  categoryStatementAmounts,
  CATEGORY_STATEMENT_SUMS,
} from './group-cost-summary.ts';
import {
  getSubcontractRateFactors,
  subcontractCostDetails,
} from './subcontract-domain.ts';
import { excelMoneyFormula as money } from '../../lib/excel-money.ts';

// ExcelJS omits a zero result from cell.value, so detect formulas by type,
// not by the presence of a result property. Number({ formula }) would be NaN.
const value = (cell: Cell) =>
  Number(cell.formula !== undefined ? (cell.result ?? 0) : (cell.value ?? 0));
const set = (cell: Cell, formula: string, result = value(cell)) => {
  if (!Number.isFinite(result))
    throw new Error(
      `Invalid formula cache at ${cell.worksheet.name}!${cell.address}`,
    );
  cell.value = { formula, result };
};
const ref = (sheet: Worksheet, address: string) =>
  `'${sheet.name.replaceAll("'", "''")}'!${address}`;
const sum = (parts: string[]) => {
  const terms: string[] = [];
  let constant = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (Number.isFinite(Number(part))) {
      constant += Number(part);
      continue;
    }
    const match = part.match(/^(.*!)([A-Z]+)(\d+)$/);
    if (!match) {
      terms.push(part);
      continue;
    }
    const first = Number(match[3]);
    let last = first;
    while (parts[i + 1] === `${match[1]}${match[2]}${last + 1}`) {
      last++;
      i++;
    }
    terms.push(last === first ? part : `${part}:${match[2]}${last}`);
  }
  if (constant) terms.push(String(constant));
  return terms.length ? `SUM(${terms.join(',')})` : '0';
};
const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
const criterion = (text: string) =>
  quote(
    `=${text.replaceAll('~', '~~').replaceAll('*', '~*').replaceAll('?', '~?')}`,
  );
const input = (cell: Cell) => {
  cell.font = { ...cell.font, color: { argb: 'FF1565C0' } };
};

type RowLinks = { base: string; travel: string; md: string; total: string };

/** Numeric keys keep Excel criteria exact, including case, wildcards and long labels. */
function dimensionKeys(snapshot: CostExportSnapshot) {
  const details = subcontractCostDetails(
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  const values: [string, string, string[]][] = [
    [
      'B',
      'AA',
      [...snapshot.costRows, ...details].map(
        (row) => row.scope.trim() || 'UNSPECIFIED',
      ),
    ],
    [
      'Y',
      'AB',
      [...snapshot.costRows, ...details].map(
        (row) => row.bu.trim() || 'UNSPECIFIED',
      ),
    ],
    [
      'Z',
      'AC',
      snapshot.costRows.map((row) =>
        snapshot.resourceTypes.find((resource) => resource.id === row.reTypeId)
          ?.category === 'subcontract'
          ? '__SUBCONTRACT__'
          : row.reTypeId,
      ),
    ],
    ['W', 'AD', snapshot.costRows.map((row) => row.groupName?.trim() || '')],
    [
      'X',
      'AE',
      [...snapshot.costRows, ...details].map(
        (row) => row.category?.trim() || '',
      ),
    ],
  ];
  return new Map(
    values.map(([source, target, labels]) => [
      source,
      {
        target,
        codes: new Map(
          [...new Set(labels)].map((label, index) => [label, index + 1]),
        ),
      },
    ]),
  );
}

/** Keep zero-valued editable accounts so later Excel edits still reconcile every summary. */
export function simpleDimensionItems(
  snapshot: CostExportSnapshot,
  dimension: CostDimension,
  subconOnly = false,
) {
  if (subconOnly)
    return buildSubcontractScopeSummary(
      snapshot.costRows,
      snapshot.resourceTypes,
      snapshot.subcontractCost,
      getY1Year(snapshot.rateSettings),
    );
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  ).totalCost;
  const items = buildReconciledCostDimensionSummary(
    snapshot.costRows,
    dimension,
    snapshot.resourceTypes,
    travel,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    { includeRisk: true },
    getY1Year(snapshot.rateSettings),
  );
  const statements = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  for (const code of [
    '2.1.2',
    '2.2.1',
    '2.3.1.2',
    '2.3.1.3',
    '2.3.3',
    '2.3.4',
    '15',
  ]) {
    if (items.some((item) => item.key === `__STATEMENT__:${code}`)) continue;
    const statement = statements.find((item) => item.code === code)!;
    items.push({
      key: `__STATEMENT__:${code}`,
      label: `${code} · ${statement.en}`,
      sites: 0,
      mandays: 0,
      cost: statement.amount,
      shareRatio: 0,
      allocationStatus: 'UNALLOCATED',
      resourceCategory: 'unmapped',
    });
  }
  return items;
}

function linkPersonnel(
  workbook: Workbook,
  snapshot: CostExportSnapshot,
  refs: PersonnelExportReferences,
) {
  const links = new Map<string, RowLinks>();
  const keys = dimensionKeys(snapshot);
  const detail = workbook.getWorksheet('Cost Detail');
  if (!detail || !refs.size) return links;
  const calc = workbook.addWorksheet('Cost Calculations', { state: 'hidden' });
  calc.getCell('A1').value =
    'Annual quantities, captured rates and exact HQ travel allocation';
  for (const [address, label] of [
    ['A2', 'Monthly allowance'],
    ['C2', 'Trips'],
    ['E2', 'Airfare / trip'],
    ['G2', 'Travel enabled'],
  ])
    calc.getCell(address).value = label;
  calc.getCell('B2').value = roundMoney(
    snapshot.travelSettings.monthlyAllowance,
  );
  calc.getCell('D2').value = snapshot.travelSettings.trips;
  calc.getCell('F2').value = roundMoney(snapshot.travelSettings.airfarePerTrip);
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  calc.getCell('H2').value = travel.enabled ? 1 : 0;
  const allocatedTravel = allocateHQTravel(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  calc.getRow(4).values = [
    'Order',
    'Scope',
    'Year',
    'Mandays',
    'Sites',
    'Loaded rate',
    'Personnel / package cost',
    'HQ months',
    'Allowance cents',
    'Allowance floor',
    'Allowance fraction',
    'Allowance rank',
    'Allowance',
    'Airfare cents',
    'Airfare floor',
    'Airfare fraction',
    'Airfare rank',
    'Airfare',
    'HQ Travel',
    'Total Cost',
    'HQ mandays',
  ];
  const rows = [...snapshot.costRows]
    .filter((row) => refs.has(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const factors = getLabourRateFactors(snapshot.rateSettings);
  const efforts = rows.flatMap((row) => {
    const resource = snapshot.resourceTypes.find(
      (item) => item.id === row.reTypeId,
    )!;
    return row.years.map((_, year) =>
      isHQTravelResource(resource, snapshot.travelSettings)
        ? {
            md: yearRowMandays(row, year),
            months:
              yearRowMandays(row, year) /
              Math.max(Number(resource.mandaysPerMonth || 21.75), 0.01),
          }
        : { md: 0, months: 0 },
    );
  });
  const months = efforts.reduce((sum, entry) => sum + entry.months, 0);
  const cachedAllocation = (amount: number, weights: number[]) => {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const exact = weights.map((weight) =>
      total ? (Math.round(amount * 100) * weight) / total : 0,
    );
    const floor = exact.map(Math.floor),
      fraction = exact.map((value, index) => value - floor[index]);
    const rank = fraction.map(
      (value, index) =>
        fraction.filter((other) => other > value).length +
        fraction.slice(0, index + 1).filter((other) => other === value).length,
    );
    const remainder =
      Math.round(amount * 100) - floor.reduce((sum, value) => sum + value, 0);
    return {
      exact,
      floor,
      fraction,
      rank,
      remainder,
      amounts: floor.map(
        (value, index) => (value + (rank[index] <= remainder ? 1 : 0)) / 100,
      ),
    };
  };
  const allowances = cachedAllocation(
    travel.allowanceCost,
    efforts.map((entry) => entry.months),
  );
  const airfare = cachedAllocation(
    travel.airfareCost,
    efforts.map((entry) => entry.md),
  );
  const last = Math.max(5, 4 + rows.length * 5);
  set(calc.getCell('B3'), `SUM(H5:H${last})`, months);
  set(calc.getCell('C3'), `ROUND(SUM(U5:U${last}),4)`, travel.hqMandays);
  set(
    calc.getCell('D3'),
    `IF(AND(H2=1,C3>0),${money('ROUND(B3,4)*B2')},0)`,
    travel.allowanceCost,
  );
  set(
    calc.getCell('E3'),
    `IF(AND(H2=1,C3>0),${money('D2*F2')},0)`,
    travel.airfareCost,
  );
  set(
    calc.getCell('F3'),
    `ROUND(D3*100,0)-SUM(J5:J${last})`,
    allowances.remainder,
  );
  set(
    calc.getCell('G3'),
    `ROUND(E3*100,0)-SUM(O5:O${last})`,
    airfare.remainder,
  );
  let n = 5;
  for (const row of rows) {
    const addresses = refs.get(row.id)!;
    const resource = snapshot.resourceTypes.find(
      (item) => item.id === row.reTypeId,
    )!;
    const hq = isHQTravelResource(resource, snapshot.travelSettings);
    const annual = [] as number[];
    for (let year = 0; year < 5; year++, n++) {
      annual.push(n);
      const mdId = `Y${year + 1}:mandays` as keyof typeof addresses;
      const sitesId = `Y${year + 1}:sites` as keyof typeof addresses;
      const costId = `Y${year + 1}:cost` as keyof typeof addresses;
      const md = yearRowMandays(row, year);
      const sites = row.years[year].sites;
      const mdPerSite = addresses.mdPerSite
        ? ref(detail, addresses.mdPerSite)
        : String(row.mdPerSite);
      const siteExpr =
        addresses[sitesId] && row.inputMode !== 'mandays'
          ? ref(detail, addresses[sitesId]!)
          : String(sites);
      if (addresses[mdId] && row.inputMode !== 'mandays')
        set(
          detail.getCell(addresses[mdId]!),
          `ROUND(${mdPerSite}*${siteExpr},4)`,
          md,
        );
      const mdExpr = addresses[mdId]
        ? ref(detail, addresses[mdId]!)
        : row.inputMode === 'mandays'
          ? String(md)
          : `ROUND(${mdPerSite}*${siteExpr},4)`;
      calc.getCell(`A${n}`).value = n - 4;
      calc.getCell(`B${n}`).value = row.scope.trim() || 'UNSPECIFIED';
      calc.getCell(`C${n}`).value = `Y${year + 1}`;
      calc.getCell(`V${n}`).value = resource.category;
      calc.getCell(`W${n}`).value = row.groupName?.trim() || '';
      calc.getCell(`X${n}`).value = row.category?.trim() || '';
      calc.getCell(`Y${n}`).value = row.bu.trim() || 'UNSPECIFIED';
      calc.getCell(`Z${n}`).value =
        resource.category === 'subcontract' ? '__SUBCONTRACT__' : row.reTypeId;
      for (const [source, key] of keys)
        calc.getCell(`${key.target}${n}`).value = key.codes.get(
          calc.getCell(`${source}${n}`).text,
        )!;
      set(calc.getCell(`D${n}`), mdExpr, md);
      set(calc.getCell(`E${n}`), siteExpr, sites);
      const rate =
        resource.mandayRate *
        (factors[year] ?? 1) *
        (isPersonnelAllowanceApplied(resource, snapshot.rateSettings)
          ? 1.03
          : 1);
      calc.getCell(`F${n}`).value = rate;
      if (resource.category === 'internal')
        set(calc.getCell(`G${n}`), money(`D${n}*F${n}`), row.years[year].cost);
      else if (addresses[costId])
        set(
          calc.getCell(`G${n}`),
          ref(detail, addresses[costId]!),
          row.years[year].cost,
        );
      else calc.getCell(`G${n}`).value = row.years[year].cost;
      set(
        calc.getCell(`H${n}`),
        hq
          ? `D${n}/${Math.max(Number(resource.mandaysPerMonth || 21.75), 0.01)}`
          : '0',
        hq ? md / Math.max(Number(resource.mandaysPerMonth || 21.75), 0.01) : 0,
      );
      set(calc.getCell(`U${n}`), hq ? `D${n}` : '0', hq ? md : 0);
      const index = n - 5;
      set(
        calc.getCell(`I${n}`),
        `IF($B$3>0,$D$3*100*H${n}/$B$3,0)`,
        allowances.exact[index],
      );
      set(calc.getCell(`J${n}`), `INT(I${n})`, allowances.floor[index]);
      set(calc.getCell(`K${n}`), `I${n}-J${n}`, allowances.fraction[index]);
      set(
        calc.getCell(`L${n}`),
        `COUNTIF($K$5:$K$${last},">"&K${n})+COUNTIF($K$5:K${n},K${n})`,
        allowances.rank[index],
      );
      set(
        calc.getCell(`M${n}`),
        `(J${n}+IF(L${n}<=$F$3,1,0))/100`,
        allowances.amounts[index],
      );
      set(
        calc.getCell(`N${n}`),
        `IF($C$3>0,$E$3*100*U${n}/$C$3,0)`,
        airfare.exact[index],
      );
      set(calc.getCell(`O${n}`), `INT(N${n})`, airfare.floor[index]);
      set(calc.getCell(`P${n}`), `N${n}-O${n}`, airfare.fraction[index]);
      set(
        calc.getCell(`Q${n}`),
        `COUNTIF($P$5:$P$${last},">"&P${n})+COUNTIF($P$5:P${n},P${n})`,
        airfare.rank[index],
      );
      set(
        calc.getCell(`R${n}`),
        `(O${n}+IF(Q${n}<=$G$3,1,0))/100`,
        airfare.amounts[index],
      );
      const rowTravel = allocatedTravel.get(row.id)?.[year] ?? 0;
      set(calc.getCell(`S${n}`), money(`M${n}+R${n}`), rowTravel);
      set(
        calc.getCell(`T${n}`),
        money(`G${n}+S${n}`),
        roundMoney(row.years[year].cost + rowTravel),
      );
      if (addresses[costId] && resource.category === 'internal')
        set(
          detail.getCell(addresses[costId]!),
          ref(calc, `T${n}`),
          roundMoney(row.years[year].cost + rowTravel),
        );
      for (const id of [
        row.inputMode === 'mandays' ? mdId : sitesId,
        'mdPerSite' as const,
      ])
        if (addresses[id] && !detail.getCell(addresses[id]!).formula)
          input(detail.getCell(addresses[id]!));
    }
    const annualSum = (col: string) =>
      `SUM(${ref(calc, `${col}${annual[0]}:${col}${annual.at(-1)}`)})`;
    const total = annualSum('T');
    const base = annualSum('G');
    const travelExpr = annualSum('S');
    const md = `ROUND(${annualSum('D')},4)`;
    links.set(row.id, { base, total, travel: travelExpr, md });
    if (addresses.totalCost)
      set(
        detail.getCell(addresses.totalCost),
        total,
        roundMoney(
          totalRowCost(row) +
            (allocatedTravel.get(row.id) ?? []).reduce((a, b) => a + b, 0),
        ),
      );
    if (addresses.totalMd)
      set(detail.getCell(addresses.totalMd), md, totalRowMandays(row));
    if (addresses.totalSites)
      set(
        detail.getCell(addresses.totalSites),
        sum(annual.map((i) => ref(calc, `E${i}`))),
        row.years.reduce((a, b) => a + b.sites, 0),
      );
  }
  return links;
}

export function linkSubcontractFormulas(
  workbook: Workbook,
  snapshot: CostExportSnapshot,
) {
  const sheet = workbook.getWorksheet('Subcon Detail');
  const keys = dimensionKeys(snapshot);
  const details = subcontractCostDetails(
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  const sites = workbook.getWorksheet('Subcon Site Types');
  const rates = workbook.getWorksheet('Subcon Rates');
  const factors = getSubcontractRateFactors(
    snapshot.subcontractCost?.rateSettings,
    getY1Year(snapshot.rateSettings),
  );
  const startYear = getY1Year(snapshot.rateSettings);
  if (rates && startYear)
    for (let y = 0; y < 5; y++) {
      const current = rates.getCell(6, 4 + y),
        uplift = rates.getCell(5, 4 + y).address;
      set(
        current,
        `IF(${startYear + y}<=$B$5,1,${y ? rates.getCell(6, 3 + y).address : '1'}*(1+${uplift}/100)^${y ? '1' : `MAX(0,${startYear}-$B$5)`})`,
        factors[y],
      );
      input(rates.getCell(5, 4 + y));
    }
  const siteIndexes = [
    ...(snapshot.subcontractCost?.lines ?? []).map(() => -1),
    ...(snapshot.subcontractCost?.mode === 'site-types'
      ? snapshot.subcontractCost.siteTypes.flatMap((site, index) =>
          site.lines.map(() => index),
        )
      : []),
  ];
  if (!sheet) return details.map((line) => String(line.total));
  sheet.getCell('U4').value = 'Base cost per site';
  sheet.getColumn('U').hidden = true;
  sheet.getCell('V4').value = 'Scope key';
  sheet.getCell('W4').value = 'BU key';
  sheet.getCell('X4').value = 'Category key';
  sheet.getColumn('V').hidden = true;
  sheet.getColumn('W').hidden = true;
  sheet.getColumn('X').hidden = true;
  details.forEach((line, index) => {
    const n = index + 5;
    const siteIndex = siteIndexes[index];
    const site =
      siteIndex >= 0
        ? snapshot.subcontractCost!.siteTypes[siteIndex]
        : undefined;
    set(
      sheet.getCell(`U${n}`),
      money(`F${n}*G${n}`),
      site
        ? roundMoney((line.unitPrice ?? 0) * (line.quantityPerSite ?? 0))
        : 0,
    );
    sheet.getCell(`V${n}`).value = keys
      .get('B')!
      .codes.get(line.scope.trim() || 'UNSPECIFIED')!;
    sheet.getCell(`W${n}`).value = keys
      .get('Y')!
      .codes.get(line.bu.trim() || 'UNSPECIFIED')!;
    sheet.getCell(`X${n}`).value = keys
      .get('X')!
      .codes.get(line.category?.trim() || '')!;
    for (let y = 0; y < 5; y++) {
      const quantity = sheet.getCell(n, 10 + y * 2),
        cost = sheet.getCell(n, 11 + y * 2);
      const factor = rates
        ? ref(rates, rates.getCell(6, 4 + y).address)
        : String(factors[y]);
      const siteCount = site
        ? sites
          ? ref(sites, sites.getCell(5 + siteIndex, 4 + y * 2).address)
          : String(site.sites[y])
        : '';
      if (site)
        set(quantity, `ROUND(G${n}*${siteCount},4)`, line.quantities[y]);
      else input(quantity);
      const expression = site
        ? `U${n}*${siteCount}*${factor}`
        : `F${n}*${quantity.address}*${factor}`;
      set(cost, money(expression), line.years[y]);
    }
    set(
      sheet.getCell(`H${n}`),
      sum([10, 12, 14, 16, 18].map((c) => sheet.getCell(n, c).address)),
      line.quantities.reduce((a, b) => a + b, 0),
    );
    set(
      sheet.getCell(`I${n}`),
      `SUM(K${n},M${n},O${n},Q${n},S${n})`,
      line.total,
    );
    input(sheet.getCell(`F${n}`));
    if (site) input(sheet.getCell(`G${n}`));
  });
  for (const column of ['I', 'K', 'M', 'O', 'Q', 'S'])
    set(
      sheet.getCell(`${column}${sheet.rowCount}`),
      details.length ? `SUM(${column}5:${column}${sheet.rowCount - 1})` : '0',
    );
  if (sites)
    snapshot.subcontractCost?.siteTypes.forEach((site, index) => {
      const matches = details.flatMap((_, i) =>
        siteIndexes[i] === index ? [i + 5] : [],
      );
      set(
        sites.getCell(`B${index + 5}`),
        sum(matches.map((n) => ref(sheet, `U${n}`))),
      );
      for (let y = 0; y < 5; y++) {
        set(
          sites.getCell(5 + index, 5 + y * 2),
          sum(
            matches.map((n) =>
              ref(sheet, sheet.getCell(n, 11 + y * 2).address),
            ),
          ),
        );
        input(sites.getCell(5 + index, 4 + y * 2));
      }
      set(
        sites.getCell(`C${index + 5}`),
        `SUM(E${index + 5},G${index + 5},I${index + 5},K${index + 5},M${index + 5})`,
      );
    });
  return details.map((_, index) => ref(sheet, `I${index + 5}`));
}

/** Same shared chain for standalone Simple Cost and combined internal quotations. */
export function linkSimpleCostFormulas(
  workbook: Workbook,
  snapshot: CostExportSnapshot,
  refs: PersonnelExportReferences,
) {
  const links = linkPersonnel(workbook, snapshot, refs);
  const keys = dimensionKeys(snapshot);
  const calc = workbook.getWorksheet('Cost Calculations');
  const aggregate = (column: string, criteria: [string, string][] = []) =>
    calc
      ? criteria.length
        ? `SUMIFS(${ref(calc, `${column}5:${column}${calc.rowCount}`)},${criteria
            .flatMap(([col, value]) => {
              const key = keys.get(col);
              const source = key?.target ?? col;
              return [
                ref(calc, `${source}5:${source}${calc.rowCount}`),
                key ? String(key.codes.get(value) ?? -1) : criterion(value),
              ];
            })
            .join(',')})`
        : `SUM(${ref(calc, `${column}5:${column}${calc.rowCount}`)})`
      : '0';
  const detail = workbook.getWorksheet('Cost Detail');
  if (detail && calc && refs.size) {
    const addresses = refs.values().next().value!;
    for (const [id, address] of Object.entries(addresses)) {
      const annual = id.match(/^Y([1-5]):(sites|mandays|cost)$/);
      const column =
        id === 'totalCost'
          ? 'T'
          : id === 'totalMd'
            ? 'D'
            : id === 'totalSites'
              ? 'E'
              : annual
                ? annual[2] === 'sites'
                  ? 'E'
                  : annual[2] === 'mandays'
                    ? 'D'
                    : 'T'
                : undefined;
      if (column)
        set(
          detail.getCell(`${address!.replace(/\d+$/, '')}${detail.rowCount}`),
          aggregate(column, annual ? [['C', `Y${annual[1]}`]] : []),
        );
    }
  }
  const legacy = workbook.getWorksheet('Legacy Subcon');
  const legacyRows = snapshot.costRows.filter(
    (row) =>
      snapshot.resourceTypes.find((r) => r.id === row.reTypeId)?.category ===
      'subcontract',
  );
  if (legacy)
    legacyRows.forEach((row, i) => {
      const n = i + 5;
      set(legacy.getCell(`D${n}`), `SUM(E${n}:I${n})`, totalRowCost(row));
      legacy.getCell(`K${n}`).value = keys
        .get('B')!
        .codes.get(row.scope.trim() || 'UNSPECIFIED')!;
      legacy.getCell(`L${n}`).value = keys
        .get('Y')!
        .codes.get(row.bu.trim() || 'UNSPECIFIED')!;
      legacy.getCell(`M${n}`).value = keys
        .get('X')!
        .codes.get(row.category?.trim() || '')!;
      legacy.getColumn('K').hidden = true;
      legacy.getColumn('L').hidden = true;
      legacy.getColumn('M').hidden = true;
      links.set(row.id, {
        base: ref(legacy, `D${n}`),
        total: ref(legacy, `D${n}`),
        travel: '0',
        md: String(totalRowMandays(row)),
      });
    });
  if (legacy)
    for (let c = 4; c <= 9; c++)
      set(
        legacy.getCell(legacy.rowCount, c),
        legacyRows.length
          ? `SUM(${legacy.getCell(5, c).address}:${legacy.getCell(legacy.rowCount - 1, c).address})`
          : '0',
      );
  const subconRefs = linkSubcontractFormulas(workbook, snapshot);
  const subcon = workbook.getWorksheet('Subcon Detail');
  const details = subcontractCostDetails(
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const statementRows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  const statement = workbook.getWorksheet('Cost Statement');
  const cells = new Map(
    statementRows.map((row, index) => [row.code, `B${index + 5}`]),
  );
  const rowBase = (row: CostInputRow) =>
    links.get(row.id)?.base ?? String(totalRowCost(row));
  const rowMd = (row: CostInputRow) =>
    links.get(row.id)?.md ?? String(totalRowMandays(row));
  const account = (code: string) =>
    statement
      ? ref(statement, cells.get(code)!)
      : String(statementRows.find((row) => row.code === code)?.amount ?? 0);
  if (statement) {
    const sums: Record<string, string[]> = {
      '2': ['2.1.2', '2.2', '2.3'],
      '2.2': ['2.2.1'],
      '2.2.1': ['2.2.1.2', '2.2.1.3'],
      '2.3': ['2.3.1', '2.3.2', '2.3.3', '2.3.4'],
      '2.3.1': ['2.3.1.1', '2.3.1.2', '2.3.1.3'],
      '2.3.4': ['2.3.4.1', '2.3.4.2'],
      '': ['2', '15'],
    };
    for (const row of statementRows) {
      const cell = statement.getCell(cells.get(row.code)!);
      if (sums[row.code])
        set(
          cell,
          sum(sums[row.code].map((code) => cells.get(code)!)),
          row.amount,
        );
      else if (row.code === '2.3.1.1' && calc)
        set(
          cell,
          sum([
            aggregate('G', [['V', 'internal']]),
            ...snapshot.costRows
              .filter(
                (row) =>
                  !refs.has(row.id) &&
                  snapshot.resourceTypes.find((r) => r.id === row.reTypeId)
                    ?.category === 'internal',
              )
              .map(rowBase),
          ]),
          row.amount,
        );
      else if (
        row.code === '2.3.2' &&
        (links.size || workbook.getWorksheet('Subcon Detail'))
      )
        set(
          cell,
          sum([
            calc ? aggregate('G', [['V', 'subcontract']]) : '0',
            legacy
              ? ref(legacy, `D${legacy.rowCount}`)
              : sum(legacyRows.filter((row) => !refs.has(row.id)).map(rowBase)),
            subcon ? ref(subcon, `I${subcon.rowCount}`) : sum(subconRefs),
          ]),
          row.amount,
        );
      else if (row.code === '2.3.1.3' && calc)
        set(cell, aggregate('S'), row.amount);
      else if (row.manualKey) input(cell);
      if (
        row.code === '2.3.4.2' &&
        snapshot.manualCosts.otherServiceRate !== undefined
      ) {
        statement.getCell('A3').value = 'EHS Rate';
        statement.getRow(3).height = 24;
        statement.getCell('A3').alignment = { vertical: 'middle' };
        statement.getCell('B3').alignment = {
          vertical: 'middle',
          horizontal: 'right',
        };
        statement.getCell('B3').value = snapshot.manualCosts.otherServiceRate;
        statement.getCell('B3').numFmt = '0.00%';
        input(statement.getCell('B3'));
        set(
          cell,
          money(
            `SUM(${['2.3.1', '2.3.2', '2.3.3'].map((code) => cells.get(code)).join(',')})*$B$3`,
          ),
          row.amount,
        );
      }
    }
  }
  const matches = (row: CostInputRow, dimension: CostDimension, key: string) =>
    dimension === 'scope'
      ? (row.scope.trim() || 'UNSPECIFIED') === key
      : dimension === 'bu'
        ? (row.bu.trim() || 'UNSPECIFIED') === key
        : (snapshot.resourceTypes.find((r) => r.id === row.reTypeId)
            ?.category === 'subcontract'
            ? '__SUBCONTRACT__'
            : row.reTypeId) === key;
  for (const [name, dimension, subconOnly] of [
    ['Summary Scope', 'scope', false],
    ['Summary BU', 'bu', false],
    ['Summary RE Type', 'resourceType', false],
    ['Summary Subcon', 'scope', true],
  ] as const) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) continue;
    const items = simpleDimensionItems(snapshot, dimension, subconOnly);
    const total = items.length + 5;
    items.forEach((item, index) => {
      const n = index + 5;
      const code = item.key.startsWith('__STATEMENT__:')
        ? getCostSummaryStatementCode(item.key)
        : undefined;
      const rows = (subconOnly ? legacyRows : snapshot.costRows).filter((row) =>
        matches(row, dimension, item.key),
      );
      const sub = details.flatMap((line, i) =>
        (
          dimension === 'scope'
            ? (line.scope.trim() || 'UNSPECIFIED') === item.key
            : dimension === 'bu'
              ? (line.bu.trim() || 'UNSPECIFIED') === item.key
              : item.key === '__SUBCONTRACT__'
        )
          ? [subconRefs[i]]
          : [],
      );
      const subExpression = subcon
        ? dimension === 'resourceType'
          ? item.key === '__SUBCONTRACT__'
            ? ref(subcon, `I${subcon.rowCount}`)
            : '0'
          : `SUMIF(${ref(subcon, `${dimension === 'scope' ? 'V' : 'W'}5:${dimension === 'scope' ? 'V' : 'W'}${subcon.rowCount - 1}`)},${keys.get(dimension === 'scope' ? 'B' : 'Y')!.codes.get(item.key) ?? -1},${ref(subcon, `I5:I${subcon.rowCount - 1}`)})`
        : sum(sub);
      const legacyExpression = legacy
        ? dimension === 'resourceType'
          ? item.key === '__SUBCONTRACT__'
            ? ref(legacy, `D${legacy.rowCount}`)
            : '0'
          : `SUMIF(${ref(legacy, `${dimension === 'scope' ? 'K' : 'L'}5:${dimension === 'scope' ? 'K' : 'L'}${legacy.rowCount - 1}`)},${keys.get(dimension === 'scope' ? 'B' : 'Y')!.codes.get(item.key) ?? -1},${ref(legacy, `D5:D${legacy.rowCount - 1}`)})`
        : '0';
      const criteria: [string, string][] = [
        [
          dimension === 'scope' ? 'B' : dimension === 'bu' ? 'Y' : 'Z',
          item.key,
        ],
        ...(subconOnly ? [['V', 'subcontract'] as [string, string]] : []),
      ];
      set(
        sheet.getCell(`D${n}`),
        code
          ? account(code)
          : sum([
              aggregate('G', criteria),
              ...rows
                .filter(
                  (row) =>
                    !refs.has(row.id) &&
                    !legacyRows.some(
                      (legacyRow) => legacy && legacyRow.id === row.id,
                    ),
                )
                .map(rowBase),
              legacyExpression,
              subExpression,
            ]),
        item.cost,
      );
      set(sheet.getCell(`B${n}`), `D${n}`, item.cost);
      set(
        sheet.getCell(`C${n}`),
        `ROUND(${sum([aggregate('D', criteria), ...rows.filter((row) => !refs.has(row.id)).map(rowMd)])},4)`,
        item.mandays,
      );
      sheet.getCell(`C${n}`).numFmt = '#,##0.####" MD"';
      set(
        sheet.getCell(`E${n}`),
        `IF(D${total}>0,D${n}/D${total},0)`,
        item.shareRatio,
      );
    });
    for (const col of ['C', 'D'])
      set(
        sheet.getCell(`${col}${total}`),
        items.length ? `SUM(${col}5:${col}${total - 1})` : '0',
      );
    set(sheet.getCell(`E${total}`), `IF(D${total}>0,1,0)`);
    sheet.getCell('A3').value =
      `${subconOnly ? 'Cost Statement 2.3.2 · ' : ''}Live formulas use included detail sheets and Cost Statement. Omitted inputs retain their captured values.`;
  }
  const group = workbook.getWorksheet('Summary Group');
  const items = buildGroupCostSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  const layout = buildGroupCostSheetLayout(items);
  const categories = layout.sections;
  const categoryCalc = workbook.addWorksheet('Category Calculations', {
    state: 'hidden',
  });
  categoryCalc.getRow(4).values = [
    'Category',
    'Personnel',
    'HQ Travel',
    'Subcontract',
    'Direct cost',
    'Equipment',
    'Inland Logistics',
    'Warehousing',
    'Non In-house Labour',
    'Settlement',
    'Car Fee',
    'EHS base',
    'EHS',
    'Before risk',
    'Default / saved risk share',
    'Risk',
    'Active risk weight',
  ];
  const lastCategory = categories.length + 4;
  const allocations: Record<string, string> = {
    '2.3.1.1': 'B',
    '2.3.1.3': 'C',
    '2.3.2': 'D',
    '2.1.2': 'F',
    '2.2.1.2': 'G',
    '2.2.1.3': 'H',
    '2.3.1.2': 'I',
    '2.3.3': 'J',
    '2.3.4.1': 'K',
    '2.3.4.2': 'M',
    '15': 'P',
  };
  const allocationFormula = (
    amount: string,
    weightColumn: string,
    row: number,
  ) => {
    const totalWeight = `SUM($${weightColumn}$5:$${weightColumn}$${lastCategory})`;
    const cumulative = (end: number) =>
      end < 5
        ? '0'
        : end === lastCategory
          ? '1'
          : `IF(${totalWeight}>0,SUM($${weightColumn}$5:$${weightColumn}$${end})/${totalWeight},${end - 4}/${categories.length})`;
    return `(ROUND(ROUND((${amount})*100,0)*(${cumulative(row)}),0)-ROUND(ROUND((${amount})*100,0)*(${cumulative(row - 1)}),0))/100`;
  };
  categories.forEach((section, index) => {
    const n = index + 5;
    const category = section.category ?? '';
    const amounts = categoryStatementAmounts(section.items);
    const categoryKey = keys.get('X')!.codes.get(category) ?? -1;
    const criteria: [string, string][] = [
      ['X', category],
      ['V', 'internal'],
    ];
    categoryCalc.getCell(`A${n}`).value = category || 'Uncategorized';
    set(
      categoryCalc.getCell(`B${n}`),
      calc ? aggregate('G', criteria) : String(amounts['2.3.1.1'] ?? 0),
      amounts['2.3.1.1'] ?? 0,
    );
    set(
      categoryCalc.getCell(`C${n}`),
      calc ? aggregate('S', criteria) : String(amounts['2.3.1.3'] ?? 0),
      amounts['2.3.1.3'] ?? 0,
    );
    const legacyItems = legacyRows.filter(
      (row) => (row.category?.trim() || '') === category,
    );
    set(
      categoryCalc.getCell(`D${n}`),
      sum([
        calc
          ? aggregate('G', [
              ['V', 'subcontract'],
              ['X', category],
            ])
          : '0',
        legacy
          ? `SUMIF(${ref(legacy, `M5:M${legacy.rowCount - 1}`)},${categoryKey},${ref(legacy, `D5:D${legacy.rowCount - 1}`)})`
          : sum(legacyItems.filter((row) => !refs.has(row.id)).map(rowBase)),
        subcon
          ? `SUMIF(${ref(subcon, `X5:X${subcon.rowCount - 1}`)},${categoryKey},${ref(subcon, `I5:I${subcon.rowCount - 1}`)})`
          : sum(
              details.flatMap((line, i) =>
                (line.category?.trim() || '') === category
                  ? [subconRefs[i]]
                  : [],
              ),
            ),
      ]),
      amounts['2.3.2'] ?? 0,
    );
    const direct =
      (amounts['2.3.1.1'] ?? 0) +
      (amounts['2.3.1.3'] ?? 0) +
      (amounts['2.3.2'] ?? 0);
    set(categoryCalc.getCell(`E${n}`), `SUM(B${n}:D${n})`, direct);
    for (const code of [
      '2.1.2',
      '2.2.1.2',
      '2.2.1.3',
      '2.3.1.2',
      '2.3.3',
      '2.3.4.1',
    ])
      set(
        categoryCalc.getCell(`${allocations[code]}${n}`),
        allocationFormula(account(code), 'E', n),
        amounts[code] ?? 0,
      );
    set(
      categoryCalc.getCell(`L${n}`),
      `SUM(B${n}:D${n},I${n}:J${n})`,
      (amounts['2.3.1'] ?? 0) +
        (amounts['2.3.2'] ?? 0) +
        (amounts['2.3.3'] ?? 0),
    );
    set(
      categoryCalc.getCell(`M${n}`),
      allocationFormula(account('2.3.4.2'), 'L', n),
      amounts['2.3.4.2'] ?? 0,
    );
    set(
      categoryCalc.getCell(`N${n}`),
      `SUM(E${n}:K${n},M${n})`,
      amounts['2'] ?? 0,
    );
    const riskEntry = section.entries.find(
      ({ item }) => item.accountCode === '15',
    )!;
    const weight = riskEntry.item.riskWeight ?? 0;
    const saved = snapshot.manualCosts.categoryRiskWeights;
    const hasSaved = categories.some((item) =>
      saved?.some(
        (entry) => entry.category === item.category && entry.weight > 0,
      ),
    );
    if (hasSaved) categoryCalc.getCell(`O${n}`).value = weight;
    else
      set(
        categoryCalc.getCell(`O${n}`),
        `IF(SUM($N$5:$N$${lastCategory})>0,N${n}/SUM($N$5:$N$${lastCategory}),1/${categories.length})`,
        weight,
      );
    if (group) {
      if (hasSaved) group.getCell(`M${riskEntry.rowNumber}`).value = weight;
      else
        set(
          group.getCell(`M${riskEntry.rowNumber}`),
          ref(categoryCalc, `O${n}`),
          weight,
        );
      group.getCell(`M${riskEntry.rowNumber}`).numFmt = '0.00%';
      input(group.getCell(`M${riskEntry.rowNumber}`));
    }
    set(
      categoryCalc.getCell(`Q${n}`),
      group ? ref(group, `M${riskEntry.rowNumber}`) : `O${n}`,
      weight,
    );
    set(
      categoryCalc.getCell(`P${n}`),
      allocationFormula(account('15'), 'Q', n),
      amounts['15'] ?? 0,
    );
    if (statement) {
      const col = statement.getColumn(index + 3).letter;
      for (const item of statementRows) {
        const row = Number(cells.get(item.code)!.slice(1));
        const formula = CATEGORY_STATEMENT_SUMS[item.code]
          ? sum(
              CATEGORY_STATEMENT_SUMS[item.code].map(
                (code) => `${col}${cells.get(code)!.slice(1)}`,
              ),
            )
          : allocations[item.code]
            ? ref(categoryCalc, `${allocations[item.code]}${n}`)
            : '0';
        set(
          statement.getCell(`${col}${row}`),
          formula,
          amounts[item.code] ?? 0,
        );
      }
    }
    if (!group) return;
    for (const { item, rowNumber: r } of section.entries) {
      if (item.kind === 'Group') {
        const criteria: [string, string][] = [
          ['W', item.groupName ?? ''],
          ['X', category],
          ['V', 'internal'],
        ];
        for (const [target, source, cached] of [
          ['D', 'D', item.mandays],
          ['E', 'G', item.personnel],
          ['F', 'S', item.travel],
        ] as const)
          set(
            group.getCell(`${target}${r}`),
            calc ? aggregate(source, criteria) : String(cached),
            cached,
          );
      } else {
        const code = item.accountCode!;
        const col =
          code === '2.3.2'
            ? 'G'
            : code === '2.3.4'
              ? 'H'
              : code === '15'
                ? 'I'
                : 'J';
        set(
          group.getCell(`${col}${r}`),
          CATEGORY_STATEMENT_SUMS[code]
            ? sum(
                CATEGORY_STATEMENT_SUMS[code].map((child) =>
                  ref(categoryCalc, `${allocations[child]}${n}`),
                ),
              )
            : ref(categoryCalc, `${allocations[code]}${n}`),
          item.total,
        );
      }
      set(group.getCell(`K${r}`), `SUM(E${r}:J${r})`, item.total);
      set(
        group.getCell(`L${r}`),
        `IF(K${layout.totalRow}>0,K${r}/K${layout.totalRow},0)`,
        item.share,
      );
    }
    const fields = [
      ['D', 'mandays'],
      ['E', 'personnel'],
      ['F', 'travel'],
      ['G', 'subcontract'],
      ['H', 'ehs'],
      ['I', 'risk'],
      ['J', 'other'],
      ['K', 'total'],
    ] as const;
    for (const [col, key] of fields)
      set(
        group.getCell(`${col}${section.subtotalRow}`),
        col === 'J'
          ? `SUM(${ref(categoryCalc, `F${n}:J${n}`)})`
          : col === 'K'
            ? `SUM(E${section.subtotalRow}:J${section.subtotalRow})`
            : `SUM(${col}${section.entries[0].rowNumber}:${col}${section.entries.at(-1)!.rowNumber})`,
        section.totals[key],
      );
    set(
      group.getCell(`L${section.subtotalRow}`),
      `IF(K${layout.totalRow}>0,K${section.subtotalRow}/K${layout.totalRow},0)`,
      section.totals.share,
    );
  });
  if (group) {
    group.getCell('M4').value = 'Risk allocation %';
    group.getColumn('M').width = 20;
    for (const [col, key] of [
      ['D', 'mandays'],
      ['E', 'personnel'],
      ['F', 'travel'],
      ['G', 'subcontract'],
      ['H', 'ehs'],
      ['I', 'risk'],
      ['J', 'other'],
      ['K', 'total'],
    ] as const)
      set(
        group.getCell(`${col}${layout.totalRow}`),
        `SUMIF($C$5:$C$${layout.totalRow - 1},"Subtotal",${col}5:${col}${layout.totalRow - 1})`,
        layout.totals[key],
      );
    set(
      group.getCell(`L${layout.totalRow}`),
      `IF(K${layout.totalRow}>0,1,0)`,
      layout.totals.share,
    );
    group.getCell('A3').value =
      'Category costs include subcontract, EHS and allocated risk. Blue Risk allocation % cells override the default cost proportions. Shares are normalized; each project account is counted once.';
  }
  workbook.calcProperties.fullCalcOnLoad = true;
  return {
    total: statementRows.at(-1)!.amount,
    reference: statement
      ? ref(statement, cells.get('')!)
      : String(statementRows.at(-1)!.amount),
  };
}
