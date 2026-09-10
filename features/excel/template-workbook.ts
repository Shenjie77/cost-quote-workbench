/** Fill only explicit cells and preallocated table columns in an existing XLSX. */
import {
  yearRowMandays,
  totalRowMandays,
  totalRowCost,
  getCostStatementValues,
  getHQTravelSummary,
} from '../cost/domain.ts';
import { validateCostExportSnapshot } from '../cost/validation.ts';
import { validatedQuoteInput } from '../quote/validated-input.ts';
import { subcontractCostDetails } from '../cost/subcontract-domain.ts';
import { workbookHash } from '../cost/import-workbook.ts';
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
export type TemplateMapping = {
  version: string;
  purpose: 'cost' | 'quote';
  cells: { sheet: string; cell: string; field: string }[];
  tables: {
    sheet: string;
    startRow: number;
    capacity: number;
    dataset: 'costRows' | 'assumptions' | 'quoteLines';
    columns: Record<string, number>;
  }[];
};
export function templateData(
  workspace: WorkbenchWorkspace,
  purpose: 'cost' | 'quote',
  quoteNumber = '',
) {
  const version = workspace.costVersions.find(
    (v) => v.code === workspace.activeVersion,
  );
  if (!version) throw new TypeError('Cost version missing');
  const resources = version.resourceTypes || workspace.resourceTypes;
  const snapshot = {
    schemaVersion: '2.0.0' as const,
    exportedAt: new Date().toISOString(),
    project: workspace.project,
    costVersion: { code: version.code, status: version.state },
    rateSettings: version.rateSettings,
    travelSettings: version.travelSettings,
    resourceTypes: resources,
    costRows: version.costRows,
    manualCosts: version.manualCosts,
    subcontractCost: version.subcontractCost,
  };
  const issues = validateCostExportSnapshot(snapshot).filter(
    (i) => i.severity === 'error',
  );
  if (issues.length)
    throw new TypeError(issues.map((i) => i.message).join('; '));
  const costs = getCostStatementValues(
    version.costRows,
    resources,
    getHQTravelSummary(version.costRows, resources, version.travelSettings)
      .totalCost,
    version.manualCosts,
    version.subcontractCost,
  );
  const quote =
    purpose === 'quote'
      ? validatedQuoteInput(workspace, quoteNumber)
      : undefined;
  const scalars: Record<string, string | number> = {
    'project.id': workspace.project.id,
    'project.name': workspace.project.name,
    'project.client': workspace.project.client,
    'project.currency': workspace.project.currency,
    proposalNumber: workspace.ssr?.proposalNumber || '',
    'cost.version': version.code,
    'cost.total': costs.totalWithRisk,
    'cost.service': costs.service,
    'cost.subcontract': costs.subcontract,
    'cost.mandays': version.costRows.reduce(
      (n, r) => n + totalRowMandays(r),
      0,
    ),
    'quote.number': quoteNumber,
  };
  if (quote) {
    for (const key of [
      'documentTitle',
      'paymentTerms',
      'termsAndConditions',
      'validityDays',
    ] as const)
      scalars[`quote.${key}`] = quote.template[key];
    for (const field of Object.keys(scalars))
      if (field.startsWith('cost.')) delete scalars[field];
    for (const key of ['quoteBeforeTax', 'gstAmount', 'quoteAfterTax'] as const)
      scalars[`quote.${key}`] = quote.pricing[key];
  }
  const costRows: Record<string, string | number>[] = version.costRows.map(
    (r) => ({
      scope: r.scope,
      bu: r.bu,
      resource: resources.find((x) => x.id === r.reTypeId)?.code || r.reTypeId,
      inputMode: r.inputMode || 'sites',
      mandays: totalRowMandays(r),
      cost: totalRowCost(r),
      source: r.source
        ? `${r.source.fileName} / ${r.source.sheet} / ${r.source.row}`
        : 'Manual',
      ...Object.fromEntries(
        r.years.flatMap((y, i) => [
          [`${y.bucket}.sites`, y.sites],
          [`${y.bucket}.mandays`, yearRowMandays(r, i)],
          [`${y.bucket}.cost`, r.years[i].cost],
        ]),
      ),
    }),
  );
  const assumptions: Record<string, string | number>[] =
    workspace.quoteAssumptions
      .filter((a) => a.included)
      // Customer mappings expose primary text only; internal mappings stay compatible.
      .map((assumption) => {
        const fields: Record<string, string | number> = {
          id: assumption.id,
          text: assumption.text,
        };
        if (purpose === 'cost') fields.textZh = assumption.textZh;
        return fields;
      });
  costRows.push(
    ...subcontractCostDetails(version.subcontractCost).map((line) => ({
      scope: line.description,
      bu: line.bu,
      resource: 'Subcontract',
      inputMode: 'quantity',
      unit: line.unit,
      unitPrice: line.unitPrice ?? 0,
      siteType: line.siteType,
      mandays: 0,
      cost: line.total,
      source: 'Subcon',
      ...Object.fromEntries(
        line.years.flatMap((amount, index) => [
          [`Y${index + 1}.quantity`, line.quantities[index]],
          [`Y${index + 1}.sites`, line.sites[index]],
          [`Y${index + 1}.mandays`, 0],
          [`Y${index + 1}.cost`, amount],
        ]),
      ),
    })),
  );
  const quoteLines: Record<string, string | number>[] = quote
    ? workspace.pricing.lineMode && workspace.pricing.lineMode !== 'single'
      ? (quote.lines ?? []).map(({ id: _id, description, ...line }) => ({
          ...line,
          description,
          scope: description,
        }))
      : [
          {
            scope: workspace.ssr?.scopeBrief || workspace.project.name,
            amount: quote.pricing.quoteBeforeTax,
          },
        ]
    : [];
  return {
    scalars,
    datasets: { costRows, assumptions, quoteLines },
    snapshot,
    quote,
  };
}
export async function fillTemplateWorkbook(
  bytes: Uint8Array,
  mapping: TemplateMapping,
  workspace: WorkbenchWorkspace,
  quoteNumber = '',
) {
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw new TypeError('Template exceeds 20 MB');
  const source = templateData(workspace, mapping.purpose, quoteNumber);
  if (mapping.purpose === 'quote') {
    const fields = new Set(mapping.cells.map((c) => c.field));
    const required = [
      'quote.number',
      'quote.quoteBeforeTax',
      'quote.gstAmount',
      'quote.quoteAfterTax',
      'quote.paymentTerms',
      'quote.validityDays',
    ];
    if (source.quote?.template.termsAndConditions)
      required.push('quote.termsAndConditions');
    for (const field of required)
      if (!fields.has(field))
        throw new TypeError(`Quotation mapping must include ${field}`);
    if (
      source.datasets.assumptions.length &&
      !mapping.tables.some((t) => t.dataset === 'assumptions' && t.columns.text)
    )
      throw new TypeError(
        'Map all included quotation assumptions to the customer workbook',
      );
    // Explicit detail modes must not silently degrade to the historical scalar-only output.
    if (
      workspace.pricing.lineMode &&
      workspace.pricing.lineMode !== 'single' &&
      !mapping.tables.some(
        (table) =>
          table.dataset === 'quoteLines' &&
          (table.columns.description || table.columns.scope) &&
          table.columns.amount,
      )
    )
      throw new TypeError(
        'Map quotation line descriptions and amounts to the customer workbook.',
      );
  }
  const ExcelJS = (await import('exceljs')).default,
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  if (book.getWorksheet('Workbench Sources'))
    throw new TypeError(
      'Use the original template, not a previously exported workbook',
    );
  const used = new Set<string>();
  const put = (
    sheetName: string,
    address: string | { row: number; col: number },
    value: string | number,
  ) => {
    const sheet = book.getWorksheet(sheetName);
    if (!sheet) throw new TypeError(`Template sheet missing: ${sheetName}`);
    const cell =
      typeof address === 'string'
        ? sheet.getCell(address)
        : sheet.getCell(address.row, address.col);
    if (Number(cell.row) > 1048576 || Number(cell.col) > 16384)
      throw new TypeError('Cell outside Excel limits');
    if (cell.isMerged && cell.master.address !== cell.address)
      throw new TypeError(
        `Map the top-left merged cell: ${sheetName}!${cell.address}`,
      );
    const key = `${sheetName}!${cell.address}`;
    if (used.has(key)) throw new TypeError(`Overlapping mappings: ${key}`);
    used.add(key);
    cell.value = value;
  };
  for (const target of mapping.cells) {
    if (!Object.hasOwn(source.scalars, target.field))
      throw new TypeError(`Unknown scalar field: ${target.field}`);
    put(target.sheet, target.cell, source.scalars[target.field]);
  }
  for (const target of mapping.tables) {
    if (mapping.purpose === 'quote' && target.dataset === 'costRows')
      throw new TypeError(
        'Customer quotation cannot include internal cost rows',
      );
    const rows = source.datasets[target.dataset];
    if (!rows) throw new TypeError('Unknown dataset');
    if (rows.length > target.capacity)
      throw new TypeError(
        `Template has ${target.capacity} rows; ${rows.length} required. Expand the original template and update mapping.`,
      );
    for (const field of Object.keys(target.columns))
      if (rows.length && !Object.hasOwn(rows[0], field))
        throw new TypeError(`Unknown ${target.dataset} field: ${field}`);
    for (let i = 0; i < target.capacity; i++)
      for (const [field, col] of Object.entries(target.columns))
        put(
          target.sheet,
          { row: target.startRow + i, col },
          rows[i]?.[field] ?? '',
        );
  }
  // ExcelJS does not recalculate customer formulas. Discard potentially stale caches.
  for (const sheet of book.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value;
        if (
          v &&
          typeof v === 'object' &&
          ('formula' in v || 'sharedFormula' in v)
        ) {
          cell.value = { ...v, result: undefined } as never;
        }
      }),
    );
  book.calcProperties.fullCalcOnLoad = true;
  const sources = book.addWorksheet('Workbench Sources');
  sources.columns = [{ width: 30 }, { width: 100 }];
  sources.addRow(['Template SHA-256', await workbookHash(bytes)]);
  sources.addRow(['Mapping version', mapping.version]);
  sources.addRow(['Cost version', workspace.activeVersion]);
  sources.addRow(['Exported at', new Date().toISOString()]);
  sources.addRow([
    'Formula recalculation',
    'Open and recalculate in Excel before reviewing customer template formulas.',
  ]);
  if (mapping.purpose === 'cost')
    for (const [key, val] of Object.entries(source.scalars))
      sources.addRow([key, val]);
  for (const [label, obj] of (mapping.purpose === 'cost'
    ? [
        ['Cost inputs JSON', source.snapshot],
        ['Mapping JSON', mapping],
      ]
    : []) as [string, unknown][]) {
    const json = JSON.stringify(obj);
    for (let i = 0; i < json.length; i += 16000)
      sources.addRow([`${label} ${i / 16000 + 1}`, json.slice(i, i + 16000)]);
  }
  sources.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  return {
    bytes: new Uint8Array(await book.xlsx.writeBuffer()),
    templateSha256: await workbookHash(bytes),
    mappingVersion: mapping.version,
  };
}
