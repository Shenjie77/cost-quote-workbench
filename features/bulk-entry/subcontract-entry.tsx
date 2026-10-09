import { BulkEntryPage } from './bulk-entry-page';
import {
  readEntrySheet,
  entryTsv,
  type EntrySheet,
  type EntryIssue,
} from './workbook';
import type { SubcontractCost } from '../cost/subcontract-domain';
import type { SubcontractItem } from '../master-data/types';
import {
  type SubcontractBulkColumn,
  parseSubcontractBulkEntry,
  type SubcontractBulkLine,
  type SubcontractBulkTarget,
} from '../cost/subcontract-bulk-entry';
export type SubcontractBatch = {
  target: SubcontractBulkTarget;
  lines: SubcontractBulkLine[];
}[];
export const subcontractEntryContext = (
  value: SubcontractCost,
  catalog: SubcontractItem[],
  years: (number | null)[],
) => JSON.stringify([value, catalog, years]);
export function SubcontractBulkEntryPage({
  workspaceKey,
  value,
  catalog,
  actualYears,
  target,
  locked,
  onClose,
  onConfirm,
}: {
  workspaceKey: string;
  value: SubcontractCost;
  catalog: SubcontractItem[];
  actualYears: (number | null)[];
  target: SubcontractBulkTarget;
  locked: boolean;
  onClose: () => void;
  onConfirm: (batch: SubcontractBatch, basis: string) => boolean;
}) {
  const targets: { id: string; name: string; target: SubcontractBulkTarget }[] =
    [
      { id: 'project', name: 'Shared - One-off', target: { kind: 'project' } },
      ...(value.mode === 'site-types'
        ? value.siteTypes.map((s, i) => ({
            id: `site-${s.id}`,
            name: `${i + 1} ${s.name}`.slice(0, 31),
            target: { kind: 'site' as const, id: s.id },
          }))
        : []),
    ];
  const sheets: EntrySheet[] = targets.map((t) => ({
    id: t.id,
    name: t.name,
    columns: [
      {
        key: 'code',
        label: 'Item Code',
        requiredTogether: 'Item Code or Description is required.',
        kind: 'text',
        description:
          'Use an active Master Data item code. Price, unit and BU come from that item.',
        options: catalog.filter((item) => item.active).map((item) => item.code),
      },
      {
        key: 'description',
        label: 'Description',
        requiredTogether: 'Item Code or Description is required.',
        example:
          catalog.find((item) => item.active)?.item ?? 'Installation service',
        kind: 'text',
        description:
          'Match the Master Data description, or leave blank when Item Code is supplied.',
      },
      ...(t.target.kind === 'project'
        ? actualYears.map((year, i) => ({
            key: `quantity:${i}`,
            label: `Y${i + 1}${year ? ` (${year})` : ''} Quantity`,
            kind: 'number' as const,
            description: 'Total quantity for this year; blank means zero.',
            example: 3,
          }))
        : [
            {
              key: 'quantityPerSite',
              label: 'Quantity / Site',
              description: 'Quantity of this catalog item needed per site.',
              example: 2,
              kind: 'number' as const,
              required: true,
            },
          ]),
    ],
  }));
  const basis = subcontractEntryContext(value, catalog, actualYears);
  return (
    <BulkEntryPage
      draftId={`bulk:subcontract:${workspaceKey}`}
      target={`${workspaceKey} · Subcontract · Append catalog items; rates come from Master Data`}
      sheets={sheets}
      initialSheet={target.kind === 'project' ? 'project' : `site-${target.id}`}
      contextKey={basis}
      disabled={locked}
      onClose={onClose}
      onPreview={(document, selected) => {
        const payload: SubcontractBatch = [],
          issues: EntryIssue[] = [];
        for (const sheet of sheets.filter((s) => selected.includes(s.id))) {
          const read = readEntrySheet(document, sheet);
          issues.push(...read.issues);
          if (!read.rows.length) {
            issues.push({
              sheet: sheet.id,
              row: 2,
              message: 'Paste rows or deselect this sheet.',
            });
            continue;
          }
          const selectedTarget = targets.find((t) => t.id === sheet.id)!.target;
          const preview = parseSubcontractBulkEntry(
            entryTsv(sheet, read.rows),
            {
              defaultYear: 0,
              mapping: Object.fromEntries(
                sheet.columns.map((c, i) => [
                  i,
                  c.key as SubcontractBulkColumn,
                ]),
              ),
            },
            { value, catalog, actualYears, target: selectedTarget },
          );
          payload.push({ target: selectedTarget, lines: preview.lines });
          issues.push(
            ...preview.issues.map((message) => ({
              sheet: sheet.id,
              row: 1,
              message,
            })),
            ...preview.entries.flatMap((row) =>
              row.issues.map((message) => ({
                sheet: sheet.id,
                row: row.sourceRow,
                message,
              })),
            ),
          );
        }
        const count = payload.reduce((sum, p) => sum + p.lines.length, 0);
        return {
          payload,
          issues,
          summary: `${count} subcontract items to append across ${payload.length} sheets`,
          count,
        };
      }}
      onImport={(batch) =>
        onConfirm(
          batch.map((b) => ({
            ...b,
            lines: b.lines.map((line) => ({
              ...line,
              id: `SC-${crypto.randomUUID()}`,
            })),
          })),
          basis,
        )
      }
    />
  );
}
