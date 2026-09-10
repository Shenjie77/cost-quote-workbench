/** Review a local table before appending a new manual personnel batch. */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BusinessUnitSelect } from '@/features/master-data/business-unit-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  YEAR_BUCKETS,
  getActualYears,
  totalRowCost,
  type CostInputRow,
  type RateSettings,
  type ResourceType,
} from '../domain';
import {
  PERSONNEL_BULK_LIMITS,
  isPersonnelBulkCostColumn,
  parsePersonnelBulkEntry,
  personnelBulkBasisFingerprint,
  type PersonnelBulkColumnTarget,
  type PersonnelBulkMode,
  type PersonnelBulkInputFormat,
  type PersonnelBulkOptions,
  type PersonnelBulkPreview,
} from '../personnel-bulk-entry';

type EntryOptions = Pick<
  PersonnelBulkOptions,
  | 'defaultMode'
  | 'inputFormat'
  | 'defaultYear'
  | 'defaultBU'
  | 'defaultRETypeId'
  | 'hasHeader'
  | 'fillDownScope'
  | 'fillDownGroup'
  | 'mapping'
  | 'reTypeOverrides'
>;
export type PersonnelBulkEntryDialogProps = {
  resources: ResourceType[];
  rates: RateSettings;
  defaultMode?: PersonnelBulkMode;
  defaultYear: number;
  locked?: boolean;
  onClose: () => void;
  onConfirm: (rows: CostInputRow[], basisFingerprint: string) => boolean;
  announce: (message: string) => void;
};
const money = (value: number) =>
  value.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const quantity = (value: number | null) =>
  value === null
    ? 'Invalid'
    : value.toLocaleString('en-SG', { maximumFractionDigits: 4 });
const selectClass =
  'h-8 w-full min-w-0 rounded-md border border-border bg-white px-2 text-xs disabled:opacity-50';
const mappingOptions: { value: PersonnelBulkColumnTarget; label: string }[] = [
  { value: 'unmapped', label: 'Choose field…' },
  { value: 'ignore', label: 'Ignore column' },
  { value: 'groupName', label: 'Group' },
  { value: 'scope', label: 'Scope' },
  { value: 'bu', label: 'BU' },
  { value: 'reType', label: 'RE Type' },
  { value: 'mode', label: 'Input mode' },
  { value: 'mdPerSite', label: 'MD / Site' },
  { value: 'sites', label: 'Sites · default year' },
  { value: 'mandays', label: 'MD · default year' },
  ...YEAR_BUCKETS.flatMap((year, index) => [
    { value: `quantity:${index}` as const, label: `${year} · row mode` },
    { value: `sites:${index}` as const, label: `${year} · Sites` },
    { value: `mandays:${index}` as const, label: `${year} · MD` },
  ]),
];

export function personnelBulkMDTemplate(
  format: PersonnelBulkInputFormat = 'auto',
) {
  if (format === 'scope-md') return 'Installation\t1\nTesting\t3';
  if (format === 'group-scope-md')
    return 'Site A\tInstallation\t1\nSite A\tTesting\t3';
  return 'Group\tScope\tMD\nSite A\tInstallation\t1\nSite A\tTesting\t3';
}

/** Text/options and current version basis must still match the explicitly generated preview. */
export function personnelBulkInputKey(
  text: string,
  options: EntryOptions,
  resources: ResourceType[],
  rates: RateSettings,
) {
  return JSON.stringify([
    text,
    options,
    personnelBulkBasisFingerprint(resources, rates),
  ]);
}

export function confirmPersonnelBulkPreview({
  preview,
  currentKey,
  previewKey,
  resources,
  rates,
  locked,
  onConfirm,
  announce,
}: {
  preview: PersonnelBulkPreview | null;
  currentKey: string;
  previewKey?: string;
  resources: ResourceType[];
  rates: RateSettings;
  locked?: boolean;
  onConfirm: PersonnelBulkEntryDialogProps['onConfirm'];
  announce: PersonnelBulkEntryDialogProps['announce'];
}) {
  if (locked) return false;
  if (
    !preview ||
    currentKey !== previewKey ||
    preview.basisFingerprint !== personnelBulkBasisFingerprint(resources, rates)
  ) {
    announce(
      'The input or version rates changed. Generate a new preview before confirming.',
    );
    return false;
  }
  if (!preview.canConfirm) {
    announce('Resolve all preview errors before confirming this batch.');
    return false;
  }
  const rows = preview.rows.map((row) => ({
    ...structuredClone(row),
    id: `CI-${crypto.randomUUID()}`,
  }));
  if (onConfirm(rows, preview.basisFingerprint) === false) {
    announce(
      'This version changed or became locked. Refresh the preview before confirming again.',
    );
    return false;
  }
  return true;
}

/** Stateless form also makes the Preview/Confirm boundary directly testable. */
export function PersonnelBulkEntryForm({
  text,
  options,
  resources,
  rates,
  preview,
  current,
  locked = false,
  page,
  onPage,
  onTextChange,
  onOptionsChange,
  onPreview,
  onConfirm,
  onClose,
  onCopyTemplate,
}: {
  text: string;
  options: EntryOptions;
  resources: ResourceType[];
  rates: RateSettings;
  preview: PersonnelBulkPreview | null;
  current: boolean;
  locked?: boolean;
  page: number;
  onPage: (page: number) => void;
  onTextChange: (text: string) => void;
  onOptionsChange: (options: EntryOptions) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onClose: () => void;
  onCopyTemplate?: (text: string) => void;
}) {
  const update = (change: Partial<EntryOptions>) => {
    if (!locked) onOptionsChange({ ...options, ...change });
  };
  const activeResources = resources.filter(
    (resource) => resource.active && resource.category === 'internal',
  );
  const actualYears = getActualYears(rates);
  const pageCount = Math.max(1, Math.ceil((preview?.entries.length || 0) / 50));
  const safePage = Math.min(page, pageCount - 1);
  const format = options.inputFormat || 'auto';
  const template = personnelBulkMDTemplate(format);
  return (
    <>
      <div className="space-y-3">
        <div className="grid gap-2 rounded-md border border-border bg-[#f5f7f5] p-3 sm:grid-cols-[220px_1fr]">
          <label className="grid content-start gap-1 text-[11px] font-medium">
            Input format
            <select
              aria-label="Bulk input format"
              className={selectClass}
              value={format}
              disabled={locked}
              onChange={(event) =>
                update({
                  inputFormat: event.target.value as PersonnelBulkInputFormat,
                  defaultMode: 'mandays',
                  hasHeader: event.target.value === 'auto',
                  mapping: {},
                  reTypeOverrides: {},
                })
              }
            >
              <option value="auto">Auto-detect headers</option>
              <option value="scope-md">Scope + MD · no header</option>
              <option value="group-scope-md">
                Group + Scope + MD · no header
              </option>
            </select>
            <span className="font-normal text-muted-foreground">
              MD means total man-days. Choose the default BU, RE Type and year
              below when missing from the table.
            </span>
          </label>
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
              <span>MD template · tab-separated</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 text-[11px]"
                disabled={locked}
                onClick={() => {
                  if (!locked) onCopyTemplate?.(template);
                }}
              >
                Copy template
              </Button>
            </div>
            <textarea
              aria-label="MD template"
              readOnly
              value={template}
              className="h-20 w-full resize-none rounded border border-border bg-white px-2 py-1 font-mono text-[11px]"
            />
          </div>
        </div>
        <label className="grid gap-1.5 text-xs font-medium">
          Paste or type a table
          <textarea
            aria-label="Bulk cost table"
            className="h-36 w-full resize-y rounded-md border border-border bg-white px-3 py-2 font-mono text-xs font-normal leading-5 outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
            value={text}
            disabled={locked}
            placeholder={template}
            onChange={(event) => {
              // Keep an over-limit sentinel so an oversized paste can never become a valid truncated batch.
              if (!locked)
                onTextChange(
                  event.target.value.slice(
                    0,
                    PERSONNEL_BULK_LIMITS.characters + 1,
                  ),
                );
            }}
          />
        </label>
        <p className="text-[11px] text-muted-foreground">
          Excel paste, quoted CSV and Markdown tables · up to 1,000 rows. Scope,
          Group, BU, RE Type and annual effort are recognized locally. Use MD,
          Y1 MD–Y5 MD or calendar-year MD headings. Values such as 1 MD, 3days
          and 3天 are accepted in MD columns. Costs are recalculated from this
          version&apos;s rates and allowance.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label
            htmlFor="bulk-cost-default-bu"
            className="grid gap-1 text-[11px] font-medium"
          >
            Default BU
            <BusinessUnitSelect
              id="bulk-cost-default-bu"
              aria-label="Bulk default BU"
              value={options.defaultBU || ''}
              disabled={locked}
              className="h-8 text-xs"
              placeholder="For blank BU cells"
              onChange={(event) => update({ defaultBU: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-[11px] font-medium">
            Default RE Type
            <select
              aria-label="Bulk default RE Type"
              className={selectClass}
              disabled={locked}
              value={options.defaultRETypeId || ''}
              onChange={(event) =>
                update({ defaultRETypeId: event.target.value })
              }
            >
              <option value="">Select if missing</option>
              {activeResources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.code} · {resource.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-medium">
            Default input mode
            <select
              aria-label="Bulk default input mode"
              className={selectClass}
              disabled={locked || format !== 'auto'}
              value={format === 'auto' ? options.defaultMode : 'mandays'}
              onChange={(event) =>
                format === 'auto' &&
                update({ defaultMode: event.target.value as PersonnelBulkMode })
              }
            >
              <option value="sites">Sites</option>
              <option value="mandays">Direct MD</option>
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-medium">
            Default year
            <select
              aria-label="Bulk default year"
              className={selectClass}
              disabled={locked}
              value={options.defaultYear}
              onChange={(event) =>
                update({ defaultYear: Number(event.target.value) })
              }
            >
              {YEAR_BUCKETS.map((year, index) => (
                <option key={year} value={index}>
                  {year}
                  {actualYears[index] ? ` · ${actualYears[index]}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              aria-label="Bulk first row contains headers"
              checked={format === 'auto' && options.hasHeader !== false}
              disabled={locked || format !== 'auto'}
              onChange={(event) => {
                if (format !== 'auto') return;
                update({
                  hasHeader: event.target.checked,
                  mapping: {},
                  reTypeOverrides: {},
                });
              }}
            />
            First row contains headers
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              aria-label="Bulk fill down Group"
              checked={options.fillDownGroup === true}
              disabled={locked}
              onChange={(event) =>
                update({ fillDownGroup: event.target.checked })
              }
            />
            Fill blank Group cells from the preceding group
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              aria-label="Bulk fill down Scope"
              checked={options.fillDownScope !== false}
              disabled={locked}
              onChange={(event) =>
                update({ fillDownScope: event.target.checked })
              }
            />
            Fill blank Scope cells from the preceding row
          </label>
        </div>
        {preview && (
          <div className="space-y-3 border-t border-border pt-3">
            {!current && (
              <p
                role="alert"
                className="rounded-md bg-amber-50 p-2 text-xs text-amber-900"
              >
                Input, mapping or version rates changed. Generate a new preview
                to review updated amounts.
              </p>
            )}
            {!!preview.columns.length && (
              <details
                className="rounded-md border border-border p-2"
                open={preview.columns.some(
                  (column) => column.target === 'unmapped',
                )}
              >
                <summary className="cursor-pointer text-xs font-medium">
                  Column mapping · review or correct detected fields
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {preview.columns.map((column) => (
                    <label
                      className="grid min-w-0 gap-1 text-[11px]"
                      key={column.index}
                    >
                      <span className="truncate" title={column.header}>
                        {column.index + 1}. {column.header}
                      </span>
                      <select
                        aria-label={`Map bulk column ${column.index + 1}`}
                        className={selectClass}
                        disabled={
                          locked ||
                          (options.hasHeader !== false &&
                            isPersonnelBulkCostColumn(column.header))
                        }
                        value={
                          options.hasHeader !== false &&
                          isPersonnelBulkCostColumn(column.header)
                            ? 'ignore'
                            : (options.mapping?.[column.index] ?? column.target)
                        }
                        onChange={(event) =>
                          update({
                            mapping: {
                              ...options.mapping,
                              [column.index]: event.target
                                .value as PersonnelBulkColumnTarget,
                            },
                          })
                        }
                      >
                        {mappingOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            )}
            {!!preview.issues.length && (
              <div
                role="alert"
                className="rounded-md bg-red-50 p-2 text-xs text-red-900"
              >
                <ul className="list-inside list-disc space-y-1">
                  {preview.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!preview.notices.length && (
              <details
                className="rounded-md bg-[#f7f5f0] p-2 text-[11px]"
                open={preview.notices.length <= 5}
              >
                <summary className="cursor-pointer font-medium">
                  Recognition notes · {preview.notices.length}
                </summary>
                <ul className="mt-1 max-h-36 list-inside list-disc space-y-1 overflow-y-auto">
                  {preview.notices.map((notice, index) => (
                    <li key={index}>{notice}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold">
                {preview.entries.length} rows ·{' '}
                {preview.entries.filter((entry) => entry.issues.length).length}{' '}
                to correct
              </span>
              <span>
                Batch cost: <strong>SGD {money(preview.totalCost)}</strong>
                {!preview.canConfirm && ' · valid rows only'}
              </span>
            </div>
            {!!preview.entries.length && (
              <div className="max-h-80 overflow-auto border border-border">
                <table className="w-full min-w-[840px] text-[11px]">
                  <thead className="sticky top-0 z-10 bg-[#e9e6de]">
                    <tr>
                      {[
                        'Row',
                        'Group',
                        'Scope / BU',
                        'RE Type',
                        'Mode / MD per Site',
                        ...YEAR_BUCKETS,
                        'Cost (SGD)',
                        'Check',
                      ].map((label) => (
                        <th
                          key={label}
                          className="border-r border-border px-2 py-2 text-left font-medium"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries
                      .slice(safePage * 50, (safePage + 1) * 50)
                      .map((entry) => (
                        <tr
                          key={entry.sourceRow}
                          className="border-t border-border"
                        >
                          <td className="px-2 py-2 tabular-nums">
                            {entry.sourceRow}
                          </td>
                          <td className="max-w-36 break-words px-2 py-2">
                            {entry.groupName || 'Unassigned Group'}
                          </td>
                          <td className="max-w-44 px-2 py-2">
                            <p className="break-words font-medium">
                              {entry.scope || 'Missing Scope'}
                            </p>
                            <p className="text-muted-foreground">
                              {entry.bu || 'Missing BU'}
                            </p>
                          </td>
                          <td className="min-w-36 max-w-52 px-2 py-2">
                            <select
                              aria-label={`Bulk row ${entry.sourceRow} RE Type`}
                              className={selectClass}
                              disabled={locked}
                              value={
                                options.reTypeOverrides?.[entry.sourceRow] ||
                                entry.reTypeId ||
                                ''
                              }
                              onChange={(event) =>
                                update({
                                  reTypeOverrides: {
                                    ...options.reTypeOverrides,
                                    [entry.sourceRow]: event.target.value,
                                  },
                                })
                              }
                            >
                              <option value="">Select RE Type</option>
                              {activeResources.map((resource) => (
                                <option key={resource.id} value={resource.id}>
                                  {resource.code} · {resource.name}
                                </option>
                              ))}
                            </select>
                            {entry.reTypeText && (
                              <p className="mt-1 break-words text-[10px] text-muted-foreground">
                                Pasted: {entry.reTypeText}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {entry.mode === 'sites'
                              ? `Sites · ${quantity(entry.mdPerSite)} MD/site`
                              : 'Direct MD'}
                          </td>
                          {entry.quantities.map((amount, index) => (
                            <td
                              key={YEAR_BUCKETS[index]}
                              className="px-2 py-2 text-right tabular-nums"
                            >
                              {quantity(amount)}
                              <span className="ml-1 text-[9px] text-muted-foreground">
                                {entry.mode === 'sites' ? 'sites' : 'MD'}
                              </span>
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right font-medium tabular-nums">
                            {entry.row ? money(totalRowCost(entry.row)) : '—'}
                          </td>
                          <td
                            className={`min-w-32 px-2 py-2 ${entry.issues.length ? 'text-red-800' : 'text-emerald-800'}`}
                          >
                            {entry.issues.length ? (
                              <ul className="space-y-1">
                                {entry.issues.map((issue, index) => (
                                  <li key={index}>{issue}</li>
                                ))}
                              </ul>
                            ) : (
                              'Ready'
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {pageCount > 1 && (
              <div className="flex items-center justify-end gap-2 text-[11px]">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={safePage === 0}
                  onClick={() => onPage(safePage - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {safePage + 1} / {pageCount}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={safePage === pageCount - 1}
                  onClick={() => onPage(safePage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <DialogFooter className="mt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={locked || !text.trim()}
          onClick={() => {
            if (!locked) onPreview();
          }}
        >
          Preview
        </Button>
        <Button
          type="button"
          disabled={locked || !current || !preview?.canConfirm}
          onClick={() => {
            if (!locked && current && preview?.canConfirm) onConfirm();
          }}
        >
          Confirm &amp; Add
          {preview?.canConfirm && current ? ` ${preview.rows.length} Rows` : ''}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PersonnelBulkEntryDialog(props: PersonnelBulkEntryDialogProps) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<EntryOptions>({
    defaultMode: props.defaultMode ?? 'mandays',
    inputFormat: 'auto',
    defaultYear: props.defaultYear,
    defaultBU: '',
    defaultRETypeId: '',
    hasHeader: true,
    fillDownScope: true,
    fillDownGroup: false,
    mapping: {},
    reTypeOverrides: {},
  });
  const [preview, setPreview] = useState<{
    key: string;
    data: PersonnelBulkPreview;
  } | null>(null);
  const [page, setPage] = useState(0);
  const confirmed = useRef(false);
  const currentKey = personnelBulkInputKey(
    text,
    options,
    props.resources,
    props.rates,
  );
  const generatePreview = () => {
    if (props.locked) return;
    const data = parsePersonnelBulkEntry(text, {
      ...options,
      resources: props.resources,
      rates: props.rates,
    });
    setPreview({ key: currentKey, data });
    setPage(0);
  };
  const confirm = () => {
    if (confirmed.current || props.locked) return;
    confirmed.current = true;
    try {
      const accepted = confirmPersonnelBulkPreview({
        preview: preview?.data || null,
        previewKey: preview?.key,
        currentKey,
        resources: props.resources,
        rates: props.rates,
        locked: props.locked,
        onConfirm: props.onConfirm,
        announce: props.announce,
      });
      if (accepted) props.onClose();
      else confirmed.current = false;
    } catch (error) {
      confirmed.current = false;
      props.announce(
        error instanceof Error
          ? error.message
          : 'The batch could not be added. Review the preview and try again.',
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[1040px]">
        <DialogHeader>
          <DialogTitle>Bulk Entry</DialogTitle>
          <DialogDescription>
            Paste a table, review the recognized rows, then confirm to append
            them to this cost version. Existing rows stay in place.
          </DialogDescription>
        </DialogHeader>
        <PersonnelBulkEntryForm
          text={text}
          options={options}
          resources={props.resources}
          rates={props.rates}
          preview={preview?.data || null}
          current={preview?.key === currentKey}
          locked={props.locked}
          page={page}
          onPage={setPage}
          onOptionsChange={setOptions}
          onTextChange={(value) => {
            setText(value);
            setOptions((current) => ({
              ...current,
              reTypeOverrides: {},
            }));
          }}
          onPreview={generatePreview}
          onConfirm={confirm}
          onClose={props.onClose}
          onCopyTemplate={async (template) => {
            if (props.locked) return;
            try {
              await navigator.clipboard.writeText(template);
              props.announce(
                'MD template copied. Fill in the table and paste it above.',
              );
            } catch {
              props.announce(
                'Select and copy the MD template text, then paste your completed table above.',
              );
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
