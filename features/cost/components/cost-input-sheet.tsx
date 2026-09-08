/** Direct personnel spreadsheet entry with optional year focus and Pool allowances. */
import { useState } from 'react';
import { Plus, Upload } from 'lucide-react';
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

export function CostInputSheet({
  rows: allRows,
  setRows: setAllRows,
  rateSettings,
  setRateSettings,
  resourceTypes: allResourceTypes,
  includedTravelCost,
  announce,
  locked = false,
}: {
  rows: CostInputRow[];
  setRows: React.Dispatch<React.SetStateAction<CostInputRow[]>>;
  rateSettings: RateSettings;
  setRateSettings: React.Dispatch<React.SetStateAction<RateSettings>>;
  resourceTypes: ResourceType[];
  includedTravelCost: number;
  announce: (message: string) => void;
  locked?: boolean;
}) {
  const [showImport, setShowImport] = useState(false);
  const [yearIndex, setYearIndex] = useState<PersonnelYear>('all');
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
    announce('Personnel row added at the top. Edit its cells directly.');
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
        `Switch ${plan.affectedCount} personnel row(s) to Sites? This clears ${plan.clearedMandays.toLocaleString('en-SG', { maximumFractionDigits: 4 })} MD across Y1–Y5. Enter the actual site counts and MD per Site.`,
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
              'Personnel effort changed. Review the latest rows and try the mode switch again.',
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
    <section className="min-w-0 overflow-hidden border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Personnel Input</h2>
          {locked ? (
            <StatusBadge tone="gray">Locked · View only</StatusBadge>
          ) : (
            <StatusBadge tone={issues.length ? 'amber' : 'green'}>
              {issues.length ? `${issues.length} to review` : 'Calculated'}
            </StatusBadge>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={locked}
            onClick={() => {
              if (!locked) setShowImport(!showImport);
            }}
          >
            <Upload className="size-3" />
            Import
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={locked || !resources.some((resource) => resource.active)}
            onClick={openNew}
          >
            <Plus className="size-3" />
            Add Personnel
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border min-[480px]:grid-cols-3">
        <div className="bg-[#f7f5f0] px-3 py-2">
          <p className="text-[10px] text-muted-foreground">
            Personnel Cost · All Years
          </p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatSgd(totalCost)}
          </p>
        </div>
        <div className="bg-[#f7f5f0] px-3 py-2">
          <p className="text-[10px] text-muted-foreground">Total Mandays</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {totalMd.toLocaleString('en-SG', { maximumFractionDigits: 4 })} MD
          </p>
        </div>
        <div className="col-span-2 bg-[#f7f5f0] px-3 py-2 min-[480px]:col-span-1">
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
      <div className="overflow-x-auto border-b border-border bg-[#f8f7f3] px-3 py-2">
        <div className="flex min-w-max items-center gap-3">
          <div
            className="flex shrink-0 gap-0.5"
            aria-label="Personnel delivery year"
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
                className="h-7 px-2 text-[11px]"
                aria-pressed={yearIndex === year.value}
                onClick={() => setYearIndex(year.value)}
              >
                {year.label}
              </Button>
            ))}
          </div>
          <fieldset
            className="flex shrink-0 items-center gap-1.5 border-l border-border pl-3"
            aria-label="Personnel input mode"
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
                  className="h-6 px-2 text-[11px]"
                  aria-pressed={inputMode === mode}
                  disabled={locked}
                  title={`Set all personnel rows to ${label}`}
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
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {rows.length} rows
          </span>
        </div>
      </div>
      {showImport && !locked && (
        <CostImportPanel
          rows={rows}
          setRows={setRows}
          resources={resources}
          rates={rateSettings}
          onClose={() => setShowImport(false)}
        />
      )}
      <PersonnelLinesTable
        rows={rows}
        resources={resources}
        rates={rateSettings}
        actualYears={actualYears}
        yearIndex={yearIndex}
        locked={locked}
        announce={announce}
        onPatch={(id, patch) => {
          if (locked) return;
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
      <div className="border-t border-border bg-[#f7f5f0] px-3 py-2 text-[10px] leading-4 text-muted-foreground">
        Sites × MD/Site or Direct MD → RE rate × annual uplift × selected
        allowance. MD/Site applies to all years for that row. Draft changes save
        automatically. Subcontract costs are managed in Subcon.
      </div>
    </section>
  );
}
