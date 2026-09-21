/** Review pasted subcontract BOQs locally before appending to the selected project or site. */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { YEAR_BUCKETS } from '../domain';
import {
  SUBCONTRACT_BULK_LIMITS,
  confirmSubcontractBulkPreview,
  parseSubcontractBulkEntry,
  subcontractBulkInputKey,
  subcontractBulkTemplate,
  type SubcontractBulkBasis,
  type SubcontractBulkColumn,
  type SubcontractBulkLine,
  type SubcontractBulkOptions,
  type SubcontractBulkPreview,
} from '../subcontract-bulk-entry';

type Props = SubcontractBulkBasis & {
  defaultYear: number;
  locked?: boolean;
  onClose: () => void;
  onConfirm: (lines: SubcontractBulkLine[], fingerprint: string) => boolean;
  announce: (message: string) => void;
};
const selectClass =
  'h-8 min-w-0 w-full rounded-md border border-border bg-white px-2 text-xs disabled:opacity-50';
const money = (value: number) =>
  value.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const mappingLabels: [SubcontractBulkColumn, string][] = [
  ['unmapped', 'Choose field…'],
  ['ignore', 'Ignore column'],
  ['code', 'Code'],
  ['description', 'Description'],
  ['item', 'Code or description'],
  ['quantity', 'Quantity · selected year / site'],
  ['quantityPerSite', 'Qty / Site'],
  ...YEAR_BUCKETS.map((year, index): [SubcontractBulkColumn, string] => [
    `quantity:${index}`,
    `${year} quantity`,
  ]),
];

/** Stateless form makes all edits, preview and confirm boundaries directly testable. */
export function SubcontractBulkEntryForm({
  text,
  options,
  basis,
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
  options: SubcontractBulkOptions;
  basis: SubcontractBulkBasis;
  preview: SubcontractBulkPreview | null;
  current: boolean;
  locked?: boolean;
  page: number;
  onPage: (page: number) => void;
  onTextChange: (text: string) => void;
  onOptionsChange: (options: SubcontractBulkOptions) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onClose: () => void;
  onCopyTemplate: (template: string) => void;
}) {
  const site = basis.target.kind === 'site';
  const template = subcontractBulkTemplate(basis.target);
  const descriptionTemplate = subcontractBulkTemplate(
    basis.target,
    false,
    'description',
  );
  const pageCount = Math.max(1, Math.ceil((preview?.entries.length || 0) / 50));
  const safePage = Math.min(page, pageCount - 1);
  const update = (change: Partial<SubcontractBulkOptions>) => {
    if (!locked) onOptionsChange({ ...options, ...change });
  };
  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {!site && (
            <label className="grid gap-1 text-[11px] font-medium">
              Quantity year
              <select
                aria-label="Subcontract bulk quantity year"
                className={selectClass}
                value={options.defaultYear}
                disabled={locked}
                onChange={(event) =>
                  update({ defaultYear: Number(event.target.value) })
                }
              >
                {YEAR_BUCKETS.map((year, index) => (
                  <option key={year} value={index}>
                    {year}
                    {basis.actualYears[index]
                      ? ` · ${basis.actualYears[index]}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => {
              if (!locked) onCopyTemplate(template);
            }}
          >
            Copy template
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked}
            onClick={() => {
              if (!locked) onCopyTemplate(descriptionTemplate);
            }}
          >
            Copy description template
          </Button>
        </div>
        <details className="rounded-md border border-border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            Template &amp; accepted columns
          </summary>
          <textarea
            className="mt-2 h-20 w-full resize-none bg-muted/20 p-2 font-mono text-[11px]"
            aria-label="Subcontract bulk template"
            readOnly
            value={template}
          />
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Enter a Master Data code or item description plus quantity. Code,
            description, BU, unit and SGD price come from Master Data. Add or
            correct base items in Master Data before importing them here.
          </p>
        </details>
        <label className="grid gap-1.5 text-xs font-medium">
          Paste or type a table
          <textarea
            aria-label="Subcontract bulk table"
            className="h-36 w-full resize-y rounded-md border border-border bg-white px-3 py-2 font-mono text-xs font-normal leading-5 outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
            value={text}
            disabled={locked}
            placeholder={template}
            onChange={(event) => {
              // Retain one excess character so an oversized paste is rejected, never silently accepted after truncation.
              if (!locked)
                onTextChange(
                  event.target.value.slice(
                    0,
                    SUBCONTRACT_BULK_LIMITS.characters + 1,
                  ),
                );
            }}
          />
        </label>
        <p className="text-[11px] text-muted-foreground">
          Excel paste, quoted CSV or Markdown · up to 1,000 rows.{' '}
          {site
            ? 'Quantities apply per site; annual site deployments remain unchanged.'
            : 'Quantity uses the selected year; Y1–Y5 or calendar-year columns allocate annual quantities.'}{' '}
          Existing items stay in place.
        </p>
        {preview && (
          <>
            {!current && (
              <p
                role="alert"
                className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
              >
                The input or cost version changed. Generate a new preview before
                confirming.
              </p>
            )}
            <div className="grid gap-2 rounded-md border bg-muted/15 p-2 sm:grid-cols-3">
              {preview.columns.map((column, index) => (
                <label
                  key={index}
                  className="grid gap-1 text-[11px] font-medium"
                >
                  <span className="truncate" title={column.header}>
                    {column.header}
                  </span>
                  <select
                    aria-label={`Subcontract bulk column ${index + 1}`}
                    className={selectClass}
                    disabled={locked}
                    value={options.mapping[index] ?? column.target}
                    onChange={(event) =>
                      update({
                        mapping: {
                          ...options.mapping,
                          [index]: event.target.value as SubcontractBulkColumn,
                        },
                      })
                    }
                  >
                    {mappingLabels
                      .filter(([target]) =>
                        site
                          ? !target.startsWith('quantity:')
                          : target !== 'quantityPerSite',
                      )
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            {!!preview.issues.length && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800"
              >
                <ul className="list-disc space-y-1 pl-4">
                  {preview.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!preview.notices.length && (
              <details className="rounded-md border px-3 py-2 text-xs">
                <summary className="cursor-pointer">
                  Review notes · {preview.notices.length}
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                  {preview.notices.map((notice, index) => (
                    <li key={index}>{notice}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <strong>{preview.entries.length} items</strong>
              <span className="tabular-nums">
                Batch cost · SGD {money(preview.totalCost)}
                {site ? ' · current deployments' : ''}
              </span>
            </div>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full min-w-[650px] text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 text-left">Row / Item</th>
                    <th className="p-2 text-left">BU / Unit</th>
                    <th className="p-2 text-right">Unit price</th>
                    <th className="p-2 text-right">
                      {site ? 'Qty / Site' : 'Y1 / Y2 / Y3 / Y4 / Y5'}
                    </th>
                    <th className="p-2 text-left">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entries
                    .slice(safePage * 50, (safePage + 1) * 50)
                    .map((entry) => (
                      <tr key={entry.sourceRow} className="border-t align-top">
                        <td className="p-2">
                          <strong className="font-mono font-bold">
                            {entry.sourceRow} · {entry.line?.code}
                          </strong>
                          <p className="mt-1 max-w-72 whitespace-normal break-words">
                            {entry.line?.description}
                          </p>
                        </td>
                        <td className="p-2">
                          {entry.line?.bu}
                          <span className="block text-muted-foreground">
                            {entry.line?.unit}
                          </span>
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {entry.line?.unitPrice == null
                            ? 'Not priced'
                            : money(entry.line.unitPrice)}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {entry.line &&
                            ('quantities' in entry.line
                              ? entry.line.quantities.join(' / ')
                              : entry.line.quantityPerSite)}
                        </td>
                        <td className="max-w-72 whitespace-normal p-2">
                          {entry.issues.length ? (
                            <ul className="space-y-1 text-red-700">
                              {entry.issues.map((issue, index) => (
                                <li key={index}>{issue}</li>
                              ))}
                            </ul>
                          ) : entry.line?.unitPrice === null ? (
                            'Set price before finalizing'
                          ) : (
                            'Ready'
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-end gap-2 text-xs">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                  variant="outline"
                  size="sm"
                  disabled={safePage === pageCount - 1}
                  onClick={() => onPage(safePage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
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
          {preview?.canConfirm && current
            ? ` ${preview.lines.length} Items`
            : ''}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Keep text and preview local; one successful confirmation closes and consumes the batch. */
export function SubcontractBulkEntryDialog(props: Props) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<SubcontractBulkOptions>({
    defaultYear: props.defaultYear,
    mapping: {},
  });
  const [preview, setPreview] = useState<{
    key: string;
    data: SubcontractBulkPreview;
  } | null>(null);
  const [page, setPage] = useState(0);
  const confirming = useRef(false);
  const currentKey = subcontractBulkInputKey(text, options, props);
  const generatePreview = () => {
    if (props.locked) return;
    setPreview({
      key: currentKey,
      data: parseSubcontractBulkEntry(text, options, props),
    });
    setPage(0);
  };
  const confirm = () => {
    if (confirming.current || props.locked) return;
    confirming.current = true;
    try {
      const accepted = confirmSubcontractBulkPreview({
        preview: preview?.data || null,
        currentKey,
        previewKey: preview?.key,
        basis: props,
        locked: props.locked,
        onConfirm: props.onConfirm,
        announce: props.announce,
      });
      if (accepted) props.onClose();
      else confirming.current = false;
    } catch (error) {
      confirming.current = false;
      props.announce(
        error instanceof Error
          ? error.message
          : 'Unable to add this batch. Review the preview and try again.',
      );
    }
  };
  const siteName =
    props.target.kind === 'site'
      ? props.value.siteTypes.find(
          (site) => props.target.kind === 'site' && site.id === props.target.id,
        )?.name
      : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[1040px]">
        <DialogHeader>
          <DialogTitle>Subcontract Bulk Entry</DialogTitle>
          <DialogDescription>
            {siteName ? `BOQ per Site · ${siteName}` : 'Project BOQ'} · Paste,
            preview and confirm the items to add.
          </DialogDescription>
        </DialogHeader>
        <SubcontractBulkEntryForm
          text={text}
          options={options}
          basis={props}
          preview={preview?.data || null}
          current={preview?.key === currentKey}
          locked={props.locked}
          page={page}
          onPage={setPage}
          onTextChange={setText}
          onOptionsChange={setOptions}
          onPreview={generatePreview}
          onConfirm={confirm}
          onClose={props.onClose}
          onCopyTemplate={(template) => {
            void navigator.clipboard
              .writeText(template)
              .then(() =>
                props.announce(
                  'Subcontract template copied. Enter Master Data codes or descriptions and quantities in Excel.',
                ),
              )
              .catch(() =>
                props.announce(
                  'Unable to copy. Select and copy the template under Template & accepted columns.',
                ),
              );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
