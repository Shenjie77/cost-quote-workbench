import { Surface, Text } from '@/components/ui/presentation';
import { SubcontractSpreadsheetEntry } from './subcontract-spreadsheet-entry';
import { formatMoney } from '@/lib/money';
/** Version-owned subcontract BOQs with focused quantity entry and staged catalogue selection. */
import { useEffect, useRef, useState } from 'react';
import { Copy, ClipboardPaste, Plus, Search, Trash2 } from 'lucide-react';
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
  copySubcontractCatalogLine,
  getSubcontractRateFactors,
  type SubcontractCost,
  type SubcontractLineBase,
  type SubcontractCostLine,
  type SubcontractSiteLine,
  type SubcontractSiteType,
} from '../subcontract-domain';
import { SubcontractRateAssumptions } from './subcontract-rate-assumptions';
import {
  SubcontractBulkEntryPage,
  subcontractEntryContext,
} from '@/features/bulk-entry/subcontract-entry';
import { updateSubcontractBulkLines } from '../subcontract-bulk-entry';
import { SubcontractCatalogPicker } from './subcontract-catalog-picker';
import { SubcontractNumberInput } from './subcontract-lines-table';
export { SubcontractCatalogPicker } from './subcontract-catalog-picker';
export {
  SubcontractLinesTable,
  SubcontractNumberInput,
} from './subcontract-lines-table';

const zeroYears = () => [0, 0, 0, 0, 0];
const id = () => globalThis.crypto.randomUUID();
const money = formatMoney;
const yearLabel = (years: (number | null)[], index: number) =>
  `${YEAR_BUCKETS[index]}${years[index] ? ` · ${years[index]}` : ''}`;

export { copySubcontractCatalogLine } from '../subcontract-domain';
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

export function SubcontractCostSheet({
  workspaceKey,
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
  workspaceKey?: string;
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
  const [page, setPage] = useState<'overview' | 'site' | 'shared'>(() =>
    value.mode === 'project' ? 'shared' : 'overview',
  );
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [catalogTarget, setCatalogTarget] = useState<SubcontractTarget | null>(
    null,
  );
  const [bulkRequest, setBulkRequest] = useState<{
    target: SubcontractTarget;
    catalog: SubcontractItem[] | null;
    error: string | null;
  } | null>(null);
  const bulkRequestId = useRef(0);
  const latestBulkContext = useRef({ locked, catalog });
  useEffect(() => {
    latestBulkContext.current = { locked, catalog };
  }, [locked, catalog]);
  useEffect(
    () => () => {
      bulkRequestId.current++;
    },
    [],
  );
  const [projectYear, setProjectYear] = useState<number | 'all'>(0);
  const [query, setQuery] = useState('');
  const [refreshedCatalog, setRefreshedCatalog] = useState<{
    source: SubcontractItem[];
    items: SubcontractItem[];
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const selectedSite =
    value.siteTypes.find((site) => site.id === selectedSiteId) ||
    value.siteTypes[0];
  const summary = calculateSubcontractCost(value, actualYears[0]);
  const rateFactors = getSubcontractRateFactors(
    value.rateSettings,
    actualYears[0],
  );
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
  /** Every entry session uses fresh Master Data; canceled or superseded fetches cannot reopen it. */
  const openBulk = async (target: SubcontractTarget) => {
    if (locked) return;
    const requestId = ++bulkRequestId.current;
    setBulkRequest({ target, catalog: null, error: null });
    try {
      if (!onRefreshCatalog)
        throw new Error(
          'Master Data refresh is unavailable. Reload the page and try again.',
        );
      const items = await onRefreshCatalog();
      if (requestId !== bulkRequestId.current) return;
      if (latestBulkContext.current.locked) {
        setBulkRequest(null);
        return;
      }
      setRefreshedCatalog({ source: latestBulkContext.current.catalog, items });
      setBulkRequest({ target, catalog: items, error: null });
    } catch (error) {
      if (requestId !== bulkRequestId.current) return;
      setBulkRequest({
        target,
        catalog: null,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load the latest Master Data.',
      });
    }
  };
  /** Invalidate pending refreshes when the user closes the entry flow. */
  const closeBulk = () => {
    bulkRequestId.current++;
    setBulkRequest(null);
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
    setPage('site');
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
    <Surface
      as="section"
      variant="page"
      className="min-w-0"
      aria-label="Subcontract cost"
    >
      <Surface as="div" variant="panel" className="min-w-0 overflow-hidden">
        <Surface as="header" variant="header" className="justify-between">
          <div>
            <h2>
              Subcontract Cost{' '}
              <Text
                as="span"
                tone="muted"
                textRole="body-small"
                className="ml-2"
              >
                2.3.2
              </Text>
            </h2>
            <Text as="p" tone="muted" textRole="body-small" className="mt-1">
              Unit prices saved with this cost version.
            </Text>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <Surface as="div" variant="body" className="text-right">
              <Text as="p" tone="muted" textRole="body-small">
                {unpriced ? 'Priced Subtotal' : 'Total'} · SGD
              </Text>
              <Text
                as="p"
                tone="primary"
                textRole="h2"
                className="mt-1 tabular-nums"
              >
                {money(total)}
              </Text>
            </Surface>
          </div>
        </Surface>
        <Surface
          as="div"
          variant="footer"
          className="grid grid-cols-2 sm:grid-cols-5"
        >
          {years.map((amount, index) => (
            <Surface key={index} as="div" variant="plain" className="min-w-0">
              <Text
                as="p"
                tone="muted"
                textRole="body-small"
                className="whitespace-nowrap"
              >
                {yearLabel(actualYears, index)}
              </Text>
              <Text
                as="p"
                textRole="body-small"
                className="mt-1 overflow-x-auto whitespace-nowrap tabular-nums"
              >
                {money(amount)}
              </Text>
            </Surface>
          ))}
        </Surface>
      </Surface>
      {
        <Surface
          variant="item"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          <Surface
            aria-label="Subcontract worksheets"
            as="nav"
            variant="control-group"
          >
            <Button
              size="sm"
              variant={page === 'overview' ? 'default' : 'ghost'}
              aria-current={page === 'overview' ? 'page' : undefined}
              onClick={() => setPage('overview')}
            >
              Overview
            </Button>
            {(value.mode === 'site-types' ? value.siteTypes : []).map(
              (site) => (
                <Button
                  key={site.id}
                  size="sm"
                  title={site.name}
                  className="max-w-60 overflow-hidden"
                  variant={
                    page === 'site' && selectedSite?.id === site.id
                      ? 'default'
                      : 'ghost'
                  }
                  aria-current={
                    page === 'site' && selectedSite?.id === site.id
                      ? 'page'
                      : undefined
                  }
                  onClick={() => {
                    setSelectedSiteId(site.id);
                    setPage('site');
                  }}
                >
                  <Text as="span" className="truncate">
                    {site.name}
                    {site.lines.some((line) => line.unitPrice === null)
                      ? ' · Unpriced'
                      : ''}
                  </Text>
                </Button>
              ),
            )}
            <Button
              size="sm"
              variant={page === 'shared' ? 'default' : 'ghost'}
              aria-current={page === 'shared' ? 'page' : undefined}
              onClick={() => setPage('shared')}
            >
              Shared / One-off Project Costs
            </Button>
          </Surface>
          <Button
            size="sm"
            variant="outline"
            disabled={locked}
            onClick={addSite}
          >
            <Plus className="size-4" />
            New site type
          </Button>
        </Surface>
      }
      {page === 'overview' && (
        <SubcontractRateAssumptions
          settings={value.rateSettings}
          actualYears={actualYears}
          locked={locked}
          onChange={(rateSettings) => change({ ...value, rateSettings })}
        />
      )}
      {locked && (
        <Surface
          as="output"
          variant="panel"
          padded
          textRole="body-small"
          className="block"
        >
          Read only · {lockedReason}
        </Surface>
      )}
      {unpriced > 0 && (
        <Surface
          as="output"
          variant="notice"
          tone="warning"
          textRole="body-small"
          className="block"
        >
          {unpriced} item(s) not priced · Subtotal excludes unpriced items. Set
          a price before confirming or exporting; 0 means a confirmed zero-cost
          item.
        </Surface>
      )}
      {value.mode === 'site-types' && page === 'site' && (
        <Surface
          as="section"
          variant="panel"
          className="min-w-0 overflow-hidden"
          aria-label="Site configuration"
        >
          {selectedSite ? (
            <>
              <SubcontractSpreadsheetEntry
                key={`${workspaceKey}:site:${selectedSite.id}`}
                draftId={`${workspaceKey}:site:${selectedSite.id}`}
                name={selectedSite.name}
                actualYears={actualYears}
                titleEditor={
                  <Input
                    variant="grid"
                    aria-label="Site type name"
                    value={selectedSite.name}
                    disabled={locked}
                    onChange={(event) => {
                      if (!locked)
                        updateSite({
                          ...selectedSite,
                          name: event.target.value,
                        });
                    }}
                  />
                }
                onDelete={(lineId) =>
                  updateSite(removeSubcontractSiteLine(selectedSite, lineId))
                }
                deleteConfirmation={(line) =>
                  selectedSite.lines.length === 1 &&
                  selectedSite.sites.some((count) => count > 0)
                    ? `Remove ${line.description || line.code} and clear all annual deployments for ${selectedSite.name}? This is its last BOQ item.`
                    : `Remove ${line.description || line.code} from ${selectedSite.name}?`
                }

                titleActions={
                  <>
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
                        setPage('site');
                        announce(
                          'Site configuration copied. Enter annual site counts for the new site type.',
                        );
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={locked}

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
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                }
                itemActions={
                  <AddLineActions
                    locked={locked}
                    onCatalog={() =>
                      openCatalog({ kind: 'site', id: selectedSite.id })
                    }
                    onBulk={() => {
                      void openBulk({ kind: 'site', id: selectedSite.id });
                    }}
                  />
                }
                lines={selectedSite.lines}
                factors={rateFactors}
                locked={locked}
                announce={announce}
                onReplace={(lines) =>
                  updateSite({
                    ...selectedSite,
                    lines: lines as SubcontractSiteLine[],
                  })
                }
              />

              <Surface
                as="div"
                variant="footer"
                textRole="body-small"
                className="flex flex-wrap items-center justify-between"
              >
                <Text as="span" tone="muted">
                  Cost per Site
                  {selectedSite.lines.some((line) => line.unitPrice === null)
                    ? ' · Provisional'
                    : ''}
                </Text>
                <strong className="tabular-nums">
                  SGD {money(selectedSummary?.unitCost || 0)}
                </strong>
              </Surface>
              <Surface as="div" variant="footer">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3>Annual Site Deployments</h3>
                  <Text as="span" tone="muted" textRole="body-small">
                    {selectedSite.sites.reduce((sum, count) => sum + count, 0)}{' '}
                    sites · SGD {money(selectedSummary?.total || 0)}
                  </Text>
                </div>
                {!selectedSite.lines.length && (
                  <Text as="p" tone="muted" textRole="body-small">
                    Add BOQ items first, then enter the number of sites for each
                    year.
                  </Text>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {selectedSite.sites.map((count, index) => (
                    <div key={index} className="min-w-0 space-y-2">
                      <Text
                        as="p"
                        tone="muted"
                        textRole="body-small"
                        className="whitespace-nowrap"
                      >
                        {yearLabel(actualYears, index)}
                      </Text>
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
                      <Text
                        as="p"
                        tone="muted"
                        textRole="body-small"
                        className="overflow-x-auto whitespace-nowrap text-right tabular-nums"
                      >
                        {money(selectedSummary?.years[index] || 0)}
                      </Text>
                    </div>
                  ))}
                </div>
              </Surface>
            </>
          ) : (
            <Surface as="div" variant="empty">
              <Text as="p" textRole="body-main">
                Build your first site configuration
              </Text>
              <Text as="p" tone="muted" textRole="body-small" className="mt-2">
                Create a site type, add its BOQ, then plan annual deployments.
              </Text>
              <Button
                type="button"
                size="sm"

                disabled={locked}
                onClick={addSite}
              >
                <Plus className="size-4" />
                Add Site Type
              </Button>
            </Surface>
          )}
        </Surface>
      )}
      {page === 'overview' && (
        <Surface
          as="section"
          variant="panel"
          className="min-w-0 overflow-hidden"
        >
          <Surface as="h3" variant="header">
            All site types · Annual breakdown{' '}
            <Text as="span" tone="muted" className="ml-2">
              {value.siteTypes.length} configurations
            </Text>
          </Surface>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site Type</TableHead>
                <TableHead variant="numeric" className="text-right">
                  Cost / Site
                </TableHead>
                {zeroYears().map((_, index) => (
                  <TableHead
                    variant="numeric"
                    key={index}
                    className="text-right"
                  >
                    {yearLabel(actualYears, index)}
                  </TableHead>
                ))}
                <TableHead variant="numeric" className="text-right">
                  Total · SGD
                </TableHead>
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
                      <Button
                        variant="ghost"
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => {
                          setSelectedSiteId(site.id);
                          setPage('site');
                        }}
                      >
                        {site.name}
                      </Button>
                    </TableCell>
                    <TableCell
                      variant="numeric"
                      className="text-right tabular-nums"
                    >
                      {money(calculated?.unitCost || 0)}
                    </TableCell>
                    {site.sites.map((count, index) => (
                      <TableCell
                        variant="numeric"
                        key={index}
                        className="text-right"
                      >
                        <Text
                          as="span"
                          textRole="body-small"
                          className="block tabular-nums"
                        >
                          {count} sites
                        </Text>
                        <Text
                          as="span"
                          tone="muted"
                          textRole="body-small"
                          className="tabular-nums"
                        >
                          {money(calculated?.years[index] || 0)}
                        </Text>
                      </TableCell>
                    ))}
                    <TableCell
                      variant="numeric"
                      className="text-right tabular-nums"
                    >
                      {money(calculated?.total || 0)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell>
                  <Button
                    variant="ghost"
                    className="hover:underline"
                    onClick={() => setPage('shared')}
                  >
                    Shared project costs
                  </Button>
                </TableCell>
                <TableCell>—</TableCell>
                {years.map((_, i) => (
                  <TableCell
                    variant="numeric"
                    key={i}
                    className="text-right tabular-nums"
                  >
                    {money(
                      summary.lines.reduce(
                        (sum, line) => sum + line.years[i],
                        0,
                      ),
                    )}
                  </TableCell>
                ))}
                <TableCell
                  variant="numeric"
                  className="text-right tabular-nums"
                >
                  {money(projectTotal)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Total (including legacy costs)</TableCell>
                <TableCell>—</TableCell>
                {years.map((amount, i) => (
                  <TableCell
                    variant="numeric"
                    key={i}
                    className="text-right tabular-nums"
                  >
                    {money(amount)}
                  </TableCell>
                ))}
                <TableCell
                  variant="numeric"
                  className="text-right tabular-nums"
                >
                  {money(total)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Surface>
      )}
      {page === 'shared' && (
        <Surface
          as="section"
          variant="panel"
          className="min-w-0 overflow-hidden"
        >
          <SubcontractSpreadsheetEntry
            draftId={`${workspaceKey}:project`}
            name="Shared / One-off Project Costs"
            actualYears={actualYears}
            yearIndex={projectYear}
            onYearChange={setProjectYear}
            itemActions={
              <AddLineActions
                locked={locked}
                onCatalog={() => openCatalog({ kind: 'project' })}
                onBulk={() => {
                  void openBulk({ kind: 'project' });
                }}
              />
            }
            lines={value.lines}
            project
            factors={rateFactors}
            locked={locked}
            announce={announce}
            onReplace={(lines) =>
              change({ ...value, lines: lines as SubcontractCostLine[] })
            }
          />

          <Surface
            as="div"
            variant="footer"
            textRole="body-small"
            className="flex flex-wrap items-center justify-between"
          >
            <Text as="span" tone="muted">
              {projectYear === 'all'
                ? 'BOQ total'
                : `${yearLabel(actualYears, projectYear)} subtotal · SGD ${money(roundMoney(summary.lines.reduce((sum, line) => sum + line.years[projectYear], 0)))}`}
            </Text>
            <span className="tabular-nums">
              All years · SGD {money(projectTotal)}
            </span>
          </Surface>
        </Surface>
      )}
      {catalogTarget && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCatalogTarget(null);
          }}
        >
          <DialogContent
            size="md"
            showCloseButton={false}
            className="overflow-y-auto"
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
      {bulkRequest &&
        (bulkRequest.catalog ? (
          <SubcontractBulkEntryPage
            workspaceKey={workspaceKey ?? 'subcontract'}
            value={value}
            target={bulkRequest.target}
            catalog={bulkRequest.catalog}
            actualYears={actualYears}
            locked={locked}
            onClose={closeBulk}
            onConfirm={(batch, fingerprint) => {
              if (
                locked ||
                fingerprint !==
                  subcontractEntryContext(
                    value,
                    bulkRequest.catalog!,
                    actualYears,
                  )
              )
                return false;
              let next = value;
              for (const entry of batch)
                next = updateSubcontractBulkLines(
                  next,
                  entry.lines,
                  entry.target,
                );
              change(next);
              announce(
                `${batch.reduce((sum, b) => sum + b.lines.length, 0)} subcontract items saved.`,
              );
              return true;
            }}
          />
        ) : (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) closeBulk();
            }}
          >
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Subcontract Bulk Entry</DialogTitle>
                <DialogDescription>
                  Loading current items and prices from Master Data.
                </DialogDescription>
              </DialogHeader>
              {bulkRequest.error ? (
                <Text role="alert" as="p" tone="danger" textRole="body-main">
                  {bulkRequest.error}
                </Text>
              ) : (
                <Text
                  as="output"
                  tone="muted"
                  textRole="body-main"
                  className="block"
                >
                  Loading Master Data…
                </Text>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeBulk}>
                  Cancel
                </Button>
                {bulkRequest.error && (
                  <Button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      void openBulk(bulkRequest.target);
                    }}
                  >
                    Retry
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>
        ))}
      {legacyRows.length > 0 && (
        <LegacySubcontractCosts
          rows={legacyRows}
          actualYears={actualYears}
          locked={locked}
          onRemove={onRemoveLegacyRow}
        />
      )}
    </Surface>
  );
}

function AddLineActions({
  locked,
  onCatalog,
  onBulk,
}: {
  locked: boolean;
  onCatalog: () => void;
  onBulk: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={locked} onClick={onCatalog}>
        <Search className="size-4" />
        Add from Catalog
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"

        disabled={locked}
        onClick={onBulk}
      >
        <ClipboardPaste className="size-4" />
        Bulk Entry
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
    <Surface as="section" variant="panel" className="min-w-0 overflow-hidden">
      <Surface as="div" variant="item">
        <h3>Legacy Subcontract Costs</h3>
        <Text as="p" tone="muted" textRole="body-small" className="mt-1">
          These saved amounts remain included in the totals. To replace a legacy
          row, enter its BOQ above, then explicitly remove the old row from this
          draft.
        </Text>
      </Surface>
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
              <TableCell variant="label" className="max-w-96 whitespace-normal">
                {row.scope}
              </TableCell>
              <TableCell>{row.bu}</TableCell>
              {zeroYears().map((_, index) => (
                <TableCell key={index} className="tabular-nums">
                  {money(row.years[index]?.cost || 0)}
                </TableCell>
              ))}
              <TableCell className="tabular-nums">
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
    </Surface>
  );
}
