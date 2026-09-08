/** Version-owned subcontract BOQs with focused quantity entry and staged catalogue selection. */
import { useState } from 'react';
import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SubcontractItem } from '@/features/master-data/types';
import { YEAR_BUCKETS, roundMoney, type CostInputRow } from '../domain';
import {
  calculateSubcontractCost,
  type SubcontractCost,
  type SubcontractLineBase,
  type SubcontractCostLine,
  type SubcontractSiteLine,
  type SubcontractSiteType,
} from '../subcontract-domain';
import { SubcontractCatalogPicker } from './subcontract-catalog-picker';
import {
  SubcontractItemDialog,
  SubcontractLinesTable,
  SubcontractNumberInput,
} from './subcontract-lines-table';
export { SubcontractCatalogPicker } from './subcontract-catalog-picker';
export {
  SubcontractLinesTable,
  SubcontractNumberInput,
} from './subcontract-lines-table';

const zeroYears = () => [0, 0, 0, 0, 0];
const id = () => globalThis.crypto.randomUUID();
const money = (amount: number) =>
  amount.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const yearLabel = (years: (number | null)[], index: number) =>
  `${YEAR_BUCKETS[index]}${years[index] ? ` · ${years[index]}` : ''}`;
const selectClass = 'h-8 min-w-0 rounded-md border bg-background px-2 text-xs';

/** Catalogue values are copied once; future catalogue edits cannot reprice a BOQ. */
export function copySubcontractCatalogLine(
  item: SubcontractItem,
): SubcontractLineBase {
  if (item.currency.trim().toUpperCase() !== 'SGD')
    throw new Error(
      'Only SGD catalogue items can be added. Convert the price to SGD before adding this item.',
    );
  if (!item.unit?.trim())
    throw new Error(
      'This catalogue item has no unit. Set its catalogue unit or add a manual item.',
    );
  return {
    id: id(),
    catalogItemId: item.id,
    code: item.code,
    description: item.item,
    bu: item.bu,
    unit: item.unit,
    unitPrice: item.unitPrice ?? null,
    currency: 'SGD',
  };
}
export function changeSubcontractMode(
  value: SubcontractCost,
  mode: SubcontractCost['mode'],
): SubcontractCost {
  if (
    mode === 'project' &&
    value.siteTypes.some(
      (site) => site.lines.length > 0 || site.sites.some((count) => count > 0),
    )
  )
    throw new Error(
      'Remove populated site types before switching to Project Total. Their costs cannot be hidden.',
    );
  return { ...value, mode };
}
/** Copy the configuration, leaving deployment counts for the new site type to be entered. */
export function duplicateSubcontractSiteType(
  site: SubcontractSiteType,
): SubcontractSiteType {
  return {
    ...structuredClone(site),
    id: id(),
    name: `${site.name} (Copy)`,
    sites: zeroYears(),
    lines: site.lines.map((line) => ({ ...structuredClone(line), id: id() })),
  };
}
export type SubcontractTarget =
  | { kind: 'project' }
  | { kind: 'site'; id: string };

/** Append a batch once, scoped to one BOQ; already-adopted catalogue entries are skipped. */
export function appendSubcontractLines(
  value: SubcontractCost,
  bases: SubcontractLineBase[],
  target: SubcontractTarget,
): SubcontractCost {
  if (target.kind === 'site' && value.mode !== 'site-types')
    throw new Error(
      'The cost model has changed. Switch to Site Types before adding site items.',
    );
  const site =
    target.kind === 'project'
      ? null
      : value.siteTypes.find((entry) => entry.id === target.id);
  if (target.kind !== 'project' && !site)
    throw new Error(
      'This site type is no longer available. Select a site type and try again.',
    );
  const existing = new Set(
    (site ? site.lines : value.lines)
      .map((line) => line.catalogItemId)
      .filter(Boolean),
  );
  const additions = bases.filter((base) => {
    if (!base.catalogItemId) return true;
    if (existing.has(base.catalogItemId)) return false;
    existing.add(base.catalogItemId);
    return true;
  });
  if (!additions.length) return value;
  if (!site)
    return {
      ...value,
      lines: [
        ...value.lines,
        ...additions.map((base) => ({ ...base, quantities: zeroYears() })),
      ],
    };
  return {
    ...value,
    siteTypes: value.siteTypes.map((entry) =>
      target.kind === 'site' && entry.id === target.id
        ? {
            ...entry,
            lines: [
              ...entry.lines,
              ...additions.map((base) => ({ ...base, quantityPerSite: 0 })),
            ],
          }
        : entry,
    ),
  };
}
/** Clearing the last site item also clears deployments so the draft stays valid. */
export function removeSubcontractSiteLine(
  site: SubcontractSiteType,
  lineId: string,
): SubcontractSiteType {
  const lines = site.lines.filter((line) => line.id !== lineId);
  return { ...site, lines, sites: lines.length ? site.sites : zeroYears() };
}

const manualLine = (): SubcontractLineBase => {
  const lineId = id();
  return {
    id: lineId,
    code: `MANUAL-${lineId.slice(0, 8).toUpperCase()}`,
    description: '',
    bu: 'Unassigned',
    unit: 'pcs',
    unitPrice: null,
    currency: 'SGD',
  };
};

export function SubcontractCostSheet({
  value,
  onChange,
  catalog,
  actualYears,
  lockedReason,
  legacyRows = [],
  onRemoveLegacyRow,
  onRefreshCatalog,
  announce,
}: {
  value: SubcontractCost;
  onChange: (value: SubcontractCost) => void;
  catalog: SubcontractItem[];
  actualYears: (number | null)[];
  lockedReason?: string | null;
  legacyRows?: CostInputRow[];
  onRemoveLegacyRow?: (id: string) => void;
  onRefreshCatalog?: () => Promise<SubcontractItem[]>;
  announce: (message: string) => void;
}) {
  const locked = !!lockedReason;
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [catalogTarget, setCatalogTarget] = useState<SubcontractTarget | null>(
    null,
  );
  const [manualDraft, setManualDraft] = useState<{
    target: SubcontractTarget;
    line: SubcontractCostLine | SubcontractSiteLine;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [projectYear, setProjectYear] = useState<number | 'all'>(0);
  const [sharedExpanded, setSharedExpanded] = useState(value.lines.length > 0);
  const [query, setQuery] = useState('');
  const [refreshedCatalog, setRefreshedCatalog] = useState<{
    source: SubcontractItem[];
    items: SubcontractItem[];
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const selectedSite =
    value.siteTypes.find((site) => site.id === selectedSiteId) ||
    value.siteTypes[0];
  const summary = calculateSubcontractCost(value);
  const selectedSummary = summary.siteTypes.find(
    (site) => site.id === selectedSite?.id,
  );
  const years = summary.years.map((amount, index) =>
    roundMoney(
      amount +
        legacyRows.reduce((sum, row) => sum + (row.years[index]?.cost || 0), 0),
    ),
  );
  const total = roundMoney(years.reduce((sum, amount) => sum + amount, 0));
  const projectTotal = roundMoney(
    summary.lines.reduce((sum, line) => sum + line.total, 0),
  );
  const unpriced = [
    ...value.lines,
    ...(value.mode === 'site-types'
      ? value.siteTypes.flatMap((site) => site.lines)
      : []),
  ].filter((line) => line.unitPrice === null).length;
  const showProjectLines = value.mode === 'project' || sharedExpanded;
  const change = (next: SubcontractCost) => {
    if (!locked) onChange(next);
  };
  const updateSite = (site: SubcontractSiteType) =>
    change({
      ...value,
      siteTypes: value.siteTypes.map((entry) =>
        entry.id === site.id ? site : entry,
      ),
    });
  const addLines = (
    bases: SubcontractLineBase[],
    target: SubcontractTarget,
  ) => {
    if (locked) return false;
    try {
      const next = appendSubcontractLines(value, bases, target);
      if (next !== value) change(next);
      return true;
    } catch (error) {
      announce(
        error instanceof Error ? error.message : 'Unable to add these items.',
      );
      return false;
    }
  };
  const openCatalog = (target: SubcontractTarget) => {
    if (!locked) {
      setQuery('');
      setCatalogTarget(target);
    }
  };
  const openManual = (target: SubcontractTarget) => {
    if (locked) return;
    const base = manualLine();
    setManualDraft({
      target,
      line:
        target.kind === 'project'
          ? { ...base, quantities: zeroYears() }
          : { ...base, quantityPerSite: 0 },
    });
  };
  const addSite = () => {
    if (locked) return;
    let suffix = 1;
    while (value.siteTypes.some((site) => site.name === `Site Type ${suffix}`))
      suffix++;
    const site = {
      id: id(),
      name: `Site Type ${suffix}`,
      sites: zeroYears(),
      lines: [],
    };
    change({
      ...value,
      mode: 'site-types',
      siteTypes: [...value.siteTypes, site],
    });
    setSelectedSiteId(site.id);
  };
  const refresh = async () => {
    if (!onRefreshCatalog || refreshing) return;
    setRefreshing(true);
    try {
      setRefreshedCatalog({ source: catalog, items: await onRefreshCatalog() });
      announce('Catalogue refreshed. Existing BOQ prices remain unchanged.');
    } catch (error) {
      announce(
        error instanceof Error
          ? error.message
          : 'Unable to refresh the catalogue.',
      );
    } finally {
      setRefreshing(false);
    }
  };
  const targetLines =
    catalogTarget?.kind === 'project'
      ? value.lines
      : (value.siteTypes.find(
          (site) =>
            catalogTarget?.kind === 'site' && site.id === catalogTarget.id,
        )?.lines ?? []);
  return (
    <section className="min-w-0 space-y-3" aria-label="Subcontract cost">
      <div className="overflow-hidden rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3.5 py-3">
          <div>
            <h2 className="text-sm font-semibold">
              Subcontract Cost{' '}
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                2.3.2
              </span>
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Unit prices saved with this cost version.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
              <span className="block">Cost Model</span>
              <select
                aria-label="Subcontract cost model"
                className={selectClass}
                value={value.mode}
                disabled={locked}
                onChange={(event) => {
                  try {
                    change(
                      changeSubcontractMode(
                        value,
                        event.target.value as SubcontractCost['mode'],
                      ),
                    );
                  } catch (error) {
                    announce(
                      error instanceof Error
                        ? error.message
                        : 'Unable to switch cost model.',
                    );
                  }
                }}
              >
                <option value="project">Project Total</option>
                <option value="site-types">Site Types</option>
              </select>
            </label>
            <div className="border-l pl-4 text-right">
              <p className="text-[10px] font-medium text-muted-foreground">
                {unpriced ? 'Priced Subtotal' : 'Total'} · SGD
              </p>
              <p className="mt-0.5 text-xl font-semibold leading-7 tracking-tight tabular-nums text-[#245e65]">
                {money(total)}
              </p>
            </div>
          </div>
        </header>
        <div className="grid grid-cols-5 divide-x border-t bg-muted/20">
          {years.map((amount, index) => (
            <div key={index} className="min-w-0 px-2.5 py-2">
              <p className="whitespace-nowrap text-[10px] text-muted-foreground">
                {yearLabel(actualYears, index)}
              </p>
              <p className="mt-0.5 overflow-x-auto whitespace-nowrap text-xs font-semibold tabular-nums">
                {money(amount)}
              </p>
            </div>
          ))}
        </div>
      </div>
      {locked && (
        <output className="block rounded-md border bg-muted/30 px-3 py-2 text-xs">
          Read only · {lockedReason}
        </output>
      )}
      {unpriced > 0 && (
        <output className="block rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {unpriced} item(s) not priced · Subtotal excludes unpriced items. Set
          a price before confirming or exporting; 0 means a confirmed zero-cost
          item.
        </output>
      )}
      {value.mode === 'site-types' && (
        <section
          className="overflow-hidden rounded-lg border bg-card"
          aria-label="Site configuration"
        >
          <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2.5">
            <label
              htmlFor="subcontract-site-type"
              className="shrink-0 text-xs font-medium"
            >
              Site Type
            </label>
            <select
              id="subcontract-site-type"
              aria-label="Select subcontract site type"
              className={`${selectClass} flex-1`}
              value={selectedSite?.id ?? ''}
              onChange={(event) => setSelectedSiteId(event.target.value)}
            >
              {!value.siteTypes.length && (
                <option value="">No site types yet</option>
              )}
              {value.siteTypes.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ·{' '}
                  {site.sites.reduce((sum, count) => sum + count, 0)} sites
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={locked}
              onClick={addSite}
            >
              <Plus className="size-3.5" />
              New
            </Button>
            {selectedSite && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={locked}
                  aria-label="Rename site type"
                  title="Rename site type"
                  onClick={() => {
                    if (!locked)
                      setRenameDraft({
                        id: selectedSite.id,
                        name: selectedSite.name,
                      });
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={locked}
                  aria-label="Duplicate configuration"
                  title="Duplicate BOQ; enter new deployment counts"
                  onClick={() => {
                    if (locked) return;
                    const duplicate =
                      duplicateSubcontractSiteType(selectedSite);
                    change({
                      ...value,
                      siteTypes: [...value.siteTypes, duplicate],
                    });
                    setSelectedSiteId(duplicate.id);
                    announce(
                      'Site configuration copied. Enter annual site counts for the new site type.',
                    );
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={locked}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete site type"
                  title="Delete site type"
                  onClick={() => {
                    if (
                      locked ||
                      !window.confirm(
                        `Delete ${selectedSite.name} and its ${selectedSite.lines.length} BOQ item(s)?`,
                      )
                    )
                      return;
                    change({
                      ...value,
                      siteTypes: value.siteTypes.filter(
                        (site) => site.id !== selectedSite.id,
                      ),
                    });
                    setSelectedSiteId(null);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
          {selectedSite ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    BOQ per Site{' '}
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {selectedSite.lines.length} items
                    </span>
                  </h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Unit price × quantity per site
                  </p>
                </div>
                <AddLineActions
                  locked={locked}
                  onCatalog={() =>
                    openCatalog({ kind: 'site', id: selectedSite.id })
                  }
                  onManual={() =>
                    openManual({ kind: 'site', id: selectedSite.id })
                  }
                />
              </div>
              <SubcontractLinesTable
                lines={selectedSite.lines}
                actualYears={actualYears}
                locked={locked}
                onChange={(line) =>
                  updateSite({
                    ...selectedSite,
                    lines: selectedSite.lines.map((entry) =>
                      entry.id === line.id
                        ? (line as SubcontractSiteLine)
                        : entry,
                    ),
                  })
                }
                deleteConfirmation={(line) =>
                  selectedSite.lines.length === 1 &&
                  selectedSite.sites.some((count) => count > 0)
                    ? `Remove ${line.description || line.code} and clear all annual deployments for ${selectedSite.name}? This is its last BOQ item.`
                    : `Remove ${line.description || line.code} from ${selectedSite.name}?`
                }
                onDelete={(lineId) =>
                  updateSite(removeSubcontractSiteLine(selectedSite, lineId))
                }
                announce={announce}
              />
              <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Cost per Site
                  {selectedSite.lines.some((line) => line.unitPrice === null)
                    ? ' · Provisional'
                    : ''}
                </span>
                <strong className="tabular-nums">
                  SGD {money(selectedSummary?.unitCost || 0)}
                </strong>
              </div>
              <div className="space-y-2.5 border-t px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <h3 className="text-xs font-semibold">
                    Annual Site Deployments
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedSite.sites.reduce((sum, count) => sum + count, 0)}{' '}
                    sites · SGD {money(selectedSummary?.total || 0)}
                  </span>
                </div>
                {!selectedSite.lines.length && (
                  <p className="text-[11px] text-muted-foreground">
                    Add BOQ items first, then enter the number of sites for each
                    year.
                  </p>
                )}
                <div className="grid grid-cols-5 gap-2">
                  {selectedSite.sites.map((count, index) => (
                    <div key={index} className="min-w-0 space-y-1.5">
                      <p className="whitespace-nowrap text-[10px] font-medium text-muted-foreground">
                        {yearLabel(actualYears, index)}
                      </p>
                      <SubcontractNumberInput
                        value={count}
                        integer
                        locked={locked || !selectedSite.lines.length}
                        label={`${selectedSite.name} ${YEAR_BUCKETS[index]} sites`}
                        onChange={(next) =>
                          updateSite({
                            ...selectedSite,
                            sites: selectedSite.sites.map((entry, i) =>
                              i === index ? (next ?? 0) : entry,
                            ),
                          })
                        }
                        announce={announce}
                      />
                      <p className="overflow-x-auto whitespace-nowrap text-right text-[10px] tabular-nums text-muted-foreground">
                        {money(selectedSummary?.years[index] || 0)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium">
                Build your first site configuration
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Create a site type, add its BOQ, then plan annual deployments.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-4"
                disabled={locked}
                onClick={addSite}
              >
                <Plus className="size-3.5" />
                Add Site Type
              </Button>
            </div>
          )}
        </section>
      )}
      {value.mode === 'site-types' && value.siteTypes.length > 1 && (
        <details className="overflow-hidden rounded-lg border bg-card">
          <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium hover:bg-muted/20">
            All site types · Annual breakdown{' '}
            <span className="ml-2 font-normal text-muted-foreground">
              {value.siteTypes.length} configurations
            </span>
          </summary>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site Type</TableHead>
                <TableHead className="text-right">Cost / Site</TableHead>
                {zeroYears().map((_, index) => (
                  <TableHead key={index} className="text-right">
                    {yearLabel(actualYears, index)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total · SGD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {value.siteTypes.map((site) => {
                const calculated = summary.siteTypes.find(
                  (entry) => entry.id === site.id,
                );
                return (
                  <TableRow key={site.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left text-xs font-medium text-[#245e65] underline-offset-2 hover:underline"
                        onClick={() => setSelectedSiteId(site.id)}
                      >
                        {site.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(calculated?.unitCost || 0)}
                    </TableCell>
                    {site.sites.map((count, index) => (
                      <TableCell key={index} className="text-right">
                        <span className="block text-xs tabular-nums">
                          {count} sites
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {money(calculated?.years[index] || 0)}
                        </span>
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">
                      {money(calculated?.total || 0)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </details>
      )}
      <section className="overflow-hidden rounded-lg border bg-card">
        {value.mode === 'site-types' ? (
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-muted/20"
            aria-expanded={sharedExpanded}
            aria-controls="subcontract-project-boq"
            onClick={() => setSharedExpanded(!sharedExpanded)}
          >
            <div>
              <h3 className="text-xs font-semibold">
                Shared / One-off Project Costs{' '}
                <span className="ml-1 font-normal text-muted-foreground">
                  {value.lines.length} items
                </span>
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Project quantities added once, alongside site costs.
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums">
              {money(projectTotal)}{' '}
              <span className="ml-2 text-muted-foreground">
                {sharedExpanded ? '−' : '+'}
              </span>
            </span>
          </button>
        ) : (
          <div className="px-3 pt-3">
            <h3 className="text-sm font-semibold">
              Project BOQ{' '}
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                {value.lines.length} items
              </span>
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add items, then enter quantities for each year.
            </p>
          </div>
        )}
        {showProjectLines && (
          <div id="subcontract-project-boq">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
              <label className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                Quantity year
                <select
                  aria-label="Project BOQ quantity year"
                  className={selectClass}
                  value={projectYear}
                  onChange={(event) =>
                    setProjectYear(
                      event.target.value === 'all'
                        ? 'all'
                        : Number(event.target.value),
                    )
                  }
                >
                  {zeroYears().map((_, index) => (
                    <option key={index} value={index}>
                      {yearLabel(actualYears, index)}
                    </option>
                  ))}
                  <option value="all">All years</option>
                </select>
              </label>
              <AddLineActions
                locked={locked}
                onCatalog={() => openCatalog({ kind: 'project' })}
                onManual={() => openManual({ kind: 'project' })}
              />
            </div>
            <SubcontractLinesTable
              lines={value.lines}
              actualYears={actualYears}
              locked={locked}
              project
              yearIndex={projectYear}
              onChange={(line) =>
                change({
                  ...value,
                  lines: value.lines.map((entry) =>
                    entry.id === line.id
                      ? (line as SubcontractCostLine)
                      : entry,
                  ),
                })
              }
              onDelete={(lineId) =>
                change({
                  ...value,
                  lines: value.lines.filter((line) => line.id !== lineId),
                })
              }
              announce={announce}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                {projectYear === 'all'
                  ? 'BOQ total'
                  : `${yearLabel(actualYears, projectYear)} subtotal · SGD ${money(roundMoney(summary.lines.reduce((sum, line) => sum + line.years[projectYear], 0)))}`}
              </span>
              <span className="font-medium tabular-nums">
                All years · SGD {money(projectTotal)}
              </span>
            </div>
          </div>
        )}
      </section>
      {catalogTarget && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCatalogTarget(null);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="max-h-[90vh] overflow-y-auto border-0 p-0 sm:max-w-2xl"
          >
            <DialogHeader className="sr-only">
              <DialogTitle>Select Subcontract Items</DialogTitle>
              <DialogDescription>
                Choose catalogue items to add to the selected BOQ.
              </DialogDescription>
            </DialogHeader>
            <SubcontractCatalogPicker
              catalog={
                refreshedCatalog?.source === catalog
                  ? refreshedCatalog.items
                  : catalog
              }
              query={query}
              onQueryChange={setQuery}
              disabled={locked}
              existingItemIds={targetLines.flatMap((line) =>
                line.catalogItemId ? [line.catalogItemId] : [],
              )}
              refreshing={refreshing}
              onRefresh={onRefreshCatalog ? refresh : undefined}
              onClose={() => setCatalogTarget(null)}
              onSelect={(items) => {
                if (locked) return;
                try {
                  if (
                    addLines(
                      items.map(copySubcontractCatalogLine),
                      catalogTarget,
                    )
                  ) {
                    setCatalogTarget(null);
                    announce(
                      'Selected catalogue items added. Enter their quantities in the BOQ.',
                    );
                  }
                } catch (error) {
                  announce(
                    error instanceof Error
                      ? error.message
                      : 'Unable to add these items.',
                  );
                }
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      {manualDraft && (
        <SubcontractItemDialog
          key={manualDraft.line.id}
          line={manualDraft.line}
          title="New Subcontract Item"
          locked={locked}
          announce={announce}
          onClose={() => setManualDraft(null)}
          onSave={(line) => {
            const added = addLines([line], manualDraft.target);
            if (added) setManualDraft(null);
            return added;
          }}
        />
      )}
      {renameDraft && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRenameDraft(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Rename Site Type</DialogTitle>
              <DialogDescription>
                Use a name that identifies this site configuration.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (locked) return;
                const name = renameDraft.name.trim();
                const site = value.siteTypes.find(
                  (entry) => entry.id === renameDraft.id,
                );
                if (!name || !site) return;
                updateSite({ ...site, name });
                setRenameDraft(null);
              }}
            >
              <Input
                aria-label="Site type name"
                value={renameDraft.name}
                disabled={locked}
                onChange={(event) =>
                  setRenameDraft({ ...renameDraft, name: event.target.value })
                }
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRenameDraft(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={locked || !renameDraft.name.trim()}
                >
                  Save
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {legacyRows.length > 0 && (
        <LegacySubcontractCosts
          rows={legacyRows}
          actualYears={actualYears}
          locked={locked}
          onRemove={onRemoveLegacyRow}
        />
      )}
    </section>
  );
}

function AddLineActions({
  locked,
  onCatalog,
  onManual,
}: {
  locked: boolean;
  onCatalog: () => void;
  onManual: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        disabled={locked}
        onClick={onCatalog}
        className="h-8 bg-[#2e6f77] px-2.5 text-xs text-white hover:bg-[#245e65]"
      >
        <Search className="size-3.5" />
        Add from Catalog
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 px-2.5 text-xs"
        disabled={locked}
        onClick={onManual}
      >
        <Plus className="size-3.5" />
        Manual Item
      </Button>
    </div>
  );
}

export function LegacySubcontractCosts({
  rows,
  actualYears,
  locked,
  onRemove,
}: {
  rows: CostInputRow[];
  actualYears: (number | null)[];
  locked: boolean;
  onRemove?: (id: string) => void;
}) {
  return (
    <section className="border bg-card">
      <div className="border-b p-3">
        <h3 className="text-sm font-semibold">Legacy Subcontract Costs</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          These saved amounts remain included in the totals. To replace a legacy
          row, enter its BOQ above, then explicitly remove the old row from this
          draft.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>BU</TableHead>
            {zeroYears().map((_, index) => (
              <TableHead key={index}>
                {yearLabel(actualYears, index)} · SGD
              </TableHead>
            ))}
            <TableHead>Total · SGD</TableHead>
            {onRemove && <TableHead>Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-96 whitespace-normal">
                {row.scope}
              </TableCell>
              <TableCell>{row.bu}</TableCell>
              {zeroYears().map((_, index) => (
                <TableCell key={index} className="tabular-nums">
                  {money(row.years[index]?.cost || 0)}
                </TableCell>
              ))}
              <TableCell className="font-semibold tabular-nums">
                {money(
                  roundMoney(
                    row.years.reduce((sum, year) => sum + year.cost, 0),
                  ),
                )}
              </TableCell>
              {onRemove && (
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={locked}
                    aria-label={`Remove legacy subcontract ${row.scope}`}
                    onClick={() => {
                      if (
                        !locked &&
                        window.confirm(
                          `Remove the saved legacy cost for ${row.scope} from this draft?`,
                        )
                      )
                        onRemove(row.id);
                    }}
                  >
                    Remove Legacy Row
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
