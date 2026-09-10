/** Direct personnel spreadsheet entry with optional year focus and Pool allowances. */
import { useState } from 'react';
import { ClipboardPaste, ListTree, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/workbench/status-badge';
import { formatSgd } from '@/lib/formatters';
import {
  YEAR_BUCKETS,
  getActualYears,
  getAllowancePools,
  totalRowCost,
  totalRowMandays,
  type CostInputRow,
  type RateSettings,
  type ResourceType,
} from '@/features/cost/domain';
import {
  isLegacySubcontractRow,
  updatePersonnelCostRows,
} from '../personnel-cost-rows';
import { CostImportPanel } from './cost-import-panel';
import { personnelBulkBasisFingerprint } from '../personnel-bulk-entry';
import { PersonnelBulkEntryDialog } from './personnel-bulk-entry-dialog';
import type { PersonnelTableView } from '../use-personnel-table-view';
import { PersonnelColumnSettings } from './personnel-column-settings';
import {
  movePersonnelRow,
  renamePersonnelGroup,
  type PersonnelRowMove,
  type PersonnelGroupRename,
} from '../personnel-row-layout';
import {
  blankPersonnelRow,
  applyPersonnelModeChange,
  changePersonnelBasis,
  getPersonnelMode,
  preparePersonnelModeChange,
  hasPartialLegacyAllowance,
  patchPersonnelRows,
  personnelRowIssue,
  PersonnelAllowanceOptions,
  PersonnelLinesTable,
  type PersonnelYear,
} from './personnel-input-controls';

/** Arrange cost settings above the grid and keep its entry actions beside the table. */
export function CostInputSheet({
  projectId,
  versionCode,
  rows: allRows,
  setRows: setAllRows,
  rateSettings,
  setRateSettings,
  resourceTypes: allResourceTypes,
  includedTravelCost,
  announce,
  canEditCost,
  tableView,
  locked = false,
}: {
  projectId?: string;
  versionCode?: string;
  rows: CostInputRow[];
  setRows: React.Dispatch<React.SetStateAction<CostInputRow[]>>;
  rateSettings: RateSettings;
  setRateSettings: React.Dispatch<React.SetStateAction<RateSettings>>;
  resourceTypes: ResourceType[];
  includedTravelCost: number;
  announce: (message: string) => void;
  canEditCost?: () => boolean;
  tableView: PersonnelTableView;
  locked?: boolean;
}) {
  const [showImport, setShowImport] = useState(false);
  const [showBulkEntry, setShowBulkEntry] = useState(false);
  const {
    layout: { grouped, yearIndex },
    columnSettings,
    setGrouped,
    setYearIndex,
  } = tableView;
  const rows = allRows.filter(
    (row) => !isLegacySubcontractRow(row, allResourceTypes),
  );
  const resources = allResourceTypes.filter(
    (resource) => resource.category === 'internal',
  );
  const [preferredMode, setPreferredMode] = useState<'sites' | 'mandays'>(() =>
    getPersonnelMode(rows) === 'mandays' ? 'mandays' : 'sites',
  );
  const inputMode = rows.length ? getPersonnelMode(rows) : preferredMode;
  const actualYears = getActualYears(rateSettings);
  const allowancePools = getAllowancePools(rateSettings, resources);
  const issues = rows.filter((row) =>
    personnelRowIssue(row, resources, rateSettings),
  );
  const totalCost = rows.reduce((sum, row) => sum + totalRowCost(row), 0);
  const totalMd = rows.reduce((sum, row) => sum + totalRowMandays(row), 0);

  const applyRowLayout = (change: PersonnelRowMove | PersonnelGroupRename) => {
    if (locked || (canEditCost && !canEditCost())) return;
    setAllRows((current) => {
      const next =
        'rowId' in change
          ? movePersonnelRow(current, allResourceTypes, change)
          : renamePersonnelGroup(current, allResourceTypes, change);
      if (next === null) {
        queueMicrotask(() =>
          announce(
            'Rows or groups changed. Review the latest table and try again.',
          ),
        );
        return current;
      }
      return next;
    });
  };

  const setRows: React.Dispatch<React.SetStateAction<CostInputRow[]>> = (
    change,
  ) => {
    if (locked) return;
    setAllRows((current) =>
      updatePersonnelCostRows(current, allResourceTypes, change),
    );
  };
  const deleteRow = (row: CostInputRow) => {
    if (
      locked ||
      !window.confirm(
        `Delete ${row.scope || row.id}? This removes the row from this cost version only.`,
      )
    )
      return;
    setRows((current) => current.filter((entry) => entry.id !== row.id));
    announce(`${row.scope || row.id} deleted.`);
  };
  const openNew = () => {
    if (locked || !resources.some((resource) => resource.active)) return;
    const row = changePersonnelBasis(
      blankPersonnelRow(`CI-${crypto.randomUUID()}`, resources),
      inputMode === 'mixed' ? 'sites' : inputMode,
    );
    setAllRows((current) => [row, ...current]);
    announce('Cost row added at the top. Edit its cells directly.');
  };

  const changeMode = (mode: 'sites' | 'mandays') => {
    if (locked) return;
    const plan = preparePersonnelModeChange(rows, mode);
    if (plan.error) {
      announce(plan.error);
      return;
    }
    if (
      plan.clearedMandays > 0 &&
      !window.confirm(
        `Switch ${plan.affectedCount} cost row(s) to Sites? This clears ${plan.clearedMandays.toLocaleString('en-SG', { maximumFractionDigits: 4 })} MD across Y1–Y5. Enter the actual site counts and MD per Site.`,
      )
    )
      return;
    if (plan.affectedCount > 0) {
      setAllRows((current) => {
        const next = applyPersonnelModeChange(
          current,
          plan,
          allResourceTypes,
          locked,
        );
        if (next === null) {
          queueMicrotask(() =>
            announce(
              'Cost effort changed. Review the latest rows and try the mode switch again.',
            ),
          );
          return current;
        }
        return next;
      });
    }
    setPreferredMode(mode);
  };

  return (
    <section className="wb-panel min-w-0 overflow-hidden">
      <div className="wb-toolbar justify-between border-b border-border">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Cost Input</h2>
          {locked ? (
            <StatusBadge tone="gray">Locked · View only</StatusBadge>
          ) : (
            <StatusBadge tone={issues.length ? 'amber' : 'green'}>
              {issues.length ? `${issues.length} to review` : 'Calculated'}
            </StatusBadge>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border min-[480px]:grid-cols-3">
        <div className="bg-card px-4 py-3">
          <p className="text-[10px] text-muted-foreground">Cost · All Years</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatSgd(totalCost)}
          </p>
        </div>
        <div className="bg-card px-4 py-3">
          <p className="text-[10px] text-muted-foreground">Total Mandays</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {totalMd.toLocaleString('en-SG', { maximumFractionDigits: 4 })} MD
          </p>
        </div>
        <div className="col-span-2 bg-card px-4 py-3 min-[480px]:col-span-1">
          <p className="text-[10px] text-muted-foreground">Included Travel</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatSgd(includedTravelCost)}
          </p>
        </div>
      </div>
      <PersonnelAllowanceOptions
        selectedPools={allowancePools}
        partialLegacy={hasPartialLegacyAllowance(rateSettings, resources)}
        locked={locked}
        onToggle={(pool, selected) => {
          if (locked) return;
          setRateSettings((current) => {
            const existing = getAllowancePools(current, resources);
            return {
              ...current,
              allowancePools: selected
                ? [...new Set([...existing, pool])]
                : existing.filter((item) => item !== pool),
            };
          });
        }}
      />
      {/* Toolbar controls wrap independently of the dense, horizontally scrollable cost grid. */}
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div
            className="flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
            aria-label="Cost delivery year"
          >
            {[
              ...YEAR_BUCKETS.map((bucket, index) => ({
                value: index as PersonnelYear,
                label: bucket,
              })),
              { value: 'all' as PersonnelYear, label: 'All Years' },
            ].map((year) => (
              <Button
                key={year.value}
                type="button"
                size="sm"
                variant={yearIndex === year.value ? 'default' : 'ghost'}
                className="h-8 px-2.5 text-xs"
                aria-pressed={yearIndex === year.value}
                onClick={() => setYearIndex(year.value)}
              >
                {year.label}
              </Button>
            ))}
          </div>
          <fieldset
            className="flex min-w-0 flex-wrap items-center gap-2"
            aria-label="Cost input mode"
          >
            <span className="text-[11px] text-muted-foreground">Mode</span>
            <div className="flex gap-0.5 rounded-md border border-border bg-card p-0.5">
              {(
                [
                  ['sites', 'Sites'],
                  ['mandays', 'Direct MD'],
                ] as const
              ).map(([mode, label]) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={inputMode === mode ? 'default' : 'ghost'}
                  className="h-8 px-2.5 text-[11px]"
                  aria-pressed={inputMode === mode}
                  disabled={locked}
                  title={`Set all cost rows to ${label}`}
                  onClick={() => changeMode(mode)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {inputMode === 'mixed' && (
              <span className="text-[10px] text-muted-foreground">Mixed</span>
            )}
          </fieldset>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={grouped ? 'default' : 'outline'}
              className="h-8 px-2.5 text-xs"
              aria-pressed={grouped}
              onClick={() => setGrouped((current) => !current)}
            >
              <ListTree className="size-3" />
              Groups
            </Button>
            <PersonnelColumnSettings
              preferences={columnSettings.preferences}
              onSetVisible={columnSettings.setVisible}
              onMove={columnSettings.move}
              onReset={columnSettings.reset}
              ready={columnSettings.ready}
              storageAvailable={columnSettings.storageAvailable}
            />
          </div>
        </div>
      </div>
      {showImport && !locked && (
        <CostImportPanel
          projectId={projectId}
          versionCode={versionCode}
          announce={announce}
          canApply={() => !locked && (!canEditCost || canEditCost())}
          rows={rows}
          setRows={setRows}
          resources={resources}
          rates={rateSettings}
          onClose={() => setShowImport(false)}
        />
      )}
      {/* Keep row entry actions directly above the table, even while import is expanded. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Button
          type="button"
          size="sm"
          className="h-8 px-2.5 text-xs"
          disabled={locked || !resources.some((resource) => resource.active)}
          onClick={openNew}
        >
          <Plus className="size-3" />
          Add Row
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2.5 text-xs"
          disabled={locked || !resources.some((resource) => resource.active)}
          onClick={() => setShowBulkEntry(true)}
        >
          <ClipboardPaste className="size-3" />
          Bulk Entry
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2.5 text-xs"
          disabled={locked}
          onClick={() => {
            if (!locked) setShowImport(!showImport);
          }}
        >
          <Upload className="size-3" />
          Import
        </Button>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {rows.length} rows
        </span>
      </div>
      <PersonnelLinesTable
        rows={rows}
        resources={resources}
        rates={rateSettings}
        actualYears={actualYears}
        yearIndex={yearIndex}
        grouped={grouped}
        columns={columnSettings.columns}
        onMoveRow={applyRowLayout}
        onRenameGroup={applyRowLayout}
        locked={locked}
        announce={announce}
        onPatch={(id, patch) => {
          if (locked || (canEditCost && !canEditCost())) return;
          setAllRows((current) =>
            patchPersonnelRows(
              current,
              id,
              patch,
              allResourceTypes,
              rateSettings,
            ),
          );
        }}
        onDelete={deleteRow}
      />
      <div className="border-t border-border bg-muted/20 px-4 py-3 text-[11px] leading-5 text-muted-foreground">
        Sites × MD/Site or Direct MD → RE rate × annual uplift × selected
        allowance. MD/Site applies to all years for that row. Draft changes save
        automatically. Subcontract costs are managed in Subcon.
      </div>
      {showBulkEntry && (
        <PersonnelBulkEntryDialog
          resources={resources}
          rates={rateSettings}
          defaultMode="mandays"
          defaultYear={yearIndex === 'all' ? 0 : yearIndex}
          locked={locked}
          onClose={() => setShowBulkEntry(false)}
          announce={announce}
          onConfirm={(newRows, basis) => {
            if (canEditCost && !canEditCost()) {
              announce(
                'A project or cost-version change is in progress. Keep this preview open and try again when it finishes.',
              );
              return false;
            }
            if (
              locked ||
              basis !== personnelBulkBasisFingerprint(resources, rateSettings)
            ) {
              announce(
                'The cost version or its rates changed. Review the table again.',
              );
              return false;
            }
            setAllRows((current) => [...current, ...newRows]);
            setShowBulkEntry(false);
            announce(`${newRows.length} cost rows added.`);
            return true;
          }}
        />
      )}
    </section>
  );
}
