/** Compact spreadsheet-style personnel entry. Mutations patch the latest raw inputs. */
import { ArrowDown, ArrowUp, GripVertical, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BusinessUnitSelect } from '@/features/master-data/business-unit-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  YEAR_BUCKETS,
  calculatedYearCost,
  getY1Year,
  roundMoney,
  totalRowCost,
  totalRowMandays,
  totalRowSites,
  yearRowMandays,
  type CostInputRow,
  type RateSettings,
  type ResourceType,
} from '../domain';
import { isLegacySubcontractRow } from '../personnel-cost-rows';
import {
  defaultPersonnelColumns,
  visiblePersonnelColumns,
  getPersonnelColumnSpec,
  type PersonnelColumnId,
} from '../personnel-columns';
import {
  getPersonnelAnnualColumn as annualColumn,
  getPersonnelAnnualColumnLabel,
  getPersonnelHeaderSegments,
  groupPersonnelRows,
  resolvePersonnelTableColumns,
  UNASSIGNED_PERSONNEL_GROUP,
  type PersonnelTableLayout,
} from '../personnel-table-layout';
export { groupPersonnelRows } from '../personnel-table-layout';

export type PersonnelYear = PersonnelTableLayout['yearIndex'];
export type PersonnelMode = 'sites' | 'mandays';
export type PersonnelModeChangePlan = {
  mode: PersonnelMode;
  expectedRows: { id: string; allocation: string }[];
  changes: { id: string; mode: PersonnelMode }[];
  clearedMandays: number;
  affectedCount: number;
  error?: string;
};
export type PersonnelPool = NonNullable<ResourceType['pool']>;
type PersonnelDisplayEntry =
  | { kind: 'group'; groupName: string; rowIds: string[] }
  | { kind: 'row'; row: CostInputRow };
export type PersonnelRowMove = {
  rowId: string;
  targetRowId?: string;
  position: 'before' | 'after' | 'group-end';
  groupName?: string;
};
export type PersonnelGroupRename = {
  groupName: string;
  nextGroupName: string;
  rowIds: string[];
};
export const PERSONNEL_POOLS: PersonnelPool[] = ['LOCAL', 'ARP', 'HQ', 'OTHER'];
export type PersonnelInputPatch =
  | { field: 'groupName' | 'scope' | 'bu' | 'reTypeId'; value: string }
  | { field: 'mdPerSite'; value: number }
  | {
      field: 'year';
      yearIndex: number;
      mode: 'sites' | 'mandays';
      value: number;
    };
const number = (value: number) =>
  value.toLocaleString('en-SG', { maximumFractionDigits: 4 });
const money = (value: number) =>
  value.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const gridInput =
  'h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-2 py-0 text-[11px] shadow-none focus-visible:bg-white focus-visible:ring-1';
const gridSelect =
  'h-8 w-full min-w-0 border-0 bg-transparent px-1 text-[11px] outline-none focus:bg-white disabled:opacity-60';
const cell = 'border-r border-border px-2 py-0 text-right tabular-nums';
const inputCell = 'border-r border-border p-0';
const scopeCell =
  'sticky left-0 z-10 w-[180px] min-w-[180px] border-r border-border bg-card p-0';
const amountValid = (value: number, integer = false) =>
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1e6 &&
  (!integer || Number.isInteger(value));

export function blankPersonnelRow(
  id: string,
  resources: ResourceType[],
): CostInputRow {
  return {
    id,
    scope: '',
    bu: '',
    reTypeId:
      resources.find(
        (resource) => resource.category === 'internal' && resource.active,
      )?.id || '',
    inputMode: 'sites',
    mdPerSite: 0,
    years: YEAR_BUCKETS.map((bucket) => ({ bucket, sites: 0, cost: 0 })),
  };
}

/** Protect only the effort being replaced by an explicitly confirmed mode conversion. */
export const personnelAllocationFingerprint = (row: CostInputRow) =>
  JSON.stringify([
    row.inputMode || 'sites',
    row.mdPerSite,
    row.years.map((year) => [year.bucket, year.sites, year.mandays ?? null]),
  ]);
const personnelModeConversionIssue = (
  row: CostInputRow,
  mode: 'sites' | 'mandays',
) =>
  mode === 'mandays' &&
  row.inputMode !== 'mandays' &&
  row.years.some((_, index) => !amountValid(yearRowMandays(row, index)))
    ? 'Direct MD supports at most 1,000,000 MD per year. Keep Sites mode or split the effort into smaller rows.'
    : '';
export function changePersonnelBasis(
  row: CostInputRow,
  mode: 'sites' | 'mandays',
): CostInputRow {
  if ((row.inputMode || 'sites') === mode) return row;
  if (personnelModeConversionIssue(row, mode)) return row;
  return {
    ...row,
    inputMode: mode,
    mdPerSite: 0,
    years: row.years.map((year, index) =>
      mode === 'mandays'
        ? { ...year, sites: 0, mandays: yearRowMandays(row, index) }
        : { bucket: year.bucket, sites: 0, cost: 0 },
    ),
  };
}

export function getPersonnelMode(
  rows: CostInputRow[],
): PersonnelMode | 'mixed' {
  const modes = new Set(rows.map((row) => row.inputMode || 'sites'));
  return modes.size > 1 ? 'mixed' : modes.values().next().value || 'sites';
}

/** Preflight a whole-grid conversion without changing any row or inferring approval. */
export function preparePersonnelModeChange(
  rows: CostInputRow[],
  mode: PersonnelMode,
): PersonnelModeChangePlan {
  const affected = rows.filter((row) => (row.inputMode || 'sites') !== mode);
  const plan: PersonnelModeChangePlan = {
    mode,
    expectedRows: rows.map((row) => ({
      id: row.id,
      allocation: personnelAllocationFingerprint(row),
    })),
    changes: affected.map((row) => ({ id: row.id, mode })),
    clearedMandays:
      mode === 'sites'
        ? affected.reduce((sum, row) => sum + totalRowMandays(row), 0)
        : 0,
    affectedCount: affected.length,
  };
  for (const row of affected) {
    const issue = personnelModeConversionIssue(row, mode);
    if (issue) return { ...plan, error: `${row.scope || row.id}: ${issue}` };
  }
  return plan;
}

/** All-or-nothing conversion checks membership and effort against the latest raw rows. */
export function applyPersonnelModeChange(
  rows: CostInputRow[],
  plan: PersonnelModeChangePlan,
  resources: ResourceType[],
  locked = false,
): CostInputRow[] | null {
  if (locked || plan.error) return null;
  const personnel = rows.filter(
    (row) => !isLegacySubcontractRow(row, resources),
  );
  if (personnel.length !== plan.expectedRows.length) return null;
  const expected = new Map(
    plan.expectedRows.map((row) => [row.id, row.allocation]),
  );
  if (
    expected.size !== personnel.length ||
    personnel.some(
      (row) => expected.get(row.id) !== personnelAllocationFingerprint(row),
    )
  )
    return null;
  const changes = new Map(
    plan.changes.map((change) => [change.id, change.mode]),
  );
  if (
    changes.size !== plan.changes.length ||
    plan.changes.some(
      (change) => !expected.has(change.id) || change.mode !== plan.mode,
    )
  )
    return null;
  if (
    personnel.some(
      (row) => (row.inputMode || 'sites') !== plan.mode && !changes.has(row.id),
    )
  )
    return null;
  if (
    personnel.some(
      (row) =>
        changes.has(row.id) && personnelModeConversionIssue(row, plan.mode),
    )
  )
    return null;
  return rows.map((row) =>
    !isLegacySubcontractRow(row, resources) && changes.has(row.id)
      ? changePersonnelBasis(row, plan.mode)
      : row,
  );
}

/** Field patches cannot restore old costs, other years, imported source, or unrelated fields. */
export function patchPersonnelRows(
  rows: CostInputRow[],
  id: string,
  patch: PersonnelInputPatch,
  resources: ResourceType[],
  rates: RateSettings,
  locked = false,
): CostInputRow[] {
  if (locked) return rows;
  return rows.map((row) => {
    if (row.id !== id || isLegacySubcontractRow(row, resources)) return row;
    if (
      patch.field === 'scope' ||
      patch.field === 'bu' ||
      patch.field === 'groupName'
    ) {
      if (patch.value.length > (patch.field === 'scope' ? 500 : 200))
        return row;
      return { ...row, [patch.field]: patch.value };
    }
    if (patch.field === 'reTypeId') {
      const re = resources.find((resource) => resource.id === patch.value);
      if (
        !re ||
        re.category !== 'internal' ||
        (!re.active && re.id !== row.reTypeId)
      )
        return row;
      return { ...row, reTypeId: patch.value };
    }
    if (patch.field === 'mdPerSite') {
      if (row.inputMode === 'mandays' || !amountValid(patch.value)) return row;
      return { ...row, mdPerSite: patch.value };
    }
    if (patch.field !== 'year') return row;
    if (
      (row.inputMode || 'sites') !== patch.mode ||
      !Number.isInteger(patch.yearIndex) ||
      patch.yearIndex < 0 ||
      patch.yearIndex >= YEAR_BUCKETS.length ||
      !amountValid(patch.value, patch.mode === 'sites')
    )
      return row;
    const next = {
      ...row,
      years: row.years.map((year, index) =>
        index === patch.yearIndex
          ? {
              ...year,
              ...(patch.mode === 'mandays'
                ? { mandays: patch.value }
                : { sites: patch.value }),
            }
          : year,
      ),
    };
    // This amount is derived from the latest row; the parent recalculates all
    // displayed costs against the current version's rates and allowance.
    next.years[patch.yearIndex] = {
      ...next.years[patch.yearIndex],
      cost: calculatedYearCost(next, patch.yearIndex, resources, rates),
    };
    return next;
  });
}

export function personnelRowIssue(
  row: CostInputRow,
  resources: ResourceType[],
  rates: RateSettings,
): string {
  if (!row.scope.trim()) return 'Enter Scope';
  if (!row.bu.trim()) return 'Enter BU';
  if (
    !resources.some(
      (resource) =>
        resource.id === row.reTypeId && resource.category === 'internal',
    )
  )
    return 'Unknown RE Type';
  if (
    !amountValid(row.mdPerSite) ||
    row.years.some(
      (year) =>
        !amountValid(year.sites, true) ||
        !Number.isFinite(year.cost) ||
        year.cost < 0 ||
        (row.inputMode === 'mandays' && !amountValid(Number(year.mandays))),
    )
  )
    return 'Invalid quantity';
  if (
    row.inputMode !== 'mandays' &&
    row.mdPerSite === 0 &&
    row.years.some((year) => year.sites > 0)
  )
    return 'Enter MD/Site';
  if (
    getY1Year(rates) === null &&
    (totalRowMandays(row) > 0 || totalRowCost(row) > 0)
  )
    return 'Set delivery dates';
  return '';
}

export function PersonnelNumberInput({
  value,
  label,
  onChange,
  locked = false,
  integer = false,
  announce,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
  locked?: boolean;
  integer?: boolean;
  announce: (message: string) => void;
}) {
  return (
    <Input
      aria-label={label}
      type="number"
      min={0}
      max={1e6}
      step={integer ? 1 : 'any'}
      className={`${gridInput} text-right tabular-nums`}
      value={value}
      disabled={locked}
      onChange={(event) => {
        if (locked) return;
        const next = Number(event.target.value);
        if (!amountValid(next, integer)) {
          announce(
            integer
              ? 'Enter a whole number between 0 and 1,000,000.'
              : 'Enter a number between 0 and 1,000,000.',
          );
          return;
        }
        onChange(next);
      }}
    />
  );
}

const PERSONNEL_ROW_DRAG = 'application/x-ssr-personnel-row';
const columnWidth = (id: PersonnelColumnId) => {
  const annual = annualColumn(id);
  if (annual)
    return annual.field === 'sites'
      ? 65
      : annual.field === 'mandays'
        ? 76
        : 105;
  return {
    groupName: 160,
    scope: 180,
    bu: 72,
    reType: 120,
    mdPerSite: 64,
    totalSites: 68,
    totalMd: 75,
    totalCost: 105,
    check: 70,
    action: 96,
  }[id as Exclude<PersonnelColumnId, `Y${number}:${string}`>];
};
export const personnelDropPosition = (
  clientY: number,
  top: number,
  height: number,
) => (clientY < top + height / 2 ? ('before' as const) : ('after' as const));

export function PersonnelLinesTable({
  rows,
  resources,
  rates,
  actualYears,
  yearIndex = 'all',
  grouped = false,
  columns: requestedColumns,
  onPatch,
  onDelete,
  onMoveRow,
  onRenameGroup,
  locked = false,
  announce,
}: {
  rows: CostInputRow[];
  resources: ResourceType[];
  rates: RateSettings;
  actualYears: (number | null)[];
  yearIndex?: PersonnelYear;
  grouped?: boolean;
  columns?: PersonnelColumnId[];
  onPatch: (id: string, patch: PersonnelInputPatch) => void;
  onDelete: (row: CostInputRow) => void;
  onMoveRow?: (move: PersonnelRowMove) => void;
  onRenameGroup?: (rename: PersonnelGroupRename) => void;
  locked?: boolean;
  announce: (message: string) => void;
}) {
  const columns = resolvePersonnelTableColumns(
    requestedColumns || visiblePersonnelColumns(defaultPersonnelColumns()),
    yearIndex,
  );
  const hasAnnual = columns.some((id) => annualColumn(id));
  const segments = getPersonnelHeaderSegments(columns);
  const entries: PersonnelDisplayEntry[] = grouped
    ? groupPersonnelRows(rows).flatMap((group): PersonnelDisplayEntry[] => [
        {
          kind: 'group',
          groupName: group.groupName,
          rowIds: group.rows.map((row) => row.id),
        },
        ...group.rows.map((row) => ({ kind: 'row' as const, row })),
      ])
    : rows.map((row) => ({ kind: 'row', row }));
  const displayedRows = entries.flatMap((entry) =>
    entry.kind === 'row' ? [entry.row] : [],
  );
  const update = (id: string, patch: PersonnelInputPatch) => {
    if (!locked) onPatch(id, patch);
  };
  const move = (request: PersonnelRowMove) => {
    if (!locked) onMoveRow?.(request);
  };
  const draggedRow = (event: React.DragEvent) => {
    const id = event.dataTransfer.getData(PERSONNEL_ROW_DRAG);
    return rows.some((row) => row.id === id) ? id : '';
  };
  const allowDrop = (event: React.DragEvent) => {
    if (
      !locked &&
      onMoveRow &&
      event.dataTransfer.types.includes(PERSONNEL_ROW_DRAG)
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      return true;
    }
    return false;
  };
  const textColumn = columns.find((id) =>
    [
      'groupName',
      'scope',
      'bu',
      'reType',
      'mdPerSite',
      'check',
      'action',
    ].includes(id),
  );
  const renderRowCell = (row: CostInputRow, id: PersonnelColumnId) => {
    const re = resources.find((resource) => resource.id === row.reTypeId);
    const unknown = !re || re.category !== 'internal';
    const mode = row.inputMode || 'sites';
    const annual = annualColumn(id);
    const width = columnWidth(id);
    let content: React.ReactNode;
    let className = cell;
    if (id === 'groupName' || id === 'scope' || id === 'bu') {
      className =
        id === 'scope' && columns[0] === 'scope' ? scopeCell : inputCell;
      const value = id === 'groupName' ? row.groupName || '' : row[id];
      content = (
        <div
          style={{ width, maxWidth: width }}
          className={
            id === 'scope'
              ? 'w-[180px] max-w-[180px]'
              : id === 'bu'
                ? 'w-[72px] max-w-[72px]'
                : 'w-[160px] max-w-[160px]'
          }
        >
          {id === 'bu' ? (
            <BusinessUnitSelect
              aria-label={`BU for ${row.id}`}
              className={gridSelect}
              title={value}
              value={value}
              disabled={locked}
              onChange={(event) =>
                update(row.id, { field: 'bu', value: event.target.value })
              }
            />
          ) : (
            <Input
              aria-label={
                id === 'scope'
                  ? `Scope for row ${row.id}`
                  : `Group for ${row.id}`
              }
              className={gridInput}
              title={value}
              value={value}
              maxLength={id === 'scope' ? 500 : 200}
              disabled={locked}
              placeholder={id === 'groupName' ? 'Group name' : 'Scope'}
              onChange={(event) =>
                update(row.id, { field: id, value: event.target.value })
              }
            />
          )}
        </div>
      );
    } else if (id === 'reType') {
      className = inputCell;
      content = (
        <div className="w-[120px] max-w-[120px]">
          <select
            aria-label={`RE Type for ${row.id}`}
            className={gridSelect}
            title={
              re
                ? `${re.code} · ${re.name} · ${re.pool}${!re.active ? ' · Inactive' : ''}`
                : row.reTypeId
            }
            value={row.reTypeId}
            disabled={locked}
            onChange={(event) =>
              update(row.id, { field: 'reTypeId', value: event.target.value })
            }
          >
            {unknown && (
              <option value={row.reTypeId}>
                {row.reTypeId ? `Unknown: ${row.reTypeId}` : 'Select RE Type'}
              </option>
            )}
            {resources
              .filter(
                (resource) =>
                  resource.category === 'internal' &&
                  (resource.active || resource.id === row.reTypeId),
              )
              .map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                  {!resource.active ? ' · Inactive' : ''}
                </option>
              ))}
          </select>
        </div>
      );
    } else if (id === 'mdPerSite') {
      className = inputCell;
      content = (
        <div className="w-[64px] max-w-[64px]">
          {mode === 'sites' ? (
            <PersonnelNumberInput
              label={`Mandays per site for ${row.id}`}
              value={row.mdPerSite}
              locked={locked || unknown}
              announce={announce}
              onChange={(value) =>
                update(row.id, { field: 'mdPerSite', value })
              }
            />
          ) : (
            <span className="block px-2 text-right text-muted-foreground">
              —
            </span>
          )}
        </div>
      );
    } else if (id === 'totalSites') content = number(totalRowSites(row));
    else if (id === 'totalMd') content = number(totalRowMandays(row));
    else if (id === 'totalCost') content = money(totalRowCost(row));
    else if (annual) {
      const { index, field } = annual;
      if (
        (field === 'sites' && mode === 'sites') ||
        (field === 'mandays' && mode === 'mandays')
      ) {
        className = inputCell;
        content = (
          <PersonnelNumberInput
            label={`${YEAR_BUCKETS[index]} ${field === 'sites' ? 'sites' : 'direct mandays'} for ${row.id}`}
            value={row.years[index]?.[field] || 0}
            integer={field === 'sites'}
            locked={locked || unknown}
            announce={announce}
            onChange={(value) =>
              update(row.id, { field: 'year', yearIndex: index, mode, value })
            }
          />
        );
      } else {
        className = `${cell} bg-[#f5f7f5]`;
        content =
          field === 'sites'
            ? '—'
            : field === 'mandays'
              ? number(yearRowMandays(row, index))
              : money(row.years[index]?.cost || 0);
      }
    } else if (id === 'check') {
      const issue = personnelRowIssue(row, resources, rates);
      className = 'px-2 py-0 text-center';
      content = (
        <span
          title={issue || 'Calculated'}
          className={issue ? 'text-amber-800' : 'text-emerald-700'}
        >
          {issue ? 'Review' : 'OK'}
        </span>
      );
    } else {
      const position = displayedRows.findIndex((line) => line.id === row.id);
      const up = displayedRows[position - 1],
        down = displayedRows[position + 1];
      className =
        'sticky right-0 z-10 border-l border-border bg-card px-1 py-0 text-center';
      content = (
        <div className="flex h-8 items-center justify-center gap-0">
          <button
            type="button"
            draggable={!locked && !!onMoveRow}
            disabled={locked || !onMoveRow}
            aria-label={`Drag cost row ${row.id}`}
            title="Drag above/below a row or onto a group header"
            className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:cursor-default disabled:opacity-40"
            onDragStart={(event) => {
              if (locked || !onMoveRow) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData(PERSONNEL_ROW_DRAG, row.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
          >
            <GripVertical className="size-3.5" />
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-5"
            disabled={locked || !onMoveRow || !up}
            aria-label={`Move cost row ${row.id} up`}
            onClick={() => {
              if (up)
                move({
                  rowId: row.id,
                  targetRowId: up.id,
                  position: 'before',
                  ...(grouped
                    ? { groupName: (up.groupName || '').trim() }
                    : {}),
                });
            }}
          >
            <ArrowUp className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-5"
            disabled={locked || !onMoveRow || !down}
            aria-label={`Move cost row ${row.id} down`}
            onClick={() => {
              if (down)
                move({
                  rowId: row.id,
                  targetRowId: down.id,
                  position: 'after',
                  ...(grouped
                    ? { groupName: (down.groupName || '').trim() }
                    : {}),
                });
            }}
          >
            <ArrowDown className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-5 text-destructive"
            disabled={locked}
            aria-label={`Delete cost row ${row.scope || row.id}`}
            onClick={() => {
              if (!locked) onDelete(row);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      );
    }
    return (
      <TableCell
        key={id}
        data-personnel-column={id}
        style={{ width, minWidth: width, maxWidth: width }}
        className={className}
      >
        {content}
      </TableCell>
    );
  };
  return (
    <Table
      className="w-max min-w-full text-[11px]"
      onDragEnd={(event) => {
        event.currentTarget
          .querySelectorAll('[data-drop-position]')
          .forEach((element) => element.removeAttribute('data-drop-position'));
      }}
    >
      <caption className="sr-only">
        Inline cost grid. Edit Group, Scope, BU, RE Type and annual effort
        directly.
      </caption>
      <TableHeader>
        <TableRow className="h-8 bg-[#e9e6de]">
          {segments.map((segment, segmentIndex) =>
            segment.index === undefined ? (
              <TableHead
                key={`${segment.ids[0]}:${segmentIndex}`}
                rowSpan={hasAnnual ? 2 : 1}
                data-personnel-column={segment.ids[0]}
                style={{
                  width: columnWidth(segment.ids[0]),
                  minWidth: columnWidth(segment.ids[0]),
                  maxWidth: columnWidth(segment.ids[0]),
                }}
                className={`h-8 border-r border-border px-2 ${segment.ids[0] === 'action' ? 'sticky right-0 z-20 border-l bg-[#e9e6de]' : segment.ids[0] === 'scope' && columns[0] === 'scope' ? 'sticky left-0 z-20 bg-[#e9e6de]' : ''}`}
              >
                {getPersonnelColumnSpec(segment.ids[0])?.label}
              </TableHead>
            ) : (
              <TableHead
                key={`year:${segmentIndex}`}
                colSpan={segment.ids.length}
                className="h-8 border-r border-border px-2 text-center"
              >
                {YEAR_BUCKETS[segment.index]}{' '}
                <span className="font-normal text-muted-foreground">
                  · {actualYears[segment.index] ?? 'Set dates'}
                </span>
              </TableHead>
            ),
          )}
        </TableRow>
        {hasAnnual && (
          <TableRow className="h-7 bg-[#f2f0ea]">
            {columns
              .filter((id) => annualColumn(id))
              .map((id) => {
                const annual = annualColumn(id)!;
                return (
                  <TableHead
                    key={id}
                    data-personnel-column={id}
                    style={{ minWidth: columnWidth(id) }}
                    className="h-7 border-r border-border px-2 text-right"
                  >
                    {getPersonnelAnnualColumnLabel(annual.field)}
                  </TableHead>
                );
              })}
          </TableRow>
        )}
      </TableHeader>
      <TableBody>
        {!hasAnnual && (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="px-2 py-2 text-xs text-muted-foreground"
            >
              No columns selected for{' '}
              {yearIndex === 'all' ? 'annual effort' : YEAR_BUCKETS[yearIndex]}.
              Use Columns to show them.
            </TableCell>
          </TableRow>
        )}
        {entries.map((entry) => {
          if (entry.kind === 'group') {
            const title = entry.groupName || UNASSIGNED_PERSONNEL_GROUP;
            return (
              <TableRow
                key={`group:${entry.groupName}`}
                data-personnel-group={entry.groupName}
                className="h-8 bg-[#e8efed] hover:bg-[#e8efed] data-[drop-position=group]:bg-[#bcd9cf]"
                onDragOver={(event) => {
                  if (allowDrop(event))
                    event.currentTarget.setAttribute?.(
                      'data-drop-position',
                      'group',
                    );
                }}
                onDragLeave={(event) =>
                  event.currentTarget.removeAttribute('data-drop-position')
                }
                onDrop={(event) => {
                  event.currentTarget.removeAttribute?.('data-drop-position');
                  if (locked || !onMoveRow) return;
                  const rowId = draggedRow(event);
                  if (!rowId) return;
                  event.preventDefault();
                  move({
                    rowId,
                    position: 'group-end',
                    groupName: entry.groupName,
                  });
                }}
              >
                <TableCell colSpan={columns.length} className="h-8 px-2 py-0">
                  <form
                    className="sticky left-2 inline-flex max-w-[440px] items-center gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (locked || !onRenameGroup) return;
                      const value = (
                        event.currentTarget.elements.namedItem(
                          'groupName',
                        ) as HTMLInputElement | null
                      )?.value;
                      if (value === undefined || value.trim().length > 200)
                        return;
                      onRenameGroup({
                        groupName: entry.groupName,
                        nextGroupName: value.trim(),
                        rowIds: [...entry.rowIds],
                      });
                    }}
                  >
                    <Input
                      name="groupName"
                      aria-label={`Group name ${title}`}
                      defaultValue={entry.groupName}
                      placeholder="Unassigned Group"
                      title={title}
                      maxLength={200}
                      disabled={locked || !onRenameGroup}
                      className="h-7 w-[260px] rounded-sm border-transparent bg-transparent px-1 text-[11px] font-semibold text-[#315764] focus-visible:bg-white"
                    />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1 text-[10px]"
                      disabled={locked || !onRenameGroup}
                      aria-label={`Save group name ${title}`}
                      title="Renaming to an existing group merges these rows into it."
                    >
                      <Save className="size-3" />
                      Save / Merge
                    </Button>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {entry.rowIds.length}{' '}
                      {entry.rowIds.length === 1 ? 'row' : 'rows'}
                    </span>
                  </form>
                </TableCell>
              </TableRow>
            );
          }
          const row = entry.row;
          return (
            <TableRow
              key={`row:${row.id}`}
              data-personnel-row={row.id}
              className="h-8 data-[drop-position=before]:border-t-2 data-[drop-position=before]:border-t-[#315764] data-[drop-position=after]:border-b-2 data-[drop-position=after]:border-b-[#315764]"
              onDragOver={(event) => {
                if (!allowDrop(event)) return;
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.setAttribute?.(
                  'data-drop-position',
                  personnelDropPosition(event.clientY, rect.top, rect.height),
                );
              }}
              onDragLeave={(event) =>
                event.currentTarget.removeAttribute('data-drop-position')
              }
              onDrop={(event) => {
                event.currentTarget.removeAttribute?.('data-drop-position');
                if (locked || !onMoveRow) return;
                const rowId = draggedRow(event);
                if (!rowId || rowId === row.id) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                move({
                  rowId,
                  targetRowId: row.id,
                  position: personnelDropPosition(
                    event.clientY,
                    rect.top,
                    rect.height,
                  ),
                  ...(grouped
                    ? { groupName: (row.groupName || '').trim() }
                    : {}),
                });
              }}
            >
              {columns.map((id) => renderRowCell(row, id))}
            </TableRow>
          );
        })}
        {!rows.length && (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="p-4 text-center text-muted-foreground"
            >
              No cost rows. Add Row to begin.
            </TableCell>
          </TableRow>
        )}
        {!!rows.length && (
          <TableRow className="bg-[#eeece6] font-semibold">
            {columns.map((id) => {
              const annual = annualColumn(id);
              let value: string =
                id === textColumn ? `Visible Total · ${rows.length} rows` : '';
              if (id === 'totalSites')
                value = number(
                  rows.reduce((sum, row) => sum + totalRowSites(row), 0),
                );
              else if (id === 'totalMd')
                value = number(
                  rows.reduce((sum, row) => sum + totalRowMandays(row), 0),
                );
              else if (id === 'totalCost')
                value = money(
                  roundMoney(
                    rows.reduce((sum, row) => sum + totalRowCost(row), 0),
                  ),
                );
              else if (annual) {
                const total = rows.reduce(
                  (sum, row) =>
                    sum +
                    (annual.field === 'mandays'
                      ? yearRowMandays(row, annual.index)
                      : row.years[annual.index]?.[annual.field] || 0),
                  0,
                );
                value =
                  annual.field === 'cost'
                    ? money(roundMoney(total))
                    : number(total);
              }
              return (
                <TableCell
                  key={id}
                  data-personnel-column={id}
                  className={
                    id === 'action'
                      ? 'sticky right-0 z-10 border-l border-border bg-[#eeece6] px-1 py-0'
                      : id === 'scope' && columns[0] === 'scope'
                        ? 'sticky left-0 z-10 border-r border-border bg-[#eeece6] px-2 py-0'
                        : cell
                  }
                >
                  {value}
                </TableCell>
              );
            })}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export function hasPartialLegacyAllowance(
  settings: RateSettings,
  resources: ResourceType[],
) {
  if (
    settings.allowancePools !== undefined ||
    !Array.isArray(settings.allowanceResourceTypeIds)
  )
    return false;
  return PERSONNEL_POOLS.some((pool) => {
    const candidates = resources.filter(
      (resource) => resource.category === 'internal' && resource.pool === pool,
    );
    const selected = candidates.filter((resource) =>
      settings.allowanceResourceTypeIds!.includes(resource.id),
    );
    return selected.length > 0 && selected.length < candidates.length;
  });
}
export function PersonnelAllowanceOptions({
  selectedPools,
  onToggle,
  locked = false,
  partialLegacy = false,
}: {
  selectedPools: PersonnelPool[];
  onToggle: (pool: PersonnelPool, selected: boolean) => void;
  locked?: boolean;
  partialLegacy?: boolean;
}) {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="font-medium">3% Allowance</span>
        {PERSONNEL_POOLS.map((pool) => (
          <label key={pool} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              aria-label={`3% allowance for ${pool}`}
              checked={selectedPools.includes(pool)}
              disabled={locked}
              onChange={(event) => {
                if (!locked) onToggle(pool, event.target.checked);
              }}
            />
            {pool}
          </label>
        ))}
      </div>
      {partialLegacy && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Existing individual selections are retained until edited. Changing
          these choices applies 3% to all RE Types in the selected Pools.
        </p>
      )}
    </div>
  );
}
