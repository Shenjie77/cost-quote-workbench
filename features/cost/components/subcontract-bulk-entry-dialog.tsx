import {
  Surface,
  Disclosure,
  DisclosureSummary,
  Text,
} from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { Textarea } from '@/components/ui/textarea';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { Table } from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
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
const money = formatMoney;
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
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="grid"
            >
              Quantity year
              <SelectField
                aria-label="Subcontract bulk quantity year"
                className="h-8 min-w-0 w-full"
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
              </SelectField>
            </Surface>
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
        <Disclosure>
          <DisclosureSummary className="cursor-pointer">
            Template &amp; accepted columns
          </DisclosureSummary>
          <Textarea
            className="h-20 w-full resize-none"
            aria-label="Subcontract bulk template"
            readOnly
            value={template}
          />
          <Text as="p" tone="muted" textRole="body-small" className="mt-2">
            Enter a Master Data code or item description plus quantity. Code,
            description, BU, unit and SGD price come from Master Data. Add or
            correct base items in Master Data before importing them here.
          </Text>
        </Disclosure>
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="grid"
        >
          Paste or type a table
          <Textarea
            aria-label="Subcontract bulk table"
            className="h-36 w-full resize-y"
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
        </Surface>
        <Text as="p" tone="muted" textRole="body-small">
          Excel paste, quoted CSV or Markdown · up to 1,000 rows.{' '}
          {site
            ? 'Quantities apply per site; annual site deployments remain unchanged.'
            : 'Quantity uses the selected year; Y1–Y5 or calendar-year columns allocate annual quantities.'}{' '}
          Existing items stay in place.
        </Text>
        {preview && (
          <>
            {!current && (
              <Surface
                role="alert"
                as="p"
                variant="notice"
                tone="warning"
                textRole="body-small"
              >
                The input or cost version changed. Generate a new preview before
                confirming.
              </Surface>
            )}
            <Surface
              as="div"
              variant="panel"
              padded
              className="grid gap-2 sm:grid-cols-3"
            >
              {preview.columns.map((column, index) => (
                <Surface
                  key={index}
                  as="label"
                  variant="field"
                  textRole="body-small"
                  className="grid"
                >
                  <span className="truncate" title={column.header}>
                    {column.header}
                  </span>
                  <SelectField
                    aria-label={`Subcontract bulk column ${index + 1}`}
                    className="h-8 min-w-0 w-full"
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
                  </SelectField>
                </Surface>
              ))}
            </Surface>
            {!!preview.issues.length && (
              <Surface
                role="alert"
                as="div"
                variant="notice"
                tone="danger"
                textRole="body-small"
              >
                <Surface as="ul" variant="body" className="list-disc space-y-1">
                  {preview.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </Surface>
              </Surface>
            )}
            {!!preview.notices.length && (
              <Disclosure>
                <DisclosureSummary className="cursor-pointer">
                  Review notes · {preview.notices.length}
                </DisclosureSummary>
                <Surface
                  as="ul"
                  variant="body"
                  tone="muted"
                  className="mt-2 list-disc space-y-1"
                >
                  {preview.notices.map((notice, index) => (
                    <li key={index}>{notice}</li>
                  ))}
                </Surface>
              </Disclosure>
            )}
            <Surface
              as="div"
              textRole="body-small"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <strong>{preview.entries.length} items</strong>
              <span className="tabular-nums">
                Batch cost · SGD {money(preview.totalCost)}
                {site ? ' · current deployments' : ''}
              </span>
            </Surface>
            <Surface
              as="div"
              variant="panel"
              className="max-h-72 overflow-auto"
            >
              <Table className="w-full min-w-[650px]">
                <TableHeader className="sticky top-0">
                  <TableRow>
                    <TableHead className="text-left">Row / Item</TableHead>
                    <TableHead className="text-left">BU / Unit</TableHead>
                    <TableHead variant="numeric" className="text-right">
                      Unit price
                    </TableHead>
                    <TableHead variant="numeric" className="text-right">
                      {site ? 'Qty / Site' : 'Y1 / Y2 / Y3 / Y4 / Y5'}
                    </TableHead>
                    <TableHead className="text-left">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.entries
                    .slice(safePage * 50, (safePage + 1) * 50)
                    .map((entry) => (
                      <TableRow key={entry.sourceRow} className="align-top">
                        <TableCell>
                          <Text as="strong">
                            {entry.sourceRow} · {entry.line?.code}
                          </Text>
                          <p className="mt-1 max-w-72 whitespace-normal break-words">
                            {entry.line?.description}
                          </p>
                        </TableCell>
                        <TableCell>
                          {entry.line?.bu}
                          <Text as="span" tone="muted" className="block">
                            {entry.line?.unit}
                          </Text>
                        </TableCell>
                        <TableCell
                          variant="numeric"
                          className="text-right tabular-nums"
                        >
                          {entry.line?.unitPrice == null
                            ? 'Not priced'
                            : money(entry.line.unitPrice)}
                        </TableCell>
                        <TableCell
                          variant="numeric"
                          className="text-right tabular-nums"
                        >
                          {entry.line &&
                            ('quantities' in entry.line
                              ? entry.line.quantities.join(' / ')
                              : entry.line.quantityPerSite)}
                        </TableCell>
                        <TableCell
                          variant="label"
                          className="max-w-72 whitespace-normal"
                        >
                          {entry.issues.length ? (
                            <Surface
                              as="ul"
                              tone="danger"
                              className="space-y-1"
                            >
                              {entry.issues.map((issue, index) => (
                                <li key={index}>{issue}</li>
                              ))}
                            </Surface>
                          ) : entry.line?.unitPrice === null ? (
                            'Set price before finalizing'
                          ) : (
                            'Ready'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </Surface>
            {pageCount > 1 && (
              <Surface
                as="div"
                textRole="body-small"
                className="flex items-center justify-end gap-2"
              >
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
              </Surface>
            )}
          </>
        )}
      </div>
      <DialogFooter>
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
      <DialogContent size="lg" className="overflow-y-auto">
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
