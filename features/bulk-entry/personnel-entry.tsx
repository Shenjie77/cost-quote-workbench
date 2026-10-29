import { BulkEntryPage } from './bulk-entry-page';
import {
  readEntrySheet,
  entryTsv,
  type EntrySheet,
  type EntryIssue,
} from './workbook';
import {
  getActualYears,
  type CostInputRow,
  type ResourceType,
  type RateSettings,
} from '../cost/domain';
import {
  type PersonnelBulkColumnTarget,
  parsePersonnelBulkEntry,
  personnelBulkBasisFingerprint,
} from '../cost/personnel-bulk-entry';
export function personnelEntrySheets(rates: RateSettings): EntrySheet[] {
  const years = getActualYears(rates);
  return (['mandays', 'sites'] as const).map((mode) => ({
    id: mode,
    name: mode === 'mandays' ? 'Personnel MD' : 'Personnel Sites',
    columns: [
      {
        key: 'category',
        label: 'Category',
        kind: 'text',
        description: 'Quotation category; blank uses Professional Service.',
        example: 'Professional Service',
      },
      {
        key: 'groupName',
        label: 'Group',
        kind: 'text',
        description: 'Optional cost group for related activities.',
        example: 'Deployment',
      },
      {
        key: 'scope',
        label: 'Scope',
        kind: 'text',
        required: true,
        description: 'Describe the work to be delivered.',
        example: 'Install and test',
      },
      {
        key: 'bu',
        label: 'BU',
        kind: 'text',
        required: true,
        description: 'Business unit responsible for this work.',
        example: 'Network',
      },
      {
        key: 'reType',
        label: 'RE Type',
        kind: 'text',
        required: true,
        description: 'Use a resource code from the current cost version.',
      },
      ...(mode === 'sites'
        ? [
            {
              key: 'mdPerSite',
              label: 'MD / Site',
              description: 'Mandays needed per site.',
              example: 2,
              kind: 'number' as const,
              required: true,
            },
          ]
        : []),
      ...years.map((year, i) => ({
        key: `${mode}:${i}`,
        label: `Y${i + 1}${year ? ` (${year})` : ''} ${mode === 'mandays' ? 'MD' : 'Sites'}`,
        kind: 'number' as const,
        description:
          mode === 'mandays'
            ? 'Total mandays in this year; blank means zero.'
            : 'Number of sites in this year; blank means zero.',
        example: mode === 'mandays' ? 10 : 3,
      })),
      {
        key: 'id',
        label: 'Row ID',
        kind: 'text',
        description:
          'Keep the existing ID to update; leave blank for a new row.',
      },
    ],
  }));
}
export function PersonnelBulkEntryPage({
  projectId,
  versionCode,
  resources,
  rates,
  rows,
  locked,
  onClose,
  onConfirm,
}: {
  projectId: string;
  versionCode: string;
  rows: CostInputRow[];
  resources: ResourceType[];
  rates: RateSettings;
  locked: boolean;
  onClose: () => void;
  onConfirm: (rows: CostInputRow[], basis: string) => boolean;
}) {
  const sheets = personnelEntrySheets(rates).map((sheet) => ({
      ...sheet,
      rows: rows
        .filter((row) => (row.inputMode ?? 'sites') === sheet.id)
        .map((row) => ({
          id: row.id,
          category: row.category ?? '',
          groupName: row.groupName ?? '',
          scope: row.scope,
          bu: row.bu,
          reType:
            resources.find((resource) => resource.id === row.reTypeId)?.code ??
            row.reTypeId,
          mdPerSite: row.mdPerSite,
          ...Object.fromEntries(
            row.years.map((year, i) => [
              `${sheet.id}:${i}`,
              sheet.id === 'mandays'
                ? (year.mandays ?? year.sites * row.mdPerSite)
                : year.sites,
            ]),
          ),
        })),
      columns: sheet.columns.map((column) =>
        column.key === 'reType'
          ? { ...column, options: resources.map((resource) => resource.code) }
          : column,
      ),
    })),
    basis = personnelBulkBasisFingerprint(resources, rates);
  return (
    <BulkEntryPage
      draftId={`bulk:personnel:${projectId}:${versionCode}`}
      target={`${projectId} / ${versionCode} · Personnel · Update existing rows or add new rows`}
      sheets={sheets}
      initialSheet={
        rows.some((row) => row.inputMode === 'mandays') ? 'mandays' : 'sites'
      }
      contextKey={JSON.stringify([basis, rows])}
      disabled={locked}
      onClose={onClose}
      onPreview={(document, selected) => {
        const payload: CostInputRow[] = [];
        const issues: EntryIssue[] = [];
        for (const sheet of sheets.filter((s) => selected.includes(s.id))) {
          const read = readEntrySheet(document, sheet);
          issues.push(...read.issues);
          if (!read.rows.length) {
            issues.push({
              sheet: sheet.id,
              row: 2,
              message: 'Paste at least one row, or deselect this sheet.',
            });
            continue;
          }
          const result = parsePersonnelBulkEntry(entryTsv(sheet, read.rows), {
            resources,
            rates,
            defaultMode: sheet.id as 'mandays' | 'sites',
            defaultYear: 0,
            hasHeader: true,
            mapping: Object.fromEntries(
              sheet.columns.map((c, i) => [
                i,
                (c.key === 'id'
                  ? 'ignore'
                  : c.key) as PersonnelBulkColumnTarget,
              ]),
            ),
          });
          for (const entry of result.entries) {
            if (!entry.row) continue;
            const source = read.rows.find((row) => row.row === entry.sourceRow);
            const id = String(source?.values.id ?? '').trim();
            const existing = rows.find((row) => row.id === id);
            if (id && !existing) {
              issues.push({
                sheet: sheet.id,
                row: entry.sourceRow,
                message:
                  'Row ID no longer exists. Reload current data, or clear the ID to add a new row.',
              });
              continue;
            }
            if (id && payload.some((row) => row.id === id)) {
              issues.push({
                sheet: sheet.id,
                row: entry.sourceRow,
                message:
                  'Row ID is duplicated. Clear the ID when copying a row.',
              });
              continue;
            }
            payload.push({
              ...existing,
              ...entry.row,
              id: id || `CI-${crypto.randomUUID()}`,
            });
          }
          issues.push(
            ...result.issues.map((message) => ({
              sheet: sheet.id,
              row: 1,
              message,
            })),
            ...result.entries.flatMap((row) =>
              row.issues.map((message) => ({
                sheet: sheet.id,
                row: row.sourceRow,
                message,
              })),
            ),
          );
        }
        return {
          payload,
          issues,
          summary: `${payload.filter((row) => rows.some((current) => current.id === row.id)).length} existing rows · ${payload.filter((row) => !rows.some((current) => current.id === row.id)).length} new rows · Unlisted rows kept`,
          count: payload.length,
        };
      }}
      onImport={(edits) => onConfirm(edits, basis)}
    />
  );
}
