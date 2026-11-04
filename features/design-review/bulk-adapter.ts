/** Compact spreadsheet data/validation, independent of React presentation. */
import {
  entryTsv,
  readEntrySheet,
  type EntrySheet,
  type EntryIssue,
} from '../bulk-entry/workbook.ts';
import { getActualYears, type CostInputRow } from '../cost/domain.ts';
import {
  parsePersonnelBulkEntry,
  mergePersonnelBulkRows,
  type PersonnelBulkColumnTarget,
} from '../cost/personnel-bulk-entry.ts';
import {
  parseSubcontractBulkEntry,
  updateSubcontractBulkLines,
  type SubcontractBulkColumn,
  type SubcontractBulkTarget,
} from '../cost/subcontract-bulk-entry.ts';
import { emptySubcontractCost } from '../cost/subcontract-domain.ts';
import {
  bulkTabSpec,
  previewBulkImport,
} from '../master-data/bulk-import-model.ts';
import type { GlobalMasterDataTab } from '../master-data/global-types.ts';
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import type { CalculationDocument } from '../calculation/workbook.ts';
import {
  parseMaintenanceBulk,
  mergeMaintenanceBulkRows,
} from '../maintenance/bulk-entry.ts';
import { emptyMaintenance } from '../maintenance/domain.ts';
type Master = {
  tab: GlobalMasterDataTab;
  items: Record<string, unknown>[];
  related?: Partial<Record<GlobalMasterDataTab, Record<string, unknown>[]>>;
};
const col = (key: string, label: string, kind: 'text' | 'number' = 'text') => ({
  key,
  label,
  kind,
});
export function compactBulkSheets(
  w: WorkbenchWorkspace,
  kind: string,
  master?: Master,
): EntrySheet[] {
  if (kind === 'master' && master)
    return [
      {
        id: master.tab,
        name: master.tab,
        columns: bulkTabSpec(master.tab)
          .columns.filter((c) => !c.computed)
          .map((c) => ({ ...c, kind: c.kind === 'list' ? 'text' : c.kind })),
        rows: master.items.map((r) =>
          Object.fromEntries(
            bulkTabSpec(master.tab)
              .columns.filter((c) => !c.computed)
              .map((c) => [
                c.key,
                Array.isArray(r[c.key])
                  ? (r[c.key] as unknown[]).join('; ')
                  : ((r[c.key] ?? '') as string | number | boolean),
              ]),
          ),
        ),
      },
    ];
  if (kind === 'maintenance')
    return [
      {
        id: 'maintenance',
        name: 'Maintenance',
        columns: [
          col('model', 'Model'),
          col('ct', 'CT', 'number'),
          col('spms', 'SPMS', 'number'),
          col('quantity', 'QTY', 'number'),
          col('durationYears', 'Duration', 'number'),
          col('remark', 'Remark'),
          col('description', 'Description'),
          col('id', 'Row ID'),
        ],
        rows: (w.maintenanceBoq?.boq || []).map((r) => ({
          ...r,
          ct: r.ct ?? r.unitAnnualQuote,
          spms: r.spms ?? 0,
          durationYears:
            r.durationYears ?? (w.maintenanceBoq?.coverageMonths || 12) / 12,
        })),
      },
    ];
  if (kind === 'subcon') {
    const value = w.subcontractCost || emptySubcontractCost();
    return [
      { id: 'project', name: 'Shared', lines: value.lines },
      ...value.siteTypes.map((s) => ({
        id: `site:${s.id}`,
        name: s.name,
        lines: s.lines,
      })),
    ].map((s) => ({
      id: s.id,
      name: s.name,
      columns: [
        col('category', 'Category'),
        col('code', 'Item Code'),
        col('description', 'Description'),
        ...(s.id === 'project'
          ? getActualYears(w.rateSettings).map((y, i) =>
              col(`quantity:${i}`, `Y${i + 1} (${y}) Quantity`, 'number'),
            )
          : [col('quantityPerSite', 'Quantity / Site', 'number')]),
        col('id', 'Row ID'),
      ],
      rows: s.lines.map(
        (l) =>
          ({
            id: l.id,
            code: l.code,
            description: l.description,
            category: l.category || '',
            ...('quantities' in l
              ? Object.fromEntries(
                  l.quantities.map((v, i) => [`quantity:${i}`, v]),
                )
              : { quantityPerSite: l.quantityPerSite }),
          }) as Record<string, string | number>,
      ),
    }));
  }
  return (['mandays', 'sites'] as const).map((mode) => ({
    id: mode,
    name: mode === 'mandays' ? 'HR Mandays' : 'HR Sites',
    columns: [
      col('category', 'Category'),
      col('groupName', 'Group'),
      col('scope', 'Scope'),
      col('bu', 'BU'),
      col('reType', 'RE Type'),
      ...(mode === 'sites' ? [col('mdPerSite', 'MD / Site', 'number')] : []),
      ...getActualYears(w.rateSettings).map((y, i) =>
        col(
          `${mode}:${i}`,
          `Y${i + 1} (${y}) ${mode === 'sites' ? 'Sites' : 'MD'}`,
          'number',
        ),
      ),
      col('id', 'Row ID'),
    ],
    rows: w.costRows
      .filter((r) => (r.inputMode ?? 'sites') === mode)
      .map((r) => ({
        id: r.id,
        category: r.category || '',
        groupName: r.groupName || '',
        scope: r.scope,
        bu: r.bu,
        reType:
          (
            w.costVersions.find((v) => v.code === w.activeVersion)
              ?.resourceTypes || w.resourceTypes
          ).find((t) => t.id === r.reTypeId)?.code || r.reTypeId,
        mdPerSite: r.mdPerSite,
        ...Object.fromEntries(
          r.years.map((y, i) => [
            `${mode}:${i}`,
            mode === 'sites' ? y.sites : (y.mandays ?? y.sites * r.mdPerSite),
          ]),
        ),
      })),
  }));
}
export function previewCompactBulk(
  document: CalculationDocument,
  sheets: EntrySheet[],
  selected: string[],
  w: WorkbenchWorkspace,
  kind: string,
  master?: Master,
) {
  const issues: EntryIssue[] = [],
    next = structuredClone(w);
  let items = master?.items;
  const personnel: CostInputRow[] = [];
  let count = 0;
  for (const sheet of sheets.filter((s) => selected.includes(s.id))) {
    const read = readEntrySheet(document, sheet);
    issues.push(...read.issues);
    count += read.rows.length;
    if (!read.rows.length) {
      issues.push({
        sheet: sheet.id,
        row: 2,
        message: 'No rows; deselect this sheet.',
      });
      continue;
    }
    const text = entryTsv(sheet, read.rows);
    const add = (message: string, row = 1) =>
      issues.push({ sheet: sheet.id, row, message });
    if (kind === 'master' && master) {
      const result = previewBulkImport(
        master.tab,
        read.rows,
        master.items,
        master.related || {},
        { editCurrentRows: true },
      );
      items = result.items;
      result.issues.forEach((i) => add(i.message, i.row));
    } else if (kind === 'maintenance') {
      const result = parseMaintenanceBulk(text, next.maintenanceBoq?.boq || []);
      result.errors.forEach((e) => add(e));
      if (!result.errors.length)
        next.maintenanceBoq = {
          ...(next.maintenanceBoq || emptyMaintenance()),
          pricingMode: 'components',
          boq: mergeMaintenanceBulkRows(
            next.maintenanceBoq?.boq || [],
            result.rows,
          ),
        };
    } else if (kind === 'subcon') {
      const target: SubcontractBulkTarget =
        sheet.id === 'project'
          ? { kind: 'project' }
          : { kind: 'site', id: sheet.id.slice(5) };
      const value = next.subcontractCost || emptySubcontractCost();
      const result = parseSubcontractBulkEntry(
        text,
        {
          defaultYear: 0,
          mapping: Object.fromEntries(
            sheet.columns.map((c, i) => [i, c.key as SubcontractBulkColumn]),
          ),
        },
        {
          value,
          target,
          catalog: w.subcontractItems,
          actualYears: getActualYears(w.rateSettings),
        },
      );
      result.issues.forEach((e) => add(e));
      result.entries.forEach((r) =>
        r.issues.forEach((e) => add(e, r.sourceRow)),
      );
      if (result.canConfirm)
        next.subcontractCost = updateSubcontractBulkLines(
          value,
          result.lines,
          target,
        );
    } else {
      const result = parsePersonnelBulkEntry(text, {
        resources:
          w.costVersions.find((v) => v.code === w.activeVersion)
            ?.resourceTypes || w.resourceTypes,
        rates: w.rateSettings,
        defaultMode: sheet.id as 'sites' | 'mandays',
        defaultYear: 0,
        hasHeader: true,
        mapping: Object.fromEntries(
          sheet.columns.map((c, i) => [
            i,
            (c.key === 'id' ? 'ignore' : c.key) as PersonnelBulkColumnTarget,
          ]),
        ),
      });
      result.issues.forEach((e) => add(e));
      result.entries.forEach((r) =>
        r.issues.forEach((e) => add(e, r.sourceRow)),
      );
      for (const entry of result.entries) {
        if (!entry.row) continue;
        const id = String(
          read.rows.find((r) => r.row === entry.sourceRow)?.values.id || '',
        ).trim();
        const original = w.costRows.find((r) => r.id === id);
        if (id && !original) {
          add(
            'Row ID not found. Reload or clear it to add a row.',
            entry.sourceRow,
          );
          continue;
        }
        if (id && personnel.some((r) => r.id === id)) {
          add('Duplicate Row ID.', entry.sourceRow);
          continue;
        }
        personnel.push({
          ...original,
          ...entry.row,
          id: id || `CI-${crypto.randomUUID()}`,
        });
      }
    }
  }
  if (!selected.length)
    issues.push({ sheet: '', row: 1, message: 'Select a sheet to apply.' });
  if (kind === 'personnel')
    next.costRows = mergePersonnelBulkRows(w.costRows, personnel);
  return { workspace: next, items, issues, count };
}
