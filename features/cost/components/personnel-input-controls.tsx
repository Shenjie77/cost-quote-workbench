/** Compact spreadsheet-style personnel entry. Mutations patch the latest raw inputs. */
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export type PersonnelYear = number | 'all';
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
export const PERSONNEL_POOLS: PersonnelPool[] = ['LOCAL', 'ARP', 'HQ', 'OTHER'];
export type PersonnelInputPatch =
  | { field: 'scope' | 'bu' | 'reTypeId'; value: string }
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
    if (patch.field === 'scope' || patch.field === 'bu') {
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

export function PersonnelLinesTable({
  rows,
  resources,
  rates,
  actualYears,
  yearIndex = 'all',
  onPatch,
  onDelete,
  locked = false,
  announce,
}: {
  rows: CostInputRow[];
  resources: ResourceType[];
  rates: RateSettings;
  actualYears: (number | null)[];
  yearIndex?: PersonnelYear;
  onPatch: (id: string, patch: PersonnelInputPatch) => void;
  onDelete: (row: CostInputRow) => void;
  locked?: boolean;
  announce: (message: string) => void;
}) {
  const years =
    yearIndex === 'all' ? YEAR_BUCKETS.map((_, index) => index) : [yearIndex];
  const update = (id: string, patch: PersonnelInputPatch) => {
    if (!locked) onPatch(id, patch);
  };
  return (
    <Table className="w-max min-w-full text-[11px]">
      <caption className="sr-only">
        Inline personnel cost grid. Edit Scope, BU, RE Type and annual effort
        directly.
      </caption>
      <TableHeader>
        <TableRow className="h-8 bg-[#e9e6de]">
          <TableHead
            rowSpan={2}
            className="sticky left-0 z-20 w-[180px] min-w-[180px] border-r border-border bg-[#e9e6de] px-2"
          >
            Scope
          </TableHead>
          <TableHead
            rowSpan={2}
            className="w-[72px] min-w-[72px] max-w-[72px] border-r border-border px-2"
          >
            BU
          </TableHead>
          <TableHead
            rowSpan={2}
            className="w-[120px] min-w-[120px] max-w-[120px] border-r border-border px-2"
          >
            RE Type
          </TableHead>
          <TableHead
            rowSpan={2}
            className="w-[64px] min-w-[64px] max-w-[64px] border-r border-border px-2 text-right"
          >
            MD/Site
          </TableHead>
          <TableHead
            rowSpan={2}
            className="min-w-[68px] border-r border-border px-2 text-right"
          >
            Total Sites
          </TableHead>
          <TableHead
            rowSpan={2}
            className="min-w-[75px] border-r border-border px-2 text-right"
          >
            Total MD
          </TableHead>
          <TableHead
            rowSpan={2}
            className="min-w-[105px] border-r border-border px-2 text-right"
          >
            Total Cost
          </TableHead>
          {years.map((index) => (
            <TableHead
              key={index}
              colSpan={3}
              className="h-8 border-r border-border px-2 text-center"
            >
              {YEAR_BUCKETS[index]}{' '}
              <span className="font-normal text-muted-foreground">
                · {actualYears[index] ?? 'Set dates'}
              </span>
            </TableHead>
          ))}
          <TableHead rowSpan={2} className="min-w-[70px] px-2 text-center">
            Check
          </TableHead>
          <TableHead rowSpan={2} className="min-w-[48px] px-1 text-center">
            Action
          </TableHead>
        </TableRow>
        <TableRow className="h-7 bg-[#f2f0ea]">
          {years.flatMap((index) => [
            <TableHead
              key={`sites-${index}`}
              className="h-7 min-w-[65px] border-r border-border px-2 text-right"
            >
              Sites
            </TableHead>,
            <TableHead
              key={`md-${index}`}
              className="h-7 min-w-[76px] border-r border-border px-2 text-right"
            >
              Mandays
            </TableHead>,
            <TableHead
              key={`cost-${index}`}
              className="h-7 min-w-[105px] border-r border-border px-2 text-right"
            >
              Cost (SGD)
            </TableHead>,
          ])}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const re = resources.find((resource) => resource.id === row.reTypeId);
          const unknown = !re || re.category !== 'internal';
          const issue = personnelRowIssue(row, resources, rates);
          const mode = row.inputMode || 'sites';
          return (
            <TableRow key={row.id} className="h-8">
              <TableCell className={scopeCell}>
                <div className="w-[180px] max-w-[180px]">
                  <Input
                    aria-label={`Scope for row ${row.id}`}
                    className={gridInput}
                    title={row.scope}
                    value={row.scope}
                    maxLength={500}
                    disabled={locked}
                    placeholder="Scope"
                    onChange={(event) =>
                      update(row.id, {
                        field: 'scope',
                        value: event.target.value,
                      })
                    }
                  />
                </div>
              </TableCell>
              <TableCell className={inputCell}>
                <div className="w-[72px] max-w-[72px]">
                  <Input
                    aria-label={`BU for ${row.id}`}
                    className={gridInput}
                    value={row.bu}
                    title={row.bu}
                    maxLength={200}
                    disabled={locked}
                    placeholder="BU"
                    onChange={(event) =>
                      update(row.id, { field: 'bu', value: event.target.value })
                    }
                  />
                </div>
              </TableCell>
              <TableCell className={inputCell}>
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
                      update(row.id, {
                        field: 'reTypeId',
                        value: event.target.value,
                      })
                    }
                  >
                    {unknown && (
                      <option value={row.reTypeId}>
                        {row.reTypeId
                          ? `Unknown: ${row.reTypeId}`
                          : 'Select RE Type'}
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
              </TableCell>
              <TableCell className={inputCell}>
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
              </TableCell>
              <TableCell className={cell}>
                {number(totalRowSites(row))}
              </TableCell>
              <TableCell className={cell}>
                {number(totalRowMandays(row))}
              </TableCell>
              <TableCell className={`${cell} font-medium`}>
                {money(totalRowCost(row))}
              </TableCell>
              {years.flatMap((index) => [
                <TableCell key={`sites-${index}`} className={inputCell}>
                  {mode === 'sites' ? (
                    <PersonnelNumberInput
                      label={`${YEAR_BUCKETS[index]} sites for ${row.id}`}
                      value={row.years[index]?.sites || 0}
                      integer
                      locked={locked || unknown}
                      announce={announce}
                      onChange={(value) =>
                        update(row.id, {
                          field: 'year',
                          yearIndex: index,
                          mode,
                          value,
                        })
                      }
                    />
                  ) : (
                    <span className="block px-2 text-right text-muted-foreground">
                      —
                    </span>
                  )}
                </TableCell>,
                <TableCell
                  key={`md-${index}`}
                  className={
                    mode === 'mandays' ? inputCell : `${cell} bg-[#f5f7f5]`
                  }
                >
                  {mode === 'mandays' ? (
                    <PersonnelNumberInput
                      label={`${YEAR_BUCKETS[index]} direct mandays for ${row.id}`}
                      value={row.years[index]?.mandays || 0}
                      locked={locked || unknown}
                      announce={announce}
                      onChange={(value) =>
                        update(row.id, {
                          field: 'year',
                          yearIndex: index,
                          mode,
                          value,
                        })
                      }
                    />
                  ) : (
                    number(yearRowMandays(row, index))
                  )}
                </TableCell>,
                <TableCell
                  key={`cost-${index}`}
                  className={`${cell} bg-[#f5f7f5]`}
                >
                  {money(row.years[index]?.cost || 0)}
                </TableCell>,
              ])}
              <TableCell className="px-2 py-0 text-center">
                <span
                  title={issue || 'Calculated'}
                  className={issue ? 'text-amber-800' : 'text-emerald-700'}
                >
                  {issue ? 'Review' : 'OK'}
                </span>
              </TableCell>
              <TableCell className="px-1 py-0 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={locked}
                  aria-label={`Delete cost row ${row.scope || row.id}`}
                  title="Delete row"
                  onClick={() => {
                    if (!locked) onDelete(row);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
        {!rows.length && (
          <TableRow>
            <TableCell
              colSpan={9 + years.length * 3}
              className="py-8 text-center text-muted-foreground"
            >
              No matching personnel rows.
            </TableCell>
          </TableRow>
        )}
        {!!rows.length && (
          <TableRow className="bg-[#eeece6] font-semibold">
            <TableCell className="sticky left-0 z-10 border-r border-border bg-[#eeece6] px-2">
              Visible Total
            </TableCell>
            <TableCell
              colSpan={3}
              className="border-r border-border px-2 text-muted-foreground"
            >
              {rows.length} rows
            </TableCell>
            <TableCell className={cell}>
              {number(rows.reduce((sum, row) => sum + totalRowSites(row), 0))}
            </TableCell>
            <TableCell className={cell}>
              {number(rows.reduce((sum, row) => sum + totalRowMandays(row), 0))}
            </TableCell>
            <TableCell className={cell}>
              {money(
                roundMoney(
                  rows.reduce((sum, row) => sum + totalRowCost(row), 0),
                ),
              )}
            </TableCell>
            {years.flatMap((index) => [
              <TableCell key={`sites-${index}`} className={cell}>
                {number(
                  rows.reduce(
                    (sum, row) => sum + (row.years[index]?.sites || 0),
                    0,
                  ),
                )}
              </TableCell>,
              <TableCell key={`md-${index}`} className={cell}>
                {number(
                  rows.reduce(
                    (sum, row) => sum + yearRowMandays(row, index),
                    0,
                  ),
                )}
              </TableCell>,
              <TableCell key={`cost-${index}`} className={cell}>
                {money(
                  roundMoney(
                    rows.reduce(
                      (sum, row) => sum + (row.years[index]?.cost || 0),
                      0,
                    ),
                  ),
                )}
              </TableCell>,
            ])}
            <TableCell colSpan={2} />
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
