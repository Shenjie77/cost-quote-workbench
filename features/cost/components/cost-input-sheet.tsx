import { Surface, Text } from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
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
  renderNavigation,
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
  renderNavigation?: (viewControls: React.ReactNode) => React.ReactNode;
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

  const viewControls = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={grouped ? 'default' : 'outline'}
        className="gap-1"
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
  );

  return (
    <Surface as="section" variant="panel" className="min-w-0">
      {/* Keep cost health and totals in one scan line instead of separate metric cards. */}
      <Surface
        as="header"
        variant="header"
        className="flex min-w-0 flex-wrap items-center justify-between"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2>HR Cost / 人力成本</h2>
          {locked ? (
            <StatusBadge tone="gray">Locked · View only</StatusBadge>
          ) : (
            <StatusBadge tone={issues.length ? 'amber' : 'green'}>
              {issues.length ? `${issues.length} to review` : 'Calculated'}
            </StatusBadge>
          )}
          <Text as="span" tone="muted" textRole="body-small">
            {rows.length} rows
          </Text>
        </div>
        <Surface
          as="dl"
          textRole="body-small"
          className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1"
        >
          <div className="flex items-baseline gap-2">
            <Text as="dt" tone="muted">
              Cost · All Years
            </Text>
            <Text as="dd" tone="primary" className="tabular-nums">
              {formatSgd(totalCost)}
            </Text>
          </div>
          <div className="flex items-baseline gap-2">
            <Text as="dt" tone="muted">
              Total Mandays
            </Text>
            <dd className="tabular-nums">
              {totalMd.toLocaleString('en-SG', { maximumFractionDigits: 4 })} MD
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <Text as="dt" tone="muted">
              Included Travel
            </Text>
            <dd className="tabular-nums">{formatSgd(includedTravelCost)}</dd>
          </div>
        </Surface>
      </Surface>
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
      <Surface variant="sheet-controls">
        {renderNavigation?.(viewControls)}
        {/* One wrapping toolbar keeps year selection and entry actions next to the editable grid. */}
        <Surface
          as="div"
          variant="item"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2"
          aria-label="Cost table controls"
        >
          <Surface
            as="div"
            variant="control-group"
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
                className="gap-1"
                aria-pressed={yearIndex === year.value}
                onClick={() => setYearIndex(year.value)}
              >
                {year.label}
              </Button>
            ))}
          </Surface>
          <Button
            type="button"
            size="sm"
            className="gap-1"
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
            className="gap-1"
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
            className="gap-1"
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
            className="gap-1"
            disabled={locked}
            onClick={() => {
              if (!locked) setShowImport(!showImport);
            }}
          >
            <Upload className="size-3" />
            Import
          </Button>
          <fieldset
            className="flex min-w-0 flex-wrap items-center gap-2"
            aria-label="Cost input mode"
          >
            <span className="sr-only">Mode</span>
            <Surface as="div" variant="control-group">
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

                  aria-pressed={inputMode === mode}
                  disabled={locked}
                  title={`Set all cost rows to ${label}`}
                  onClick={() => changeMode(mode)}
                >
                  {label}
                </Button>
              ))}
            </Surface>
            {inputMode === 'mixed' && (
              <Text as="span" tone="muted" textRole="body-small">
                Mixed
              </Text>
            )}
          </fieldset>
          {!renderNavigation && viewControls}
        </Surface>
      </Surface>
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
      <Surface as="div" variant="footer" tone="muted" textRole="body-small">
        Sites × MD/Site or Direct MD → RE rate × annual uplift × selected
        allowance + allocated HQ travel. HQ travel is included in Cost once, by
        resource and year. MD/Site applies to all years for that row. Draft
        changes save automatically. Subcontract costs are managed in Subcon.
      </Surface>
      {copyGroup && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCopyGroup(null);
          }}
        >
          <DialogContent size="sm">
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
              <Surface
                as="label"
                variant="field"
                textRole="body-main"
                className="grid"
              >
                Source group
                <SelectField
                  aria-label="Source group"
                  className="h-9"
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
                </SelectField>
              </Surface>
              <Surface
                as="label"
                variant="field"
                textRole="body-main"
                className="grid"
              >
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
              </Surface>
              <Text as="p" tone="muted" textRole="body-small">
                {copyGroup.rowIds.length} rows will be inserted. Edit the copied
                quantities or scope as needed.
              </Text>
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
    </Surface>
  );
}
