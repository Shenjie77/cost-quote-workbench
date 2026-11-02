import { Badge } from '@/components/ui/badge';
import { Surface, Text } from '@/components/ui/presentation';
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
    <Surface
      as="section"
      variant="panel"
      className="flex min-h-0 flex-col overflow-hidden"
      aria-label="Subcontract catalogue selection"
      aria-busy={refreshing}
    >
      <Surface as="header" variant="header">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Text as="h3" tone="default">
              Choose Catalog Items
            </Text>
            <Text as="p" tone="muted" textRole="body-small" className="mt-1">
              Select multiple items, then add them to your BOQ. Saved BOQ prices
              stay unchanged.
            </Text>
          </div>
          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={onRefresh}
              className="shrink-0"
              aria-label="Refresh subcontract catalogue"
            >
              <RefreshCw
                className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </span>
            </Button>
          )}
        </div>
        <div className="relative">
          <Text
            as={Search}
            tone="muted"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
          />
          <Input
            variant="search"

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
              className="absolute right-2 top-1/2 -translate-y-1/2"
              aria-label="Clear catalogue search"
              onClick={() => onQueryChange('')}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </Surface>
      <Surface
        as="div"
        variant="item"
        textRole="body-small"
        className="flex min-h-10 items-center justify-between gap-2"
      >
        <Text as="span" tone="muted">
          {matches.length} {matches.length === 1 ? 'item' : 'items'}
          {query.trim() ? ' found' : ' available'}
        </Text>
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
      </Surface>
      <Surface
        as="div"
        variant="body"
        className="max-h-[min(48vh,420px)] min-h-36 overflow-y-auto overscroll-contain"
      >
        {matches.length > 0 ? (
          <ul className="space-y-2">
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
          <Surface
            as="div"
            variant="body"
            className="flex min-h-44 flex-col items-center justify-center text-center"
          >
            <Text as={PackageOpen} tone="muted" className="mb-3 size-8" />
            <Text as="p" tone="default" textRole="body-main">
              {hasActiveItems
                ? 'No matching items'
                : 'No active catalogue items'}
            </Text>
            <Text
              as="p"
              tone="muted"
              textRole="body-small"
              className="mt-1 max-w-sm"
            >
              {hasActiveItems
                ? 'Try a different item, code or BU. Your current selection is kept when you search.'
                : 'Refresh the catalogue, or add subcontract items in Master Data.'}
            </Text>
            {query.trim() && (
              <Button
                type="button"
                variant="outline"
                size="sm"

                onClick={() => onQueryChange('')}
              >
                Clear Search
              </Button>
            )}
          </Surface>
        )}
      </Surface>
      <Surface
        as="footer"
        variant="footer"
        className="flex flex-wrap items-center justify-between"
      >
        <Text as="output" textRole="body-small" className="min-w-0">
          <Text as="span" tone="default" className="flex items-center gap-2">
            <Text as={Check} className="size-4" />
            {selected.length} selected
            {outsideSearch > 0 && (
              <Text as="span" tone="muted">
                · {outsideSearch} outside this search
              </Text>
            )}
          </Text>
          {unpriced > 0 && (
            <Text
              as="span"
              tone="warning"
              textRole="body-small"
              className="mt-1 block"
            >
              {unpriced} unpriced · Add as draft and set prices in the BOQ.
            </Text>
          )}
        </Text>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"

            disabled={refreshing || disabled || selected.length === 0}
            onClick={() => {
              if (!refreshing && !disabled && selected.length > 0) onAdd();
            }}
          >
            <Plus className="size-4" />
            Add {selected.length} {selected.length === 1 ? 'Item' : 'Items'}
          </Button>
        </div>
      </Surface>
    </Surface>
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
    <Surface
      selected={selected}
      aria-disabled={Boolean(restriction)}
      as="label"
      variant={'field'}
      tone={'inherit'}
      className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_auto]  ${restriction ? 'cursor-not-allowed' : selected ? '' : ''}`}
    >
      <Checkbox
        aria-label={`Select ${item.code} from catalogue`}
        className="mt-1"
        checked={selected}
        disabled={unavailable}
        onCheckedChange={(checked) => {
          if (!unavailable) onToggle(checked);
        }}
      />
      <span className="min-w-0">
        <Text
          as="span"
          tone={restriction ? 'muted' : 'default'}
          textRole="body-small"
          className="block break-words"
        >
          {item.item}
        </Text>
        <Text
          as="span"
          tone="muted"
          textRole="body-small"
          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          <Surface
            as="strong"
            variant="inset"
            tone="default"
            textRole="body-small"
            className="break-all"
          >
            {item.code}
          </Surface>
          {alreadyAdded && <Badge tone="neutral">Added</Badge>}
          <span>{item.bu}</span>
        </Text>
        {restriction && (
          <Text
            as="span"
            tone="warning"
            textRole="body-small"
            className="mt-2 block"
          >
            {restriction}
          </Text>
        )}
      </span>
      <span className="col-start-2 mt-1 flex flex-wrap items-baseline gap-1 text-left sm:col-start-auto sm:mt-0 sm:block sm:min-w-28 sm:text-right">
        <Text
          as="span"
          tone={unpriced ? 'warning' : 'default'}
          textRole="body-main"
          className="block whitespace-nowrap tabular-nums"
        >
          {unpriced
            ? 'Not priced'
            : item.unitPrice!.toLocaleString('en-SG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
        </Text>
        <Text as="span" tone="muted" textRole="body-small" className="block">
          {item.currency} / {item.unit || 'unit not set'}
        </Text>
      </span>
    </Surface>
  );
}
