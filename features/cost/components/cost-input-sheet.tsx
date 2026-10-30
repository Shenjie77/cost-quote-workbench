/** Direct personnel spreadsheet entry with optional year focus and Pool allowances. */
import { useState } from 'react';
import { ClipboardPaste, Copy, ListTree, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  mergePersonnelBulkRows,
  personnelBulkBasisFingerprint,
} from '../personnel-bulk-entry';
import { PersonnelBulkEntryPage } from '@/features/bulk-entry/personnel-entry';
import type { PersonnelTableView } from '../use-personnel-table-view';
import { PersonnelColumnSettings } from './personnel-column-settings';
import {
  movePersonnelRow,
  movePersonnelGroup,
  type PersonnelGroupMove,
  renamePersonnelGroup,
  setPersonnelGroupCategory,
  type PersonnelGroupCategoryChange,
  copyPersonnelGroup,
  nextPersonnelGroupCopyName,
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

import { costRowsIncludingHQTravel } from '../group-cost-summary';
import {
  groupPersonnelRows,
  UNASSIGNED_PERSONNEL_GROUP,
} from '../personnel-table-layout';
import type { TravelSettings } from '../domain';

/** Keep cost totals compact and all year, entry and display controls directly above the grid. */
export function CostInputSheet({
  projectId,
  versionCode,
  rows: allRows,
  setRows: setAllRows,
  rateSettings,
  setRateSettings,
  resourceTypes: allResourceTypes,
  includedTravelCost,
  travelSettings,
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
  travelSettings: TravelSettings;
  announce: (message: string) => void;
  canEditCost?: () => boolean;
  tableView: PersonnelTableView;
  locked?: boolean;
}) {
  const [showImport, setShowImport] = useState(false);
  const [showBulkEntry, setShowBulkEntry] = useState(false);
  const [copyGroup, setCopyGroup] = useState<{
    groupName: string;
    nextGroupName: string;
    rowIds: string[];
  } | null>(null);
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
  const groups = groupPersonnelRows(rows);
  const openCopyGroup = (groupName = groups[0]?.groupName) => {
    if (locked || (canEditCost && !canEditCost())) return;
    const group = groups.find((entry) => entry.groupName === groupName);
    if (!group) return;
    setCopyGroup({
      groupName: group.groupName,
      nextGroupName: nextPersonnelGroupCopyName(rows, group.groupName),
      rowIds: group.rows.map((row) => row.id),
    });
  };
  const insertGroupCopy = () => {
    if (!copyGroup || locked || (canEditCost && !canEditCost())) return;
    const request = {
      ...copyGroup,
      newRowIds: copyGroup.rowIds.map(() => `CI-${crypto.randomUUID()}`),
    };
    setAllRows((current) => {
      const next = copyPersonnelGroup(current, allResourceTypes, request);
      if (!next) {
        queueMicrotask(() =>
          announce(
            'The group changed or its new name already exists. Reopen Copy Group and try again.',
          ),
        );
        return current;
      }
      queueMicrotask(() =>
        announce(
          `${request.rowIds.length} rows copied to ${request.nextGroupName.trim()}.`,
        ),
      );
      return next;
    });
    setCopyGroup(null);
  };
  const [preferredMode, setPreferredMode] = useState<'sites' | 'mandays'>(() =>
    getPersonnelMode(rows) === 'mandays' ? 'mandays' : 'sites',
  );
  const inputMode = rows.length ? getPersonnelMode(rows) : preferredMode;
  const actualYears = getActualYears(rateSettings);
  const allowancePools = getAllowancePools(rateSettings, resources);
  const issues = rows.filter((row) =>
    personnelRowIssue(row, resources, rateSettings),
  );
  const displayedRows = costRowsIncludingHQTravel(
    rows,
    allResourceTypes,
    travelSettings,
  );
  const totalCost = displayedRows.reduce(
    (sum, row) => sum + totalRowCost(row),
    0,
  );
  const totalMd = rows.reduce((sum, row) => sum + totalRowMandays(row), 0);

  const applyRowLayout = (
    change:
      | PersonnelRowMove
      | PersonnelGroupRename
      | PersonnelGroupMove
      | PersonnelGroupCategoryChange,
  ) => {
    if (locked || (canEditCost && !canEditCost())) return;
    setAllRows((current) => {
      const next =
        'direction' in change
          ? movePersonnelGroup(current, allResourceTypes, change)
          : 'rowId' in change
            ? movePersonnelRow(current, allResourceTypes, change)
            : 'category' in change
              ? setPersonnelGroupCategory(current, allResourceTypes, change)
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
      {/* Keep cost health and totals in one scan line instead of separate metric cards. */}
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Cost Input</h2>
          {locked ? (
            <StatusBadge tone="gray">Locked · View only</StatusBadge>
          ) : (
            <StatusBadge tone={issues.length ? 'amber' : 'green'}>
              {issues.length ? `${issues.length} to review` : 'Calculated'}
            </StatusBadge>
          )}
          <span className="text-xs text-muted-foreground">
            {rows.length} rows
          </span>
        </div>
        <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Cost · All Years</dt>
            <dd className="font-semibold tabular-nums text-primary">
              {formatSgd(totalCost)}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Total Mandays</dt>
            <dd className="font-semibold tabular-nums">
              {totalMd.toLocaleString('en-SG', { maximumFractionDigits: 4 })} MD
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Included Travel</dt>
            <dd className="font-semibold tabular-nums">
              {formatSgd(includedTravelCost)}
            </dd>
          </div>
        </dl>
      </header>
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
      {/* One wrapping toolbar keeps year selection and entry actions next to the editable grid. */}
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-muted/20 px-3 py-1.5"
        aria-label="Cost table controls"
      >
        <div
          className="flex max-w-full flex-wrap gap-0.5 rounded-md bg-muted/60 p-0.5"
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
              className="h-8 gap-1 px-2 text-xs"
              aria-pressed={yearIndex === year.value}
              onClick={() => setYearIndex(year.value)}
            >
              {year.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1 px-2 text-xs"
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
          className="h-8 gap-1 px-2 text-xs"
          disabled={locked || !groups.length}
          onClick={() => openCopyGroup()}
        >
          <Copy className="size-3" />
          Copy Group
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 px-2 text-xs"
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
          className="h-8 gap-1 px-2 text-xs"
          disabled={locked}
          onClick={() => {
            if (!locked) setShowImport(!showImport);
          }}
        >
          <Upload className="size-3" />
          Import
        </Button>
        <fieldset
          className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5"
          aria-label="Cost input mode"
        >
          <span className="sr-only">Mode</span>
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
                className="h-8 px-2 text-xs"
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
            <span className="text-xs text-muted-foreground">Mixed</span>
          )}
        </fieldset>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={grouped ? 'default' : 'outline'}
            className="h-8 gap-1 px-2 text-xs"
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
      <PersonnelLinesTable
        rows={displayedRows}
        resources={resources}
        rates={rateSettings}
        actualYears={actualYears}
        yearIndex={yearIndex}
        grouped={grouped}
        columns={columnSettings.columns}
        onMoveRow={applyRowLayout}
        onRenameGroup={applyRowLayout}
        onApplyGroupCategory={applyRowLayout}
        onMoveGroup={applyRowLayout}
        onCopyGroup={openCopyGroup}
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
      <div className="border-t border-border bg-muted/20 px-3 py-2 text-xs leading-4 text-muted-foreground">
        Sites × MD/Site or Direct MD → RE rate × annual uplift × selected
        allowance + allocated HQ travel. HQ travel is included in Cost once, by
        resource and year. MD/Site applies to all years for that row. Draft
        changes save automatically. Subcontract costs are managed in Subcon.
      </div>
      {copyGroup && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCopyGroup(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Copy Group</DialogTitle>
              <DialogDescription>
                Copy all rows, categories and Y1–Y5 inputs into an independent
                group.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                insertGroupCopy();
              }}
            >
              <label className="grid gap-1.5 text-sm font-medium">
                Source group
                <select
                  aria-label="Source group"
                  className="h-9 rounded-md border border-border bg-white px-3 text-sm"
                  value={copyGroup.groupName}
                  disabled={locked}
                  onChange={(event) => openCopyGroup(event.target.value)}
                >
                  {groups.map((group) => (
                    <option key={group.groupName} value={group.groupName}>
                      {group.groupName || UNASSIGNED_PERSONNEL_GROUP} ·{' '}
                      {group.rows.length} rows
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                New group name
                <Input
                  aria-label="New group name"
                  value={copyGroup.nextGroupName}
                  maxLength={200}
                  required
                  disabled={locked}
                  onChange={(event) =>
                    setCopyGroup({
                      ...copyGroup,
                      nextGroupName: event.target.value,
                    })
                  }
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {copyGroup.rowIds.length} rows will be inserted. Edit the copied
                quantities or scope as needed.
              </p>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCopyGroup(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    locked ||
                    !copyGroup.nextGroupName.trim() ||
                    groups.some(
                      (group) =>
                        group.groupName === copyGroup.nextGroupName.trim(),
                    )
                  }
                >
                  Insert Group Copy
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {showBulkEntry && (
        <PersonnelBulkEntryPage
          projectId={projectId ?? 'project'}
          versionCode={versionCode ?? 'draft'}
          resources={resources}
          rows={rows}
          rates={rateSettings}
          locked={locked}
          onClose={() => setShowBulkEntry(false)}
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
            setAllRows((current) => mergePersonnelBulkRows(current, newRows));
            setShowBulkEntry(false);
            announce(`${newRows.length} cost rows saved.`);
            return true;
          }}
        />
      )}
    </section>
  );
}
