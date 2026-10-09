import { useEffect } from 'react';
import { BulkEntryPage } from './bulk-entry-page';
import { readEntrySheet, type EntryIssue, type EntrySheet } from './workbook';
import {
  bulkTabSpec,
  previewBulkImport,
  bulkImportContextKey,
} from '../master-data/bulk-import-model';
import type { GlobalMasterDataStore } from '../master-data/use-global-master-data';
import { masterDataTabs, type MasterDataTab } from '../master-data/navigation';
import { Button } from '@/components/ui/button';
const tabs = masterDataTabs.filter(
  (t) => t.value !== 'workflow' && t.value !== 'status',
);
export function MasterDataBulkEntryPage({
  store,
  initialTab,
  onClose,
  onImported,
}: {
  store: GlobalMasterDataStore;
  initialTab: MasterDataTab;
  onClose: () => void;
  onImported: (tab: MasterDataTab) => void;
}) {
  const { load } = store;
  useEffect(() => {
    for (const tab of tabs) void load(tab.value);
  }, [load]);
  const states = tabs.map((t) => store.tabs[t.value]);
  const failure = states.find((s) => s?.error)?.error;
  if (states.some((s) => !s?.record || s.loading))
    return (
      <div
        className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-background"
        aria-label="Loading Master Data"
      >
        <p>{failure || 'Loading Master Data input sheets…'}</p>
        <Button variant="outline" onClick={onClose}>
          Back
        </Button>
        {failure && (
          <Button
            onClick={() => {
              for (const tab of tabs) void load(tab.value);
            }}
          >
            Retry
          </Button>
        )}
      </div>
    );
  const sheets: EntrySheet[] = tabs.map((tab) => ({
    id: tab.value,
    name: tab.label,
    columns: bulkTabSpec(tab.value).columns.map((c) => ({
      ...c,
      requiredForNew: c.required,
      required: false,
    })),
  }));
  const contextKey = JSON.stringify(
    states.map((s) => [
      s!.record!.revision,
      bulkImportContextKey(s!.items),
      s!.saving,
    ]),
  );
  return (
    <BulkEntryPage
      draftId="bulk:master-data:history-v2"
      target="Global Master Data · Import one catalog at a time · Calculated columns may be left blank · Record ID is only needed for updates"
      sheets={sheets}
      initialSheet={initialTab}
      contextKey={contextKey}
      singleSheet
      disabled={states.some((s) => s!.saving)}
      onClose={onClose}
      onPreview={(document, selected) => {
        const tab = selected[0] as MasterDataTab,
          spec = sheets.find((s) => s.id === tab)!;
        const state = store.tabs[tab]!;
        const { rows, issues } = readEntrySheet(document, spec);
        const related = Object.fromEntries(
          tabs.map((t) => [t.value, store.tabs[t.value]!.items]),
        );
        const preview = previewBulkImport(tab, rows, state.items, related);
        const all: EntryIssue[] = [
          ...issues,
          ...preview.issues.map((i) => ({
            sheet: tab,
            row: i.row,
            column: i.column
              ? spec.columns.findIndex((c) => c.key === i.column) + 1
              : undefined,
            message: i.message,
          })),
        ];
        if (state.record!.conflicts.length)
          all.push({
            sheet: tab,
            row: 1,
            message:
              'Resolve this catalog’s existing conflicts before importing.',
          });
        if (!rows.length)
          all.push({
            sheet: tab,
            row: 2,
            message: 'Paste at least one data row.',
          });
        return {
          payload: {
            tab,
            items: preview.items,
            expected: bulkImportContextKey(state.items),
          },
          issues: all,
          summary: `${spec.name}: ${preview.added} added · ${preview.updated} updated · ${preview.unchanged} unchanged`,
          count: rows.length,
        };
      }}
      onImport={async ({ tab, items, expected }) => {
        const success = await store.importItems(tab, items, expected);
        if (success) onImported(tab);
        return success;
      }}
    />
  );
}
