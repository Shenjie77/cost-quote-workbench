'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MAX_QUOTE_TEMPLATE_BYTES,
  inspectQuoteExcelTemplate,
  loadQuoteExcelTemplate,
  uploadQuoteExcelTemplate,
} from '@/features/quote/excel-template-client';
import {
  MAX_QUOTE_TEMPLATE_ROW,
  requiredQuoteExcelFields,
  validateQuoteExcelMapping,
} from '@/features/quote/excel-template-mapping';
import type {
  QuoteExcelAsset,
  QuoteExcelColumns,
  QuoteExcelField,
  QuoteExcelTemplate,
} from '@/features/quote/excel-template-types';

/** Strings preserve incomplete row input locally until the user explicitly applies a valid mapping. */
type MappingDraft = Omit<QuoteExcelTemplate, 'detailRow'> & {
  detailRow: string;
};
type EditorProps = {
  templateId: string;
  value?: QuoteExcelTemplate;
  onChange: (mapping: QuoteExcelTemplate | undefined) => void;
};

/** Customer-visible line fields are distinct from internal cost and resource-rate inputs. */
const columnLabels: Array<[keyof QuoteExcelColumns, string]> = [
  ['description', 'Description column *'],
  ['amount', 'Amount column *'],
  ['number', 'Line number column'],
  ['quantity', 'Quantity column'],
  ['unit', 'Unit column'],
  ['unitPrice', 'Unit price column'],
];

/** Quotation metadata and totals target cells in the original workbook before details expand. */
const cellLabels: Array<[QuoteExcelField, string]> = [
  ['quoteNumber', 'Quote number'],
  ['client', 'Client'],
  ['project', 'Project'],
  ['costVersion', 'Cost version'],
  ['currency', 'Currency'],
  ['documentTitle', 'Document title'],
  ['validityDays', 'Validity days'],
  ['paymentTerms', 'Payment terms'],
  ['termsAndConditions', 'Terms & Conditions'],
  ['assumptions', 'Included assumptions'],
  ['servicePrice', 'Service price'],
  ['discount', 'Discount'],
  ['quoteBeforeTax', 'Total before tax'],
  ['gstPercent', 'GST (%)'],
  ['gstAmount', 'GST amount'],
  ['quoteAfterTax', 'Total after tax'],
];

/** Start with one sample detail row; the workbook stays immutable while this mapping is edited. */
function initialDraft(asset: QuoteExcelAsset): MappingDraft {
  return {
    assetId: asset.assetId,
    fileName: asset.fileName,
    sheetName: asset.sheets[0]?.name || '',
    detailRow: '12',
    columns: { description: 'B', amount: 'F' },
    cells: {},
  };
}

/** Existing mappings are cloned so editing this form cannot mutate published template snapshots. */
function editableMapping(value?: QuoteExcelTemplate): MappingDraft | undefined {
  return value
    ? { ...structuredClone(value), detailRow: String(value.detailRow) }
    : undefined;
}

/** Blank optional fields are omitted; uppercase coordinates are canonical for validation and export. */
function mappingFromDraft(draft: MappingDraft): QuoteExcelTemplate {
  const columns = Object.fromEntries(
    Object.entries(draft.columns)
      .map(([key, value]) => [key, value.trim().toUpperCase()])
      .filter(
        ([key, value]) => value || key === 'description' || key === 'amount',
      ),
  ) as QuoteExcelColumns;
  const cells = Object.fromEntries(
    Object.entries(draft.cells)
      .map(([key, value]) => [key, value.trim().toUpperCase()])
      .filter(([, value]) => value),
  );
  return { ...draft, columns, cells, detailRow: Number(draft.detailRow) };
}

/** Three synthetic lines exercise row expansion and totals without reading or archiving any project. */
async function sampleWorkbook(mapping: QuoteExcelTemplate) {
  const [{ buildQuoteWorkbookBuffer }, { calculatePricing }] =
    await Promise.all([
      import('@/features/quote/export-quote-workbook'),
      import('@/features/quote/domain'),
    ]);
  return buildQuoteWorkbookBuffer({
    project: {
      id: 'SAMPLE',
      name: 'Sample Project',
      client: 'Sample Customer',
      currency: 'SGD',
    },
    quoteNumber: 'SAMPLE-NOT-A-QUOTATION',
    costVersion: 'SAMPLE',
    template: {
      id: 'sample-template',
      name: 'Sample layout test',
      clientPattern: '*',
      active: true,
      documentTitle: 'SAMPLE — NOT A QUOTATION',
      validityDays: 30,
      paymentTerms: 'Sample payment terms only.',
      termsAndConditions: '',
      defaultAssumptionIds: [],
      excel: mapping,
    },
    assumptions: [],
    pricing: calculatePricing(1200, {
      targetGrossMargin: 20,
      discount: 0,
      gstPercent: 9,
    }),
    lineMode: 'item',
    lines: [
      {
        id: 'sample-1',
        description: 'Sample planning service',
        quantity: 1,
        unit: 'lot',
        unitPrice: 300,
        amount: 300,
      },
      {
        id: 'sample-2',
        description: 'Sample configuration service',
        quantity: 2,
        unit: 'unit',
        unitPrice: 250,
        amount: 500,
      },
      {
        id: 'sample-3',
        description: 'Sample testing and handover',
        quantity: 1,
        unit: 'lot',
        unitPrice: 700,
        amount: 700,
      },
    ],
  });
}

/** The keyed session isolates asynchronous uploads and staged edits when another template is selected. */
export function QuoteExcelTemplateEditor(props: EditorProps) {
  return (
    <QuoteExcelTemplateEditorSession
      key={`${props.templateId}:${JSON.stringify(props.value ?? null)}`}
      {...props}
    />
  );
}

/** Uploads are local assets; only Apply or Remove updates the caller's unsaved template draft. */
function QuoteExcelTemplateEditorSession({ value, onChange }: EditorProps) {
  const [draft, setDraft] = useState(() => editableMapping(value));
  const [asset, setAsset] = useState<QuoteExcelAsset | null>(null);
  const [busy, setBusy] = useState(!!value);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const request = useRef(0);
  const inFlight = useRef(!!value);
  const assetId = value?.assetId;

  // A closed or switched editor must never apply a late response to another template.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current += 1;
    };
  }, []);

  // Keyed mappings initialize state once; this effect only inspects the immutable local source.
  useEffect(() => {
    if (!assetId) return;
    const token = ++request.current;
    void inspectQuoteExcelTemplate(assetId)
      .then((result) => {
        if (alive.current && token === request.current) setAsset(result);
      })
      .catch((failure) => {
        if (alive.current && token === request.current)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Cannot load the local workbook.',
          );
      })
      .finally(() => {
        if (alive.current && token === request.current) {
          inFlight.current = false;
          setBusy(false);
        }
      });
    return () => {
      request.current += 1;
    };
  }, [assetId]);

  /** Stage a newly uploaded asset; valid existing mappings remain unchanged until Apply is chosen. */
  async function upload(file: File) {
    if (inFlight.current) return;
    if (
      !/\.xlsx$/i.test(file.name) ||
      file.size > MAX_QUOTE_TEMPLATE_BYTES ||
      file.size === 0
    ) {
      setError('Choose a non-empty .xlsx file no larger than 10 MB.');
      return;
    }
    const token = ++request.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadQuoteExcelTemplate(file);
      if (!alive.current || token !== request.current) return;
      setAsset(result);
      setDraft(initialDraft(result));
      setNotice(
        'Workbook uploaded locally. Check its original coordinates, then apply the mapping.',
      );
    } catch (failure) {
      if (alive.current && token === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Workbook upload failed.',
        );
    } finally {
      if (alive.current && token === request.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  /** Validate coordinates and an actual three-row fill before updating the master-data draft; nothing is archived. */
  async function apply() {
    if (!draft || !asset || inFlight.current) return;
    const mapping = mappingFromDraft(draft);
    const errors = validateQuoteExcelMapping(mapping, asset.sheets);
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    const token = ++request.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Building without a download catches merge and formula conflicts while leaving the source untouched.
      await sampleWorkbook(mapping);
      if (!alive.current || token !== request.current) return;
      onChange(mapping);
      setNotice(
        'Mapping validated and applied to this draft. Save this master-data tab to publish it.',
      );
    } catch (failure) {
      if (alive.current && token === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'The mapping could not be validated against this workbook.',
        );
    } finally {
      if (alive.current && token === request.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  /** Download the original or a synthetic fill; neither path creates project archive/history records. */
  async function downloadWorkbook(sample = false) {
    if (!draft || inFlight.current) return;
    const mapping = mappingFromDraft(draft);
    if (sample) {
      if (!asset) return;
      const errors = validateQuoteExcelMapping(mapping, asset.sheets);
      if (errors.length) {
        setError(errors.join(' '));
        return;
      }
    }
    const token = ++request.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const bytes = sample
        ? await sampleWorkbook(mapping)
        : await loadQuoteExcelTemplate(mapping.assetId);
      if (!alive.current || token !== request.current) return;
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = sample ? `SAMPLE_${mapping.fileName}` : mapping.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (sample)
        setNotice(
          'Sample workbook downloaded with 3 synthetic rows. Check its layout in Excel; no project or quotation history was changed.',
        );
    } catch (failure) {
      if (alive.current && token === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Cannot download the workbook.',
        );
    } finally {
      if (alive.current && token === request.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  /** Removing an association restores the standard layout; immutable assets and project copies are retained. */
  function remove() {
    if (inFlight.current) return;
    request.current += 1;
    setDraft(undefined);
    setAsset(null);
    setError('');
    setNotice(
      'Standard quotation layout selected. Save this master-data tab to publish it.',
    );
    if (value) onChange(undefined);
  }

  const changed =
    draft && JSON.stringify(mappingFromDraft(draft)) !== JSON.stringify(value);
  return (
    <section
      className="space-y-3 rounded-md border bg-muted/10 p-3"
      aria-label="Customer Excel template"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="size-4" /> Customer Excel layout
        </h3>
        {changed && (
          <span className="text-xs font-medium text-amber-700">
            Mapping not applied
          </span>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Upload a plain .xlsx workbook (up to 10 MB). Files stay in this
        workbench&apos;s local database. Without an Excel mapping, quotations
        use the standard layout. Apply validates the local workbook; save this
        master-data tab to publish the mapping.
      </p>
      <label className="block space-y-1 text-xs font-medium">
        <span className="flex items-center gap-1.5">
          <Upload className="size-3.5" /> Upload or replace workbook
        </span>
        <Input
          type="file"
          accept=".xlsx"
          disabled={busy}
          aria-label="Upload customer Excel template"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {draft && (
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
            <span className="break-all text-xs font-medium">
              {draft.fileName}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void downloadWorkbook()}
            >
              <Download /> Download original
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              Worksheet
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                aria-label="Template worksheet"
                value={draft.sheetName}
                onChange={(event) =>
                  setDraft({ ...draft, sheetName: event.target.value })
                }
              >
                {!asset && (
                  <option value={draft.sheetName}>{draft.sheetName}</option>
                )}
                {asset?.sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount} rows × {sheet.columnCount}{' '}
                    columns)
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              Repeatable detail row *
              <Input
                aria-label="Repeatable detail row"
                type="number"
                min={1}
                max={MAX_QUOTE_TEMPLATE_ROW}
                step={1}
                value={draft.detailRow}
                onChange={(event) =>
                  setDraft({ ...draft, detailRow: event.target.value })
                }
              />
            </label>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Use coordinates from the original workbook. One detail row is copied
            for each quote line; totals and terms below it move down
            automatically. Use the top-left cell of merged ranges. The detail
            row can merge horizontally, but cannot belong to a vertical merge.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {columnLabels.map(([field, label]) => (
              <label key={field} className="block space-y-1 text-xs">
                {label}
                <Input
                  aria-label={label}
                  placeholder={
                    field === 'description'
                      ? 'B'
                      : field === 'amount'
                        ? 'F'
                        : 'Optional'
                  }
                  maxLength={3}
                  value={draft.columns[field] || ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      columns: {
                        ...draft.columns,
                        [field]: event.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <details open className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer text-xs font-medium">
              Quote fields and totals
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Map all eight required fields (*) to keep the quotation complete.
              Mapped cells retain their formatting; unmapped cells retain their
              content or formulas. All addresses belong to the selected
              worksheet. Also map Discount when used, Terms &amp; Conditions
              when entered, and Included assumptions when selected.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {cellLabels.map(([field, label]) => (
                <label key={field} className="block space-y-1 text-xs">
                  {label}
                  {requiredQuoteExcelFields.includes(field) ? ' *' : ''}
                  <Input
                    aria-label={`${label} cell`}
                    placeholder="e.g. B4"
                    maxLength={10}
                    value={draft.cells[field] || ''}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        cells: { ...draft.cells, [field]: event.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={apply} disabled={!asset}>
              Apply mapping
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!asset}
              onClick={() => void downloadWorkbook(true)}
            >
              <Download /> Test with sample rows
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!asset}
              onClick={() => {
                if (!asset) return;
                setDraft(initialDraft(asset));
                setError('');
                setNotice(
                  'Default coordinates restored locally. Apply the mapping when ready.',
                );
              }}
            >
              <RotateCcw /> Reset mapping
            </Button>
            <Button size="sm" variant="ghost" onClick={remove}>
              <Trash2 /> Remove Excel layout
            </Button>
          </div>
        </fieldset>
      )}
      {busy && (
        <output className="block text-xs text-muted-foreground">
          Reading local workbook…
        </output>
      )}
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <output className="block text-xs leading-5 text-muted-foreground">
          {notice}
        </output>
      )}
    </section>
  );
}
