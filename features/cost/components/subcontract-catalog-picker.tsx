/** Bulk catalogue selection stages current references before copying them into a BOQ. */
import { useState } from 'react';
import { Check, PackageOpen, Plus, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { SubcontractItem } from '@/features/master-data/types';

export type SubcontractCatalogPickerProps = {
  catalog: SubcontractItem[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (items: SubcontractItem[]) => void;
  onClose: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  disabled?: boolean;
  existingItemIds?: string[];
};

const noExistingItems: string[] = [];
const uniqueCatalog = (catalog: SubcontractItem[]) => [
  ...new Map(catalog.map((item) => [item.id, item])).values(),
];

export function subcontractCatalogRestriction(
  item: SubcontractItem,
  existingItemIds: string[] = noExistingItems,
): string {
  if (existingItemIds.includes(item.id)) return 'Already added to this BOQ.';
  if (!item.active) return 'This catalogue item is inactive.';
  if (item.currency.trim().toUpperCase() !== 'SGD')
    return 'SGD price required. Currency conversion is not available.';
  if (!item.unit?.trim())
    return 'Unit required. Set the unit in Master Data before adding this item.';
  return '';
}

export function filterSubcontractCatalog(
  catalog: SubcontractItem[],
  query: string,
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return uniqueCatalog(catalog).filter((item) => {
    const text = `${item.code} ${item.item} ${item.bu}`.toLowerCase();
    return item.active && terms.every((term) => text.includes(term));
  });
}

/** Return each eligible ID once, using its current catalogue values, never a stale selection snapshot. */
export function resolveSelectedSubcontractItems(
  catalog: SubcontractItem[],
  selectedIds: string[],
  existingItemIds: string[] = noExistingItems,
) {
  const current = new Map(
    uniqueCatalog(catalog).map((item) => [item.id, item]),
  );
  return [...new Set(selectedIds)].flatMap((selectedId) => {
    const item = current.get(selectedId);
    return item && !subcontractCatalogRestriction(item, existingItemIds)
      ? [item]
      : [];
  });
}

export function SubcontractCatalogPicker(props: SubcontractCatalogPickerProps) {
  const {
    catalog,
    query,
    onSelect,
    refreshing = false,
    disabled = false,
    existingItemIds = noExistingItems,
  } = props;
  const [selection, setSelection] = useState<{
    catalog: SubcontractItem[];
    existingItemIds: string[];
    ids: string[];
  }>({ catalog, existingItemIds, ids: [] });
  // Prune removed or ineligible references when a refreshed catalogue arrives.
  // Keeping this state paired with its source also prevents a removed ID from
  // silently becoming selected again if a later refresh brings it back.
  if (
    selection.catalog !== catalog ||
    selection.existingItemIds !== existingItemIds
  ) {
    setSelection({
      catalog,
      existingItemIds,
      ids: resolveSelectedSubcontractItems(
        catalog,
        selection.ids,
        existingItemIds,
      ).map((item) => item.id),
    });
  }
  const selected = resolveSelectedSubcontractItems(
    catalog,
    selection.ids,
    existingItemIds,
  );
  const selectedIds = selected.map((item) => item.id);
  const matches = filterSubcontractCatalog(catalog, query);
  const updateIds = (ids: string[]) => {
    if (refreshing || disabled) return;
    setSelection({
      catalog,
      existingItemIds,
      ids: resolveSelectedSubcontractItems(catalog, ids, existingItemIds).map(
        (item) => item.id,
      ),
    });
  };
  return (
    <SubcontractCatalogSelection
      {...props}
      matches={matches}
      selectedIds={selectedIds}
      onSelectionChange={updateIds}
      onAdd={() => {
        if (refreshing || disabled) return;
        const items = resolveSelectedSubcontractItems(
          catalog,
          selection.ids,
          existingItemIds,
        );
        if (items.length) onSelect(items);
      }}
    />
  );
}

/** Stateless selection surface keeps checkbox actions and batch submission testable. */
export function SubcontractCatalogSelection({
  catalog,
  query,
  onQueryChange,
  onClose,
  onRefresh,
  refreshing = false,
  disabled = false,
  existingItemIds = noExistingItems,
  matches,
  selectedIds,
  onSelectionChange,
  onAdd,
}: SubcontractCatalogPickerProps & {
  matches: SubcontractItem[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onAdd: () => void;
}) {
  const selected = resolveSelectedSubcontractItems(
    catalog,
    selectedIds,
    existingItemIds,
  );
  const selectedSet = new Set(selected.map((item) => item.id));
  const visibleIds = matches
    .filter((item) => !subcontractCatalogRestriction(item, existingItemIds))
    .map((item) => item.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  const visibleSet = new Set(visibleIds);
  const outsideSearch = selected.filter(
    (item) => !visibleSet.has(item.id),
  ).length;
  const unpriced = selected.filter(
    (item) => item.unitPrice === null || item.unitPrice === undefined,
  ).length;
  const hasActiveItems = uniqueCatalog(catalog).some((item) => item.active);
  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-label="Subcontract catalogue selection"
      aria-busy={refreshing}
    >
      <header className="space-y-3 border-b border-slate-100 bg-gradient-to-br from-indigo-50/60 to-teal-50/60 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">
              Choose Catalog Items
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Select multiple items, then add them to your BOQ. Saved BOQ prices
              stay unchanged.
            </p>
          </div>
          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={onRefresh}
              className="shrink-0 bg-white"
              aria-label="Refresh subcontract catalogue"
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </span>
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-10 rounded-lg border-slate-200 bg-white pl-9 pr-9 text-sm"
            aria-label="Search subcontract catalogue"
            placeholder="Search item, code or BU"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500"
              aria-label="Clear catalogue search"
              onClick={() => onQueryChange('')}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </header>
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-slate-100 px-4 py-1.5 text-xs">
        <span className="text-slate-500">
          {matches.length} {matches.length === 1 ? 'item' : 'items'}
          {query.trim() ? ' found' : ' available'}
        </span>
        <div className="flex items-center gap-1">
          {selected.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={refreshing || disabled}
              onClick={() => {
                if (!refreshing && !disabled) onSelectionChange([]);
              }}
            >
              Clear Selection
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={refreshing || disabled || !visibleIds.length}
            onClick={() => {
              if (refreshing || disabled || !visibleIds.length) return;
              onSelectionChange(
                allVisibleSelected
                  ? selectedIds.filter((id) => !visibleSet.has(id))
                  : [...new Set([...selectedIds, ...visibleIds])],
              );
            }}
          >
            {allVisibleSelected ? 'Deselect Visible' : 'Select Visible'}
          </Button>
        </div>
      </div>
      <div className="max-h-[min(48vh,420px)] min-h-36 overflow-y-auto overscroll-contain p-2">
        {matches.length > 0 ? (
          <ul className="space-y-1.5">
            {matches.map((item) => (
              <li key={item.id}>
                <SubcontractCatalogOption
                  item={item}
                  selected={selectedSet.has(item.id)}
                  disabled={refreshing || disabled}
                  existingItemIds={existingItemIds}
                  onToggle={(checked) => {
                    if (
                      refreshing ||
                      disabled ||
                      subcontractCatalogRestriction(item, existingItemIds)
                    )
                      return;
                    onSelectionChange(
                      checked
                        ? [...new Set([...selectedIds, item.id])]
                        : selectedIds.filter((id) => id !== item.id),
                    );
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex min-h-44 flex-col items-center justify-center px-5 py-6 text-center">
            <PackageOpen className="mb-3 size-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">
              {hasActiveItems
                ? 'No matching items'
                : 'No active catalogue items'}
            </p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              {hasActiveItems
                ? 'Try a different item, code or BU. Your current selection is kept when you search.'
                : 'Refresh the catalogue, or add subcontract items in Master Data.'}
            </p>
            {query.trim() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => onQueryChange('')}
              >
                Clear Search
              </Button>
            )}
          </div>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3">
        <output className="min-w-0 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-slate-800">
            <Check className="size-3.5 text-teal-700" />
            {selected.length} selected
            {outsideSearch > 0 && (
              <span className="font-normal text-slate-500">
                · {outsideSearch} outside this search
              </span>
            )}
          </span>
          {unpriced > 0 && (
            <span className="mt-1 block text-[11px] text-amber-700">
              {unpriced} unpriced · Add as draft and set prices in the BOQ.
            </span>
          )}
        </output>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-[#2e6f77] text-white hover:bg-[#255c63]"
            disabled={refreshing || disabled || selected.length === 0}
            onClick={() => {
              if (!refreshing && !disabled && selected.length > 0) onAdd();
            }}
          >
            <Plus className="size-3.5" />
            Add {selected.length} {selected.length === 1 ? 'Item' : 'Items'}
          </Button>
        </div>
      </footer>
    </section>
  );
}

export function SubcontractCatalogOption({
  item,
  selected,
  disabled,
  existingItemIds = noExistingItems,
  onToggle,
}: {
  item: SubcontractItem;
  selected: boolean;
  disabled?: boolean;
  existingItemIds?: string[];
  onToggle: (selected: boolean) => void;
}) {
  const restriction = subcontractCatalogRestriction(item, existingItemIds);
  const alreadyAdded = existingItemIds.includes(item.id);
  const unavailable = !!restriction || !!disabled;
  const unpriced = item.unitPrice === null || item.unitPrice === undefined;
  return (
    <label
      className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg border px-3 py-3 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto] ${restriction ? 'cursor-not-allowed border-slate-100 bg-slate-50/70' : selected ? 'border-teal-600/40 bg-teal-50/70 ring-1 ring-teal-600/10' : 'border-slate-200 bg-white hover:border-teal-400/70 hover:bg-teal-50/30'}`}
    >
      <Checkbox
        aria-label={`Select ${item.code} from catalogue`}
        className="mt-0.5 border-slate-300 data-checked:border-teal-700 data-checked:bg-teal-700"
        checked={selected}
        disabled={unavailable}
        onCheckedChange={(checked) => {
          if (!unavailable) onToggle(checked);
        }}
      />
      <span className="min-w-0">
        <span
          className={`block break-words text-[13px] font-medium leading-5 ${restriction ? 'text-slate-500' : 'text-slate-900'}`}
        >
          {item.item}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
            {item.code}
          </span>
          {alreadyAdded && (
            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              Added
            </span>
          )}
          <span>{item.bu}</span>
        </span>
        {restriction && (
          <span className="mt-1.5 block text-[11px] leading-4 text-amber-700">
            {restriction}
          </span>
        )}
      </span>
      <span className="col-start-2 mt-1 flex flex-wrap items-baseline gap-1 text-left sm:col-start-auto sm:mt-0 sm:block sm:min-w-28 sm:text-right">
        <span
          className={`block whitespace-nowrap text-sm font-semibold tabular-nums ${unpriced ? 'text-amber-700' : 'text-slate-800'}`}
        >
          {unpriced
            ? 'Not priced'
            : item.unitPrice!.toLocaleString('en-SG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
        </span>
        <span className="block text-[10px] text-slate-500">
          {item.currency} / {item.unit || 'unit not set'}
        </span>
      </span>
    </label>
  );
}
