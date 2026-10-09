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
    ],
  }));
}
export function PersonnelBulkEntryPage({
  projectId,
  versionCode,
  resources,
  rates,
  locked,
  onClose,
  onConfirm,
}: {
  projectId: string;
  versionCode: string;
  resources: ResourceType[];
  rates: RateSettings;
  locked: boolean;
  onClose: () => void;
  onConfirm: (rows: CostInputRow[], basis: string) => boolean;
}) {
  const sheets = personnelEntrySheets(rates).map((sheet) => ({
      ...sheet,
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
      target={`${projectId} / ${versionCode} · Personnel · Append rows`}
      sheets={sheets}
      contextKey={basis}
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
                c.key as PersonnelBulkColumnTarget,
              ]),
            ),
          });
          payload.push(...result.rows);
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
          summary: `${payload.length} personnel rows to append`,
          count: payload.length,
        };
      }}
      onImport={(rows) =>
        onConfirm(
          rows.map((row) => ({ ...row, id: `CI-${crypto.randomUUID()}` })),
          basis,
        )
      }
    />
  );
}
